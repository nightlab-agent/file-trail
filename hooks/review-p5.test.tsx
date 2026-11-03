// review (ft-panel5 cr): saveEnded now holds the live writes' lock and writes an owed live list only
// after its own write succeeds. A failed ended write (an OS refusal, which $.fs.write rejects with)
// then drops the next conversation's owed write: its file misses the call until some later call.
import { expect, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

type Written = { path: string; text: string }
type On = Parameters<TestBody>[1]
const last = (ws: Written[], name: string) => ws.filter(w => w.path.endsWith(`/${name}`)).at(-1)?.text ?? ''
const ticks = async (n = 40) => {
  for (let i = 0; i < n; i++) await Promise.resolve()
}

// /clear from sess-a into sess-b; a call from sess-a answers after the end, and its ended write to
// sess-a.txt is held; meanwhile sess-b keeps a call (its write finds the lock held and is owed); then
// the held ended write fails (`fails`) or lands.
const run = async ($: Parameters<TestBody>[0], on: On, fails: boolean) => {
  const session = { id: 'sess-a' }
  const writes: Written[] = []
  let release!: () => void
  const held = new Promise<void>(r => { release = r })
  let settle!: () => void
  const landed = new Promise<void>(r => { settle = r })
  let reached = false
  on('session.cwd', () => ({ value: '/work/app' }))
  on('session.id', () => ({ value: session.id }))
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))
  on('fs.write', async (_, e) => {
    if (e.path.endsWith('/sess-a.txt') && e.text.includes('slow.ts')) {
      reached = true
      await landed
      if (fails) throw new Error('EACCES: permission denied')
    }
    writes.push({ path: e.path, text: e.text })
    return { value: undefined }
  })
  on('ui.status', () => ({ value: undefined }))
  on('tool.call', async (_, e) => {
    if (JSON.stringify(e).includes('slow')) await held
    return { result: {} }
  })
  await $.tool.call({ tool: 'Read', file_path: '/work/app/old.ts' })
  const slow = $.tool.call({ tool: 'Read', file_path: '/work/app/slow.ts' })
  await ticks()
  await $.session.end({ reason: 'clear', sessionId: 'sess-a', resume: {} as never })
  session.id = 'sess-b'
  release()
  for (let i = 0; i < 50 && !reached; i++) await ticks()
  expect(reached).toBe(true)
  await $.tool.call({ tool: 'Read', file_path: '/work/app/next.ts' })
  settle()
  await slow
  await ticks(100)
  return writes
}

test('review P5-1: a failed ended write does not cost the next conversation its file', async ($, on) => {
  const writes = await run($, on, true)
  expect(last(writes, 'sess-b.txt')).toContain('next.ts')
})
test('review P5-1 comparison: the same ended write landing leaves the next conversation its file', async ($, on) => {
  const writes = await run($, on, false)
  expect(last(writes, 'sess-b.txt')).toContain('next.ts')
})
