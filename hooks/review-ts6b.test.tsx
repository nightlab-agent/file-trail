// Review of d546f68 (typescript lens), made to hold on every run in the a9f5548 review: the hooks
// module stamps `new Date()` in its own realm, so a test cannot fix the clock, and two calls released
// together land in one millisecond only some runs. The pair is tried again, under a fresh target,
// until the second save's payload shows both entries with one stamp; only that pair is held into the
// end step.
import { expect, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

// the hooks test runtime has setTimeout; lib es2023 types none (TS2304)
const setTimeout = (globalThis as unknown as { setTimeout: (f: () => void, ms: number) => unknown }).setTimeout
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

type Written = { path: string; text: string }
type On = Parameters<TestBody>[1]
type Stamped = { at: string; target: string }
const last = (ws: Written[], name: string) => ws.filter(w => w.path.endsWith(`/${name}`)).at(-1)?.text ?? ''
const count = (text: string, needle: string) => text.split(needle).length - 1
const ticks = async (n = 40) => {
  for (let i = 0; i < n; i++) await Promise.resolve()
}

// Kind 2 (a value that surprises): register.tsx:370 tells "this save is in the end's read list" by
// field equality (at, tool, target, agentId), and `at` is a millisecond. Two Reads of one file in one
// parallel batch (a big file read in two offsets) answer in the same millisecond: one save lands
// before the /clear reads the list, the other lands during the end step (its set takes 20 ms; the end
// step 60 ms). The late one finds its twin in the read list, keeps mine > 0, and returns at
// register.tsx:401: the ended file holds one line for the target, not two.
const run = async ($: Parameters<TestBody>[0], on: On, secondLandsInEndStep: boolean) => {
  const session = { id: 'sess-a' }
  const writes: Written[] = []
  let held = false
  let matched = false
  let target = ''
  // both calls of a pair ask the working folder right before they stamp: answered together
  let armed = false
  let asked = 0
  let release = () => {}
  let both = Promise.resolve()
  on('session.cwd', async () => {
    if (armed) {
      if (++asked === 2) {
        const t0 = Date.now()
        while (Date.now() === t0) {
          /* spin to a fresh millisecond */
        }
        armed = false
        release()
      }
      await both
    }
    return { value: '/work/app' }
  })
  on('session.id', () => ({ value: session.id }))
  on('session.end', async (_, e) => {
    await sleep(60)
    return { sessionId: e.sessionId }
  })
  on('fs.write', (_, e) => {
    writes.push({ path: e.path, text: e.text })
    return { value: undefined }
  })
  on('ui.status', () => ({ value: undefined }))
  on('tool.call', () => ({ result: {} }))
  on('state.set', async (_, e, next) => {
    // the save whose value carries both entries of the pair: the premise holds when they share one stamp
    const inner = (e.value as { value?: unknown } | undefined)?.value
    const v = Array.isArray(inner) ? (inner as Stamped[]) : []
    const [a, b] = v.slice(-2)
    if (!matched && a && b && a.target === target && b.target === target) {
      if (a.at === b.at) {
        matched = true
        if (secondLandsInEndStep) {
          held = true
          await sleep(20)
        }
      }
    }
    return next(e)
  })
  let calls: Promise<unknown> = Promise.resolve()
  for (let i = 0; i < 40 && !matched; i++) {
    target = `same${i}.ts`
    asked = 0
    both = new Promise<void>(r => (release = r))
    armed = true
    let settled = false
    calls = Promise.all([
      $.tool.call({ tool: 'Read', file_path: `/work/app/${target}` }),
      $.tool.call({ tool: 'Read', file_path: `/work/app/${target}` }),
    ])
    void calls.then(() => (settled = true))
    while (!held && !settled) await sleep(1)
    if (!held) await calls
  }
  expect(matched ? 'a pair shared one stamp' : 'no pair shared one stamp in 40 tries').toBe('a pair shared one stamp')
  if (secondLandsInEndStep) expect(held ? 'the second save was held' : 'the second save was not held').toBe('the second save was held')
  await $.session.end({ reason: 'clear', sessionId: 'sess-a', resume: {} as never })
  session.id = 'sess-b'
  await calls
  await ticks(200)
  return { writes, target }
}

const stamps = (text: string, target: string) =>
  text
    .split('\n')
    .filter(l => l.includes(target))
    .map(l => l.split(' ')[0])

test('review-ts6b B1: two calls of one target in one millisecond, the second saved during the end step, both reach the ended file', async ($, on) => {
  const { writes, target } = await run($, on, true)
  const ended = last(writes, 'sess-a.txt')
  const live = last(writes, 'sess-b.txt')
  expect(count(live, target)).toBe(0)
  expect(count(ended, target)).toBe(2)
  expect(new Set(stamps(ended, target)).size).toBe(1)
})
test('review-ts6b B1 comparison: the same two calls both saved before the /clear are both in the ended file', async ($, on) => {
  const { writes, target } = await run($, on, false)
  const ended = last(writes, 'sess-a.txt')
  expect(count(ended, target)).toBe(2)
  expect(new Set(stamps(ended, target)).size).toBe(1)
})
