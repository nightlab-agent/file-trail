import { expect, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

import { groupLine } from './register'

type Written = { path: string; text: string }
type On = Parameters<TestBody>[1]
const RUN = { origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } } as const

const world = (on: On, session: { id: string }, holdId?: Promise<void>) => {
  const writes: Written[] = []
  const statuses: (string | undefined)[] = []
  let reads = 0
  on('session.cwd', () => ({ value: '/work/app' }))
  on('session.id', async () => {
    if (holdId && ++reads === 1) await holdId
    return { value: session.id }
  })
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))
  on('fs.write', (_, e) => {
    writes.push({ path: e.path, text: e.text })
    return { value: undefined }
  })
  on('ui.status', (_, e) => {
    statuses.push(e.text)
    return { value: undefined }
  })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('tool.call', () => ({ result: {} }))
  return { writes, statuses }
}
const last = (writes: Written[], name: string) => writes.filter(w => w.path.endsWith(`/${name}`)).at(-1)?.text ?? ''

// Kind 3/4: the engine names two in-process ends that move to a new session id, `clear` and `resume`
// (claude-code.d.ts 2.1.310, SessionEndInput.sessionId: "after a /clear or a resume the process goes on
// under another"); the mod resets on `clear` only.
test('review R1: after an in-process resume, the resumed session\'s trail holds none of the old conversation', async ($, on) => {
  const session = { id: 'sess-a' }
  const { writes } = world(on, session)
  await $.tool.call({ tool: 'Read', file_path: '/work/app/old.ts' })
  await $.session.end({ reason: 'resume', sessionId: 'sess-a', resume: {} as never })
  session.id = 'sess-b'
  await $.tool.call({ tool: 'Read', file_path: '/work/app/new.ts' })
  expect(last(writes, 'sess-b.txt')).not.toContain('old.ts')
})
test('review R1 comparison: the same after a /clear', async ($, on) => {
  const session = { id: 'sess-a' }
  const { writes } = world(on, session)
  await $.tool.call({ tool: 'Read', file_path: '/work/app/old.ts' })
  await $.session.end({ reason: 'clear', sessionId: 'sess-a', resume: {} as never })
  session.id = 'sess-b'
  await $.tool.call({ tool: 'Read', file_path: '/work/app/new.ts' })
  expect(last(writes, 'sess-b.txt')).not.toContain('old.ts')
})

// Kind 1: a call kept in the old conversation reads the session id after the /clear swapped it.
test('review R2: a call kept before /clear whose session id comes back after it writes no old call into the new file', async ($, on) => {
  const session = { id: 'sess-a' }
  let release!: () => void
  const held = new Promise<void>(r => { release = r })
  const { writes } = world(on, session, held)
  const old = $.tool.call({ tool: 'Read', file_path: '/work/app/old.ts' })
  for (let i = 0; i < 20; i++) await Promise.resolve()
  await $.session.end({ reason: 'clear', sessionId: 'sess-a', resume: {} as never })
  session.id = 'sess-b'
  release()
  await old
  expect(last(writes, 'sess-b.txt')).not.toContain('old.ts')
})
test('review R2 comparison: the same call answered before the /clear stays in the old file only', async ($, on) => {
  const session = { id: 'sess-a' }
  const { writes } = world(on, session)
  await $.tool.call({ tool: 'Read', file_path: '/work/app/old.ts' })
  await $.session.end({ reason: 'clear', sessionId: 'sess-a', resume: {} as never })
  session.id = 'sess-b'
  expect(last(writes, 'sess-b.txt')).not.toContain('old.ts')
  expect(last(writes, 'sess-a.txt')).toContain('old.ts')
})

// The command's count is the kept list's length, capped at KEEP (1000).
test('review R3: after 1001 calls the command says 1001 calls this session', { timeoutMs: 60000 }, async ($, on) => {
  world(on, { id: 's' })
  for (let i = 0; i < 1001; i++) await $.tool.call({ tool: 'Read', file_path: `/work/app/f${i}.ts` })
  const r = await $.command.run({ command: 'file-trail', args: '', ...RUN })
  expect(r.text).toBe('File trail opened: 1001 calls this session, 0 blocked.')
})
test('review R3 comparison: after 3 calls the command says 3', async ($, on) => {
  world(on, { id: 's' })
  for (let i = 0; i < 3; i++) await $.tool.call({ tool: 'Read', file_path: `/work/app/f${i}.ts` })
  const r = await $.command.run({ command: 'file-trail', args: '', ...RUN })
  expect(r.text).toBe('File trail opened: 3 calls this session, 0 blocked.')
})

// house-style 7: the status line is cut at a UTF-16 offset.
const lone = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/
test('review R4: a status line cut at 80 never ends in half an emoji', async ($, on) => {
  const { statuses } = world(on, { id: 's' })
  await $.tool.call({ tool: 'Read', file_path: `/${'a'.repeat(73)}😄.md` })
  expect(statuses.at(-1)).not.toContain('\uFFFD')
  expect(lone.test(statuses.at(-1) ?? '')).toBe(false)
})
test('review R4 comparison: the same length in ASCII is cut cleanly', async ($, on) => {
  const { statuses } = world(on, { id: 's' })
  await $.tool.call({ tool: 'Read', file_path: `/${'a'.repeat(73)}xx.md` })
  expect(statuses.at(-1)!.length).toBe(80)
  expect(statuses.at(-1)).not.toContain('\uFFFD')
  expect(lone.test(statuses.at(-1)!)).toBe(false)
})

// The group line's width rule skips the first name.
test('review R5: a long first name is cut to the width too', () => {
  expect(groupLine(['src/' + 'x'.repeat(100) + '.ts', 'b.ts'], 40).length).toBeLessThanOrEqual(40)
})
test('review R5 comparison: a long second name is cut to the width', () => {
  expect(groupLine(['a.ts', 'src/' + 'x'.repeat(100) + '.ts'], 40).length).toBeLessThanOrEqual(40)
})
