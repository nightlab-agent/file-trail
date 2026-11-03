import { expect, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

import { groupLine, shorten } from './register'

type Written = { path: string; text: string }
const RUN = { origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } } as const

const world = (on: Parameters<TestBody>[1], session: { id: string }, hold?: Promise<void>) => {
  const writes: Written[] = []
  const statuses: (string | undefined)[] = []
  on('session.cwd', () => ({ value: '/work/app' }))
  on('session.id', () => ({ value: session.id }))
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
  on('command.register', () => ({ value: { command: 'file-trail' } }))
  on('tool.call', async (_, e) => {
    if (hold && JSON.stringify(e).includes('slow')) await hold
    return { result: {} }
  })
  return { writes, statuses }
}
const last = (ws: Written[], name: string) => ws.filter(w => w.path.endsWith(`/${name}`)).at(-1)?.text ?? ''

// Kind 1: a call (a background subagent's Read) whose answer comes back after a /clear.
test('review-ts: a call that answers after /clear is not in the new conversation\'s trail', async ($, on) => {
  const session = { id: 'sess-a' }
  let release!: () => void
  const held = new Promise<void>(r => { release = r })
  const { writes } = world(on, session, held)
  const slow = $.tool.call({ tool: 'Read', file_path: '/work/app/slow-old.ts' })
  for (let i = 0; i < 20; i++) await Promise.resolve()
  await $.session.end({ reason: 'clear', sessionId: 'sess-a', resume: {} as never })
  session.id = 'sess-b'
  release()
  await slow
  expect(last(writes, 'sess-b.txt')).not.toContain('slow-old.ts')
  const r = await $.command.run({ command: 'file-trail', args: '', ...RUN })
  expect(r.text).toBe('File trail opened: 0 calls this session, 0 blocked.')
})

test('review-ts comparison: the same call answered before /clear stays out of the new trail', async ($, on) => {
  const session = { id: 'sess-a' }
  const { writes } = world(on, session, Promise.resolve())
  await $.tool.call({ tool: 'Read', file_path: '/work/app/slow-old.ts' })
  await $.session.end({ reason: 'clear', sessionId: 'sess-a', resume: {} as never })
  session.id = 'sess-b'
  const r = await $.command.run({ command: 'file-trail', args: '', ...RUN })
  expect(r.text).toBe('File trail opened: 0 calls this session, 0 blocked.')
  expect(last(writes, 'sess-b.txt')).not.toContain('slow-old.ts')
})

// Kind 2: the count shown is the kept list's length, capped at KEEP.
test('review-ts: past 1000 calls the command and the file still count every call', async ($, on) => {
  const { writes } = world(on, { id: 'sess-1' })
  for (let i = 0; i < 1001; i++) await $.tool.call({ tool: 'Read', file_path: `/work/app/f${i}.ts` })
  const r = await $.command.run({ command: 'file-trail', args: '', ...RUN })
  expect(last(writes, 'sess-1.txt').split('\n')[0]).toContain('1001 calls')
  expect(r.text).toBe('File trail opened: 1001 calls this session, 0 blocked.')
})

test('review-ts comparison: under 1000 calls the counts are right', async ($, on) => {
  const { writes } = world(on, { id: 'sess-1' })
  for (let i = 0; i < 999; i++) await $.tool.call({ tool: 'Read', file_path: `/work/app/f${i}.ts` })
  const r = await $.command.run({ command: 'file-trail', args: '', ...RUN })
  expect(last(writes, 'sess-1.txt').split('\n')[0]).toContain('999 calls')
  expect(r.text).toBe('File trail opened: 999 calls this session, 0 blocked.')
})

// Kind 2: .slice(0, 80) counts UTF-16 units; an emoji at the cut leaves a lone surrogate.
const wellFormed = (s: string) => { const c = s.charCodeAt(s.length - 1); return !(c >= 0xd800 && c <= 0xdfff) && c !== 0xfffd }
test('review-ts: the status line never ends in half an emoji', async ($, on) => {
  const { statuses } = world(on, { id: 'sess-1' })
  // 'Read ' is 5 units; 74 more puts the emoji's high half at index 79, the last one kept
  await $.tool.call({ tool: 'Read', file_path: `/work/app/${'a'.repeat(74)}😀.md` })
  expect(wellFormed(statuses.at(-1)!)).toBe(true)
})
test('review-ts comparison: an ASCII path at the cut is well formed', async ($, on) => {
  const { statuses } = world(on, { id: 'sess-1' })
  await $.tool.call({ tool: 'Read', file_path: `/work/app/${'a'.repeat(74)}bb.md` })
  expect(wellFormed(statuses.at(-1)!)).toBe(true)
})

// Kind 2: the group line is cut by .length, but a CJK character takes two terminal columns.
const cols = (s: string) => [...s].reduce((n, ch) => n + (/[\u3000-\u9FFF\uF900-\uFAFF]/.test(ch) ? 2 : 1), 0)
test('review-ts: a group line of CJK names fits the terminal width', () => {
  const names = Array.from({ length: 10 }, (_, i) => `資料/設計書${i}.md`)
  expect(cols(groupLine(names, 60))).toBeLessThanOrEqual(60)
})
test('review-ts comparison: a group line of ASCII names fits', () => {
  const names = Array.from({ length: 10 }, (_, i) => `docs/design${i}.md`)
  expect(cols(groupLine(names, 60))).toBeLessThanOrEqual(60)
})

// Kind 4: shorten() joins with '/', so a Windows working folder never matches.
test('review-ts: a Windows path under the working folder is shown relative', () => {
  expect(shorten('C:\\work\\app\\src\\a.ts', 'C:\\work\\app')).toBe('src\\a.ts')
})
test('review-ts comparison: the POSIX path is shown relative', () => {
  expect(shorten('/work/app/src/a.ts', '/work/app')).toBe('src/a.ts')
})
