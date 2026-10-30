import { expect, test } from 'claude-code/testing'

// Kind 5 (with 4): $.fs.write resolves a relative path "under the session's working directory"
// (claude-code.d.ts 2.1.310, lines 3305-3306), and the session's directory moves with /cd or a worktree
// move (EnterWorktree; lines 2836-2837). The kit resolves relative paths against its own process
// folder, so this hook re-roots each write at the cwd the engine answers at that moment: the engine's
// documented resolution, the mod's code untouched.
type Written = { path: string; text: string }
const world = (on: any, cwdNow: () => string) => {
  const writes: Written[] = []
  on('session.cwd', () => ({ value: cwdNow() }))
  on('session.id', () => ({ value: 'sess-1' }))
  on('ui.status', () => ({ value: undefined }))
  on('tool.call', () => ({ result: {} }))
  on('fs.write', (_: unknown, e: Written) => {
    const i = e.path.indexOf('/.file-trail/')
    writes.push({ path: i >= 0 ? cwdNow() + e.path.slice(i) : e.path, text: e.text })
    return { value: undefined }
  })
  return writes
}
const unguarded = (ws: Written[]) => {
  const dirs = new Set(ws.filter(w => w.path.endsWith('.txt')).map(w => w.path.replace(/\/[^/]+$/, '')))
  return [...dirs].filter(d => !ws.some(w => w.path === `${d}/.gitignore`))
}

test('review: after the session moves into a worktree, the trail folder there gets its .gitignore too', async ($, on) => {
  let cwd = '/work/app'
  const writes = world(on, () => cwd)
  await $.tool.call({ tool: 'Read', file_path: '/work/app/a.ts' })
  cwd = '/work/app/.claude/worktrees/fix-1' // EnterWorktree
  await $.tool.call({ tool: 'Read', file_path: '/work/app/.claude/worktrees/fix-1/secret-plan.md' })
  expect(unguarded(writes)).toEqual([])
})

test('comparison: a session that stays in one folder has a .gitignore beside every trail file', async ($, on) => {
  const writes = world(on, () => '/work/app')
  await $.tool.call({ tool: 'Read', file_path: '/work/app/a.ts' })
  await $.tool.call({ tool: 'Read', file_path: '/work/app/b.ts' })
  expect(unguarded(writes)).toEqual([])
})
