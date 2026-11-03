// Review of d546f68 (typescript lens): each finding is a test that fails there, beside a comparison case that passes.
import { expect, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

// the hooks test runtime has setTimeout; lib es2023 types none (TS2304)
const setTimeout = (globalThis as unknown as { setTimeout: (f: () => void, ms: number) => unknown }).setTimeout
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

type Written = { path: string; text: string }
type On = Parameters<TestBody>[1]
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
// register.tsx:401: the ended file holds one same.ts line, not two.
const run = async ($: Parameters<TestBody>[0], on: On, secondLandsInEndStep: boolean) => {
  const session = { id: 'sess-a' }
  const writes: Written[] = []
  let held = false
  // both calls ask the working folder right before they stamp their entry: answered together, so
  // the two stamps are one millisecond
  let asked = 0
  let release!: () => void
  const both = new Promise<void>(r => (release = r))
  on('session.cwd', async () => {
    if (++asked === 2) {
      const t0 = Date.now()
      while (Date.now() === t0) {
        /* spin to a fresh millisecond */
      }
      release()
    }
    await both
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
    // the set whose new value carries both entries is the second save (`e` holds `previous` too)
    if (secondLandsInEndStep && count(JSON.stringify(e.value), 'same.ts') === 2) {
      held = true
      await sleep(20)
    }
    return next(e)
  })
  const calls = Promise.all([
    $.tool.call({ tool: 'Read', file_path: '/work/app/same.ts' }),
    $.tool.call({ tool: 'Read', file_path: '/work/app/same.ts' }),
  ])
  if (secondLandsInEndStep) {
    for (let i = 0; i < 200 && !held; i++) await sleep(1)
    expect(held ? 'the second save was held' : 'the second save was not held').toBe('the second save was held')
  } else await calls
  await $.session.end({ reason: 'clear', sessionId: 'sess-a', resume: {} as never })
  session.id = 'sess-b'
  await calls
  await ticks(200)
  return writes
}

// the premise: both entries carry one timestamp (a miss here is the clock, not the finding)
const stamps = (text: string) =>
  text
    .split('\n')
    .filter(l => l.includes('same.ts'))
    .map(l => l.split(' ')[0])

test('review-ts6b B1: two calls of one target in one millisecond, the second saved during the end step, both reach the ended file', async ($, on) => {
  const writes = await run($, on, true)
  const ended = last(writes, 'sess-a.txt')
  const live = last(writes, 'sess-b.txt')
  expect(count(live, 'same.ts')).toBe(0)
  expect(count(ended, 'same.ts')).toBe(2)
  expect(new Set(stamps(ended)).size).toBe(1)
})
test('review-ts6b B1 comparison: the same two calls both saved before the /clear are both in the ended file', async ($, on) => {
  const writes = await run($, on, false)
  const ended = last(writes, 'sess-a.txt')
  expect(count(ended, 'same.ts')).toBe(2)
  expect(new Set(stamps(ended)).size).toBe(1)
})
