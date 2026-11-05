import { expect, test } from 'claude-code/testing'

// `$.session.cwd()` is the directory the session runs in, and a relative `$.fs.write` path resolves under it;
// a shell `cd` moves it. `$.session.root()` is the project: "A shell `cd` during the session does not move it";
// /cd and a worktree move do (index.d.ts, `session.root`). The kit has already resolved a relative path
// against its own process folder when the write reaches this world, so the part under that folder is
// re-rooted at the cwd of that moment, as the engine does. Everything the mod itself made absolute is
// under the /work or / roots of these tests, or names E:, and is kept.
type Written = { path: string; text: string }
const world = (on: any, cwdNow: () => string, rootNow: () => string) => {
  const writes: Written[] = []
  on('session.cwd', () => ({ value: cwdNow() }))
  on('session.root', () => ({ value: rootNow() }))
  on('session.id', () => ({ value: 'sess-1' }))
  on('ui.status', () => ({ value: undefined }))
  on('tool.call', () => ({ result: {} }))
  on('fs.write', (_: unknown, e: Written) => {
    const at = Math.max(e.path.indexOf('/.file-trail/'), e.path.indexOf('/logs/trail/'))
    const kept = at <= 0 || e.path.startsWith('/work') || e.path.startsWith('E:')
    writes.push({ path: kept ? e.path : cwdNow().replace(/\/$/, '') + e.path.slice(at), text: e.text })
    return { value: undefined }
  })
  return writes
}
const folders = (ws: Written[]) => [...new Set(ws.map(w => w.path.replace(/\/[^/]+$/, '')))]

test('a shell cd leaves the trail in one folder under the project', async ($, on) => {
  let cwd = '/work/app'
  const writes = world(on, () => cwd, () => '/work/app')
  await $.tool.call({ tool: 'Read', file_path: '/work/app/a.ts' })
  cwd = '/work/app/hooks' // cd hooks in a Bash call
  await $.tool.call({ tool: 'Read', file_path: '/work/app/hooks/b.ts' })
  expect(folders(writes)).toEqual(['/work/app/.file-trail'])
  expect(writes.filter(w => w.path.endsWith('.gitignore')).length).toBe(1)
})

test('a session started in a subfolder after a shell cd keeps one folder too, on a /clear as well', async ($, on) => {
  let cwd = '/work/app'
  const writes = world(on, () => cwd, () => '/work/app')
  on('session.end', (_: unknown, e: { sessionId: string }) => ({ sessionId: e.sessionId }))
  await $.tool.call({ tool: 'Read', file_path: '/work/app/a.ts' })
  cwd = '/work/app/deep/er'
  await $.session.end({ reason: 'clear', sessionId: 'sess-1', resume: {} as never })
  expect(folders(writes)).toEqual(['/work/app/.file-trail'])
})

test('comparison: a move of the project itself (/cd, a worktree) moves the trail, with a .gitignore there', async ($, on) => {
  let cwd = '/work/app'
  let root = '/work/app'
  const writes = world(on, () => cwd, () => root)
  await $.tool.call({ tool: 'Read', file_path: '/work/app/a.ts' })
  cwd = root = '/work/app/.claude/worktrees/fix-1'
  await $.tool.call({ tool: 'Read', file_path: '/work/app/.claude/worktrees/fix-1/b.ts' })
  expect(folders(writes)).toEqual(['/work/app/.file-trail', '/work/app/.claude/worktrees/fix-1/.file-trail'])
  expect(writes.filter(w => w.path.endsWith('.gitignore')).length).toBe(2)
})

test('a relative dir option is under the project too', { options: { dir: 'logs/trail' } }, async ($, on) => {
  let cwd = '/work/app'
  const writes = world(on, () => cwd, () => '/work/app')
  await $.tool.call({ tool: 'Read', file_path: '/work/app/a.ts' })
  cwd = '/work/app/hooks'
  await $.tool.call({ tool: 'Read', file_path: '/work/app/hooks/b.ts' })
  expect(folders(writes)).toEqual(['/work/app/logs/trail'])
})

test('comparison: an absolute dir is left as given, a Windows one too', { options: { dir: 'E:\\trails\\.file-trail' } }, async ($, on) => {
  const writes = world(on, () => '/work/app', () => '/work/app')
  await $.tool.call({ tool: 'Read', file_path: '/work/app/a.ts' })
  // on this Linux kit a drive path reads as relative and gets its process folder in front
  expect(writes.at(-1)!.path.endsWith('E:\\trails\\.file-trail/sess-1.txt')).toBe(true)
  expect(writes.at(-1)!.path).not.toContain('/work/app')
})

test('a root ending in a slash, the file system\'s own root, gives no double slash', async ($, on) => {
  const writes = world(on, () => '/', () => '/')
  await $.tool.call({ tool: 'Read', file_path: '/a.ts' })
  expect(writes.at(-1)!.path).toBe('/.file-trail/sess-1.txt')
})
