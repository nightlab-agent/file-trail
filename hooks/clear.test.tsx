import { expect, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

// A /clear ends the conversation, not the process: the engine moves it to a new session id and no
// session.start follows (types: SessionEndInput.reason). The new session's trail starts empty.

type Written = { path: string; text: string }

const world = (on: Parameters<TestBody>[1], session: { id: string }) => {
  const writes: Written[] = []
  on('session.cwd', () => ({ value: '/work/app' }))
  on('session.id', () => ({ value: session.id }))
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))
  on('fs.write', (_, e) => {
    writes.push({ path: e.path, text: e.text })
    return { value: undefined }
  })
  on('ui.status', () => ({ value: undefined }))
  on('tool.call', () => ({ result: {} }))
  return writes
}

const last = (writes: Written[], name: string) => writes.filter(w => w.path.endsWith(`/${name}`)).at(-1)!.text

test('/clear: the new session\'s trail holds its own calls only', async ($, on) => {
  const session = { id: 'sess-a' }
  const writes = world(on, session)
  await $.tool.call({ tool: 'Read', file_path: '/work/app/old.ts' })
  await $.session.end({ reason: 'clear', sessionId: 'sess-a', resume: {} as never })
  session.id = 'sess-b'
  await $.tool.call({ tool: 'Read', file_path: '/work/app/new.ts' })
  expect(last(writes, 'sess-b.txt')).toContain('new.ts')
  expect(last(writes, 'sess-b.txt')).not.toContain('old.ts')
  expect(last(writes, 'sess-a.txt')).toContain('old.ts')
})

test('comparison: with no /clear, one session\'s trail keeps every call', async ($, on) => {
  const writes = world(on, { id: 'sess-a' })
  await $.tool.call({ tool: 'Read', file_path: '/work/app/old.ts' })
  await $.tool.call({ tool: 'Read', file_path: '/work/app/new.ts' })
  expect(last(writes, 'sess-a.txt')).toContain('old.ts')
  expect(last(writes, 'sess-a.txt')).toContain('new.ts')
})
