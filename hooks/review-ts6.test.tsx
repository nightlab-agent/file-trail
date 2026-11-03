// Review of ffb132c (typescript lens): each finding is a test that fails there, beside a comparison case that passes.
import { expect, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

// the hooks test runtime has setTimeout; lib es2023 types none (TS2304)
const setTimeout = (globalThis as unknown as { setTimeout: (f: () => void, ms: number) => unknown }).setTimeout
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

type Written = { path: string; text: string }
type On = Parameters<TestBody>[1]
const last = (ws: Written[], name: string) => ws.filter(w => w.path.endsWith(`/${name}`)).at(-1)?.text ?? ''
const ticks = async (n = 40) => {
  for (let i = 0; i < n; i++) await Promise.resolve()
}

// Kind 1 (interleaved awaits): a /clear arrives while late.ts's state write is on its way (it takes
// 20 ms; the engine's end step takes 60 ms). session.end reads the list before the write lands, the write
// lands (no version miss) during the end step, and the call then sees mine > 0 with the generation
// moved and returns at register.tsx:391: its entry is in neither file. No call waits on another.
const run = async ($: Parameters<TestBody>[0], on: On, landInEndStep: boolean) => {
  const session = { id: 'sess-a' }
  const writes: Written[] = []
  let held = false
  on('session.cwd', () => ({ value: '/work/app' }))
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
    if (landInEndStep && JSON.stringify(e).includes('late.ts')) {
      held = true
      await sleep(20)
    }
    return next(e)
  })
  await $.tool.call({ tool: 'Read', file_path: '/work/app/old.ts' })
  const late = $.tool.call({ tool: 'Read', file_path: '/work/app/late.ts' })
  if (landInEndStep) {
    for (let i = 0; i < 50 && !held; i++) await ticks()
    expect(held).toBe(true)
  } else await late
  await $.session.end({ reason: 'clear', sessionId: 'sess-a', resume: {} as never })
  session.id = 'sess-b'
  await late
  await ticks(200)
  return writes
}

test('review-ts6 A1: a call whose state write lands during the end step is in the ended file', async ($, on) => {
  const writes = await run($, on, true)
  expect(last(writes, 'sess-b.txt')).not.toContain('late.ts')
  expect(last(writes, 'sess-a.txt')).toContain('late.ts')
})
test('review-ts6 A1 comparison: the same call whose write lands before the /clear is in the ended file', async ($, on) => {
  const writes = await run($, on, false)
  expect(last(writes, 'sess-a.txt')).toContain('late.ts')
})
