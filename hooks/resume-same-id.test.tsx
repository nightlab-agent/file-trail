// A /clear (sess-a -> sess-b), then a resume back into sess-a: the resumed conversation keeps its id, so
// its trail file is the ended one's. A call that began before the /clear and answers after the resume
// must not put the ended list back over the resumed conversation's file.
import { expect, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

type Written = { path: string; text: string }
type On = Parameters<TestBody>[1]
const last = (ws: Written[], name: string) => ws.filter(w => w.path.endsWith(`/${name}`)).at(-1)?.text ?? ''
const ticks = async (n = 20) => {
  for (let i = 0; i < n; i++) await Promise.resolve()
}

// session.id answers the current id; tool.call holds a 'slow' path until `held` settles
const world = (on: On, session: { id: string }, held?: Promise<void>) => {
  const writes: Written[] = []
  on('session.cwd', () => ({ value: '/work/app' }))
  on('session.id', () => ({ value: session.id }))
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))
  on('fs.write', (_, e) => {
    writes.push({ path: e.path, text: e.text })
    return { value: undefined }
  })
  on('ui.status', () => ({ value: undefined }))
  on('tool.call', async (_, e) => {
    if (held && JSON.stringify(e).includes('slow')) await held
    return { result: {} }
  })
  return { writes }
}

// /clear from sess-a, then resume from sess-b into `back`, with a call of the first sess-a held across both
const clearThenResume = async ($: Parameters<TestBody>[0], on: On, back: string, late: boolean) => {
  const session = { id: 'sess-a' }
  let release!: () => void
  const held = new Promise<void>(r => { release = r })
  const { writes } = world(on, session, held)
  await $.tool.call({ tool: 'Read', file_path: '/work/app/old.ts' })
  const slow = late ? $.tool.call({ tool: 'Read', file_path: '/work/app/slow.ts' }) : Promise.resolve()
  await ticks()
  await $.session.end({ reason: 'clear', sessionId: 'sess-a', resume: {} as never })
  session.id = 'sess-b'
  await $.session.end({ reason: 'resume', sessionId: 'sess-b', resume: {} as never })
  session.id = back
  await $.tool.call({ tool: 'Read', file_path: '/work/app/resumed.ts' })
  release()
  await slow
  return writes
}

test('a call that outlives a /clear and a resume back into its id leaves the resumed calls in the file', async ($, on) => {
  const writes = await clearThenResume($, on, 'sess-a', true)
  expect(last(writes, 'sess-a.txt')).toContain('resumed.ts')
})
test('comparison: the same /clear and resume back with no late call keep the resumed calls in the file', async ($, on) => {
  const writes = await clearThenResume($, on, 'sess-a', false)
  expect(last(writes, 'sess-a.txt')).toContain('resumed.ts')
})
test('comparison: when the resume goes to another id, the late call is in its own ended file', async ($, on) => {
  const writes = await clearThenResume($, on, 'sess-c', true)
  expect(last(writes, 'sess-c.txt')).toContain('resumed.ts')
  expect(last(writes, 'sess-c.txt')).not.toContain('slow.ts')
  expect(last(writes, 'sess-a.txt')).toContain('old.ts')
  expect(last(writes, 'sess-a.txt')).toContain('slow.ts')
})
