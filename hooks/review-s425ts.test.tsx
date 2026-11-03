// Review of e578a4f (typescript lens): each finding is a test that fails there, beside a comparison case that passes.
import { expect, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

type Written = { path: string; text: string }
type On = Parameters<TestBody>[1]
const last = (ws: Written[], name: string) => ws.filter(w => w.path.endsWith(`/${name}`)).at(-1)?.text ?? ''
const ticks = async (n = 40) => {
  for (let i = 0; i < n; i++) await Promise.resolve()
}

// fs.write records a write when it lands; with `slowEnded`, the ended list's write (sess-a.txt holding
// slow.ts) lands only when `land()` is called, as a slow disk or an async hook beneath would.
const world = (on: On, session: { id: string }, heldCall: Promise<void>, slowEnded: boolean) => {
  const writes: Written[] = []
  let land!: () => void
  const landed = new Promise<void>(r => { land = r })
  let reached = false
  on('session.cwd', () => ({ value: '/work/app' }))
  on('session.id', () => ({ value: session.id }))
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))
  on('fs.write', async (_, e) => {
    if (slowEnded && e.path.endsWith('/sess-a.txt') && e.text.includes('slow.ts')) {
      reached = true
      await landed
    }
    writes.push({ path: e.path, text: e.text })
    return { value: undefined }
  })
  on('ui.status', () => ({ value: undefined }))
  on('tool.call', async (_, e) => {
    if (JSON.stringify(e).includes('slow')) await heldCall
    return { result: {} }
  })
  return { writes, land: () => land(), reached: () => reached }
}

// /clear from sess-a, resume back into sess-a; the late call answers before the resumed conversation's
// first call, and its ended write is still on its way when that first call writes.
const run = async ($: Parameters<TestBody>[0], on: On, slowEnded: boolean) => {
  const session = { id: 'sess-a' }
  let release!: () => void
  const heldCall = new Promise<void>(r => { release = r })
  const w = world(on, session, heldCall, slowEnded)
  await $.tool.call({ tool: 'Read', file_path: '/work/app/old.ts' })
  const slow = $.tool.call({ tool: 'Read', file_path: '/work/app/slow.ts' })
  await ticks()
  await $.session.end({ reason: 'clear', sessionId: 'sess-a', resume: {} as never })
  session.id = 'sess-b'
  await $.session.end({ reason: 'resume', sessionId: 'sess-b', resume: {} as never })
  session.id = 'sess-a'
  release()
  for (let i = 0; i < 50 && slowEnded && !w.reached(); i++) await ticks()
  if (slowEnded) expect(w.reached()).toBe(true)
  else await ticks(400)
  await $.tool.call({ tool: 'Read', file_path: '/work/app/resumed.ts' })
  w.land()
  await slow
  await ticks()
  return w.writes
}

test('review-ts T1: an ended write still landing when the resumed conversation writes does not end the file', async ($, on) => {
  const writes = await run($, on, true)
  expect(last(writes, 'sess-a.txt')).toContain('resumed.ts')
})
test('review-ts T1 comparison: the same order with the ended write landing at once keeps the resumed calls', async ($, on) => {
  const writes = await run($, on, false)
  expect(last(writes, 'sess-a.txt')).toContain('resumed.ts')
})
