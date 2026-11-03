// Review of 9ea8268: each finding is a test that failed there, beside a comparison case that passed.
import { expect, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

import { groupLine, shorten, width } from './register'

type Written = { path: string; text: string }
type On = Parameters<TestBody>[1]
// The test runtime has setTimeout; the engine's declarations (lib es2023) type none.
declare const setTimeout: (fn: (v?: unknown) => void, ms: number) => unknown
const last = (ws: Written[], name: string) => ws.filter(w => w.path.endsWith(`/${name}`)).at(-1)?.text ?? ''

// The engine's end step (next(e)) moves the process to the next session id and yields before it returns.
const worldEnd = (on: On, session: { id: string }, swapInEnd: boolean) => {
  const writes: Written[] = []
  let release!: () => void
  const held = new Promise<void>(r => { release = r })
  let reads = 0
  on('session.cwd', () => ({ value: '/work/app' }))
  on('session.id', async () => {
    if (++reads === 1) await held
    return { value: session.id }
  })
  on('session.end', async (_, e) => {
    if (swapInEnd) {
      session.id = 'sess-b'
      release()
      await new Promise(r => setTimeout(r, 20))
    }
    return { sessionId: e.sessionId }
  })
  on('fs.write', (_, e) => {
    writes.push({ path: e.path, text: e.text })
    return { value: undefined }
  })
  on('ui.status', () => ({ value: undefined }))
  on('tool.call', () => ({ result: {} }))
  return { writes, release: () => release() }
}

// session.id held on its first read (as review-s418's R2 world does), or tool.call held for a 'slow' path
const world = (on: On, session: { id: string }, holdId?: Promise<void>, holdCall?: Promise<void>) => {
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
  on('tool.call', async (_, e) => {
    if (holdCall && JSON.stringify(e).includes('slow')) await holdCall
    return { result: {} }
  })
  return { writes, statuses }
}

test('review-tsr X1: id swapped inside the end step: an old call is not written into the next file', async ($, on) => {
  const session = { id: 'sess-a' }
  const { writes } = worldEnd(on, session, true)
  const old = $.tool.call({ tool: 'Read', file_path: '/work/app/old.ts' })
  for (let i = 0; i < 20; i++) await Promise.resolve()
  await $.session.end({ reason: 'clear', sessionId: 'sess-a', resume: {} as never })
  await old
  expect(last(writes, 'sess-b.txt')).not.toContain('old.ts')
})
test('review-tsr X1 comparison: id swapped after the end chain (the PR\'s own R2 shape)', async ($, on) => {
  const session = { id: 'sess-a' }
  const w = worldEnd(on, session, false)
  const old = $.tool.call({ tool: 'Read', file_path: '/work/app/old.ts' })
  for (let i = 0; i < 20; i++) await Promise.resolve()
  await $.session.end({ reason: 'clear', sessionId: 'sess-a', resume: {} as never })
  session.id = 'sess-b'
  w.release()
  await old
  expect(last(w.writes, 'sess-b.txt')).not.toContain('old.ts')
})

// K1: a call answered and kept in conversation A (its entry is in A's list), whose session id read
// straddles the /clear. The generation check skips the write, so A's own file never names it.
test('review-cr K1: a call kept before /clear whose session id comes back after it is in the old file', async ($, on) => {
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
  expect(last(writes, 'sess-a.txt')).toContain('old.ts')
})
test('review-cr K1 comparison: the same call with its session id read before the /clear is in the old file', async ($, on) => {
  const session = { id: 'sess-a' }
  const { writes } = world(on, session)
  await $.tool.call({ tool: 'Read', file_path: '/work/app/old.ts' })
  await $.session.end({ reason: 'clear', sessionId: 'sess-a', resume: {} as never })
  session.id = 'sess-b'
  expect(last(writes, 'sess-a.txt')).toContain('old.ts')
})

test('review-tsr X2: a forward-slash path under a Windows working folder is shown relative', () => {
  expect(shorten('C:/work/app/src/a.ts', 'C:\\work\\app')).toBe('src/a.ts')
})
test('review-tsr X2b: a lower-case drive letter under a Windows working folder is shown relative', () => {
  expect(shorten('c:\\work\\app\\src\\a.ts', 'C:\\work\\app')).toBe('src\\a.ts')
})
test('review-tsr X2 comparison: the backslash path is shown relative', () => {
  expect(shorten('C:\\work\\app\\src\\a.ts', 'C:\\work\\app')).toBe('src\\a.ts')
})

// K3: Windows paths are compared case-sensitively and by one separator
test('review-cr K3: a Windows path with a lower-case drive letter under the working folder is shown relative', () => {
  expect(shorten('c:\\work\\app\\src\\a.ts', 'C:\\work\\app')).toBe('src\\a.ts')
})
test('review-cr K3b: a Windows path written with forward slashes under the working folder is shown relative', () => {
  expect(shorten('C:/work/app/src/a.ts', 'C:\\work\\app')).toBe('src/a.ts')
})
test('review-cr K3 comparison: the same Windows path in the same case and separator is shown relative', () => {
  expect(shorten('C:\\work\\app\\src\\a.ts', 'C:\\work\\app')).toBe('src\\a.ts')
})

test('review-tsr X3: an emoji of the Basic Plane (U+2705, East Asian Width W) takes two columns', () => {
  expect(width('\u2705')).toBe(2)
  const line = groupLine(['\u2705'.repeat(30)], 24)
  // room 20: '  ⎿ ' (4) + seven checks (14) + '…' (1) = 19 columns; an eighth would need 21
  expect(line).toBe(`  ⎿ ${'\u2705'.repeat(7)}…`)
  expect(width(line)).toBeLessThanOrEqual(20)
})
test('review-tsr X3 comparison: a CJK letter takes two columns', () => {
  expect(width('\u4E2D')).toBe(2)
})

// Status line: "cut whole letters to the terminal's columns" (commit 9ea8268)
const RI = /[\u{1F1E6}-\u{1F1FF}]/u
test('review-cr S1: the status line never ends in half a flag emoji', async ($, on) => {
  const { statuses } = world(on, { id: 's' })
  // 'Read ' 5 + 72 = 77 units; the flag's two letters take 77-78 and 79-80
  await $.tool.call({ tool: 'Read', file_path: `/work/app/${'a'.repeat(72)}🇯🇵.md` })
  const s = statuses.at(-1)!
  const tail = [...s].at(-1)!
  expect(RI.test(tail) && !RI.test([...s].at(-2)!)).toBe(false)
})
test('review-cr S2: a status line of Chinese names fits 80 columns', async ($, on) => {
  const { statuses } = world(on, { id: 's' })
  await $.tool.call({ tool: 'Read', file_path: `/work/app/${'設計書'.repeat(25)}.md` })
  expect(width(statuses.at(-1)!)).toBeLessThanOrEqual(80)
})
test('review-cr S comparison: an ASCII status line fits 80 columns and ends whole', async ($, on) => {
  const { statuses } = world(on, { id: 's' })
  await $.tool.call({ tool: 'Read', file_path: `/work/app/${'a'.repeat(200)}.md` })
  expect(width(statuses.at(-1)!)).toBeLessThanOrEqual(80)
})
