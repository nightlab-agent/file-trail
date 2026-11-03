// Review of 1c1847a (code-reviewer): each finding is a test that fails here, beside a comparison case that passes.
import { expect, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

type Written = { path: string; text: string }
type On = Parameters<TestBody>[1]
const last = (ws: Written[], name: string) => ws.filter(w => w.path.endsWith(`/${name}`)).at(-1)?.text ?? ''

// session.id answers the current id; tool.call holds a 'slow' path until released
const world = (on: On, session: { id: string }, holdCall?: Promise<void>) => {
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
    if (holdCall && JSON.stringify(e).includes('slow')) await holdCall
    return { result: {} }
  })
  return { writes }
}

// Kind 2: `update` runs its function again on a version miss (claude-code.d.ts 15549-15555). The first
// attempt, before the /clear, sets `mine`; the retry, after it, keeps nothing (generation moved) but
// `mine` is still non-zero, so the call is treated as kept: its entry reaches neither file.
test('review-cr2 U1: a call whose state write misses across a /clear is still in the old file', async ($, on) => {
  const session = { id: 'sess-a' }
  const { writes } = world(on, session)
  let release!: () => void
  const held = new Promise<void>(r => { release = r })
  let sets = 0
  on('state.set', async (_, e, next) => {
    if (++sets === 1) await held // the first call's write lands late; a second write moves the version first
    return next(e)
  })
  const first = $.tool.call({ tool: 'Read', file_path: '/work/app/first.ts' })
  for (let i = 0; i < 20; i++) await Promise.resolve()
  await $.tool.call({ tool: 'Read', file_path: '/work/app/second.ts' })
  await $.session.end({ reason: 'clear', sessionId: 'sess-a', resume: {} as never })
  session.id = 'sess-b'
  release()
  await first
  expect(last(writes, 'sess-b.txt')).not.toContain('first.ts')
  expect(last(writes, 'sess-a.txt')).toContain('first.ts')
})
test('review-cr2 U1 comparison: the same late write with no /clear ends with both calls in the file', async ($, on) => {
  const session = { id: 'sess-a' }
  const { writes } = world(on, session)
  let release!: () => void
  const held = new Promise<void>(r => { release = r })
  let sets = 0
  on('state.set', async (_, e, next) => {
    if (++sets === 1) await held
    return next(e)
  })
  const first = $.tool.call({ tool: 'Read', file_path: '/work/app/first.ts' })
  for (let i = 0; i < 20; i++) await Promise.resolve()
  await $.tool.call({ tool: 'Read', file_path: '/work/app/second.ts' })
  release()
  await first
  expect(last(writes, 'sess-a.txt')).toContain('first.ts')
  expect(last(writes, 'sess-a.txt')).toContain('second.ts')
})
test('review-cr2 U1 comparison: a late answer across a /clear with no version miss is in the old file', async ($, on) => {
  const session = { id: 'sess-a' }
  let release!: () => void
  const held = new Promise<void>(r => { release = r })
  const { writes } = world(on, session, held)
  const slow = $.tool.call({ tool: 'Read', file_path: '/work/app/slow.ts' })
  for (let i = 0; i < 20; i++) await Promise.resolve()
  await $.session.end({ reason: 'clear', sessionId: 'sess-a', resume: {} as never })
  session.id = 'sess-b'
  release()
  await slow
  expect(last(writes, 'sess-a.txt')).toContain('slow.ts')
})

// Kind 2: two ends (a /clear, then a resume) before a slow call answers. `ended` names the second;
// the call's generation matches neither, so its entry is dropped from every file.
test('review-cr2 E2: a call that outlives a /clear and a resume is written to the file of the conversation it began in', async ($, on) => {
  const session = { id: 'sess-a' }
  let release!: () => void
  const held = new Promise<void>(r => { release = r })
  const { writes } = world(on, session, held)
  const slow = $.tool.call({ tool: 'Read', file_path: '/work/app/slow.ts' })
  for (let i = 0; i < 20; i++) await Promise.resolve()
  await $.session.end({ reason: 'clear', sessionId: 'sess-a', resume: {} as never })
  session.id = 'sess-b'
  await $.tool.call({ tool: 'Read', file_path: '/work/app/b.ts' })
  await $.session.end({ reason: 'resume', sessionId: 'sess-b', resume: {} as never })
  session.id = 'sess-c'
  release()
  await slow
  expect(last(writes, 'sess-a.txt')).toContain('slow.ts')
  expect(last(writes, 'sess-b.txt')).not.toContain('slow.ts')
  expect(last(writes, 'sess-c.txt')).not.toContain('slow.ts')
})
test('review-cr2 E2 comparison: the same call across one /clear is in the file of the conversation it began in', async ($, on) => {
  const session = { id: 'sess-a' }
  let release!: () => void
  const held = new Promise<void>(r => { release = r })
  const { writes } = world(on, session, held)
  const slow = $.tool.call({ tool: 'Read', file_path: '/work/app/slow.ts' })
  for (let i = 0; i < 20; i++) await Promise.resolve()
  await $.session.end({ reason: 'clear', sessionId: 'sess-a', resume: {} as never })
  session.id = 'sess-b'
  await $.tool.call({ tool: 'Read', file_path: '/work/app/b.ts' })
  release()
  await slow
  expect(last(writes, 'sess-a.txt')).toContain('slow.ts')
})

// Kind 5: the ended conversation's file is written by saveEnded straight through $.fs.write, with no
// `.gitignore` step (writeTrail's only). When the session's first call answers after the /clear, the
// trail file (naming every file touched) lands in the project with nothing ignoring it.
const unguarded = (ws: Written[]) => {
  const dirs = new Set(ws.filter(w => w.path.endsWith('.txt')).map(w => w.path.replace(/\/[^/]+$/, '')))
  return [...dirs].filter(d => !ws.some(w => w.path === `${d}/.gitignore` && w.text === '*\n'))
}
test('review-cr2 G1: the first call of a session answered after a /clear has a .gitignore before its trail file', async ($, on) => {
  const session = { id: 'sess-a' }
  let release!: () => void
  const held = new Promise<void>(r => { release = r })
  const { writes } = world(on, session, held)
  const slow = $.tool.call({ tool: 'Read', file_path: '/work/app/slow.ts' })
  for (let i = 0; i < 20; i++) await Promise.resolve()
  await $.session.end({ reason: 'clear', sessionId: 'sess-a', resume: {} as never })
  session.id = 'sess-b'
  release()
  await slow
  expect(last(writes, 'sess-a.txt')).toContain('slow.ts')
  expect(unguarded(writes)).toEqual([])
})
test('review-cr2 G1 comparison: the same call answered before the /clear has a .gitignore before its trail file', async ($, on) => {
  const session = { id: 'sess-a' }
  const { writes } = world(on, session)
  await $.tool.call({ tool: 'Read', file_path: '/work/app/slow.ts' })
  await $.session.end({ reason: 'clear', sessionId: 'sess-a', resume: {} as never })
  session.id = 'sess-b'
  expect(last(writes, 'sess-a.txt')).toContain('slow.ts')
  expect(unguarded(writes)).toEqual([])
})

// Kind 5, the moved folder: $.fs.write resolves a relative path under the session's working directory
// (claude-code.d.ts 3305); after the session moves into a worktree, a /clear writes the ended
// conversation's file into the worktree's .file-trail with no .gitignore there.
const worldMoving = (on: On, cwdNow: () => string) => {
  const writes: Written[] = []
  on('session.cwd', () => ({ value: cwdNow() }))
  on('session.id', () => ({ value: 'sess-a' }))
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))
  on('ui.status', () => ({ value: undefined }))
  on('tool.call', () => ({ result: {} }))
  on('fs.write', (_, e) => {
    const i = e.path.indexOf('/.file-trail/')
    writes.push({ path: i >= 0 ? cwdNow() + e.path.slice(i) : e.path, text: e.text })
    return { value: undefined }
  })
  return writes
}
test('review-cr2 G2: after a move into a worktree, a /clear writes the ended file beside a .gitignore', async ($, on) => {
  let cwd = '/work/app'
  const writes = worldMoving(on, () => cwd)
  await $.tool.call({ tool: 'Read', file_path: '/work/app/a.ts' })
  cwd = '/work/app/.claude/worktrees/fix-1' // EnterWorktree
  await $.session.end({ reason: 'clear', sessionId: 'sess-a', resume: {} as never })
  expect(writes.some(w => w.path === '/work/app/.claude/worktrees/fix-1/.file-trail/sess-a.txt')).toBe(true)
  expect(unguarded(writes)).toEqual([])
})
test('review-cr2 G2 comparison: after the same move, a tool call writes its file beside a .gitignore', async ($, on) => {
  let cwd = '/work/app'
  const writes = worldMoving(on, () => cwd)
  await $.tool.call({ tool: 'Read', file_path: '/work/app/a.ts' })
  cwd = '/work/app/.claude/worktrees/fix-1'
  await $.tool.call({ tool: 'Read', file_path: '/work/app/.claude/worktrees/fix-1/b.ts' })
  expect(unguarded(writes)).toEqual([])
})
