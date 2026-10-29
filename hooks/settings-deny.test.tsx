import { expect, test } from 'claude-code/testing'

type Written = { path: string; text: string }

// A settings PreToolUse hook runs beneath every hooks module; its deny reaches tool.call as an error result.
const world = (on: any, pluginDeny?: RegExp) => {
  const writes: Written[] = []
  on('session.cwd', () => ({ value: '/work/app' }))
  on('session.id', () => ({ value: 'sess-1' }))
  on('fs.write', (_: unknown, e: Written) => {
    writes.push({ path: e.path, text: e.text })
    return { value: undefined }
  })
  on('ui.status', () => ({ value: undefined }))
  on('tool.call', (_: unknown, e: unknown) => (pluginDeny?.test(JSON.stringify(e)) ? { deny: 'blocked by a rule' } : { result: {} }))
  return writes
}
const trail = (ws: Written[]) => ws.filter(w => w.path.endsWith('sess-1.txt')).at(-1)!.text

test('a call a settings PreToolUse hook denies is marked blocked', async ($, on) => {
  const writes = world(on)
  on('classic.PreToolUse', (_: unknown, e: unknown) => (JSON.stringify(e).includes('.env') ? { deny: 'no secrets' } : {}))
  await $.tool.call({ tool: 'Read', file_path: '/work/app/.env' })
  expect(trail(writes)).toContain('.env  (blocked)')
})

test('comparison: a call a plugin-level hook denies is marked blocked', async ($, on) => {
  const writes = world(on, /\.env/)
  await $.tool.call({ tool: 'Read', file_path: '/work/app/.env' })
  expect(trail(writes)).toContain('.env  (blocked)')
})

test('comparison: a call the PreToolUse hook lets through is marked ok', async ($, on) => {
  const writes = world(on)
  on('classic.PreToolUse', (_: unknown, e: unknown) => (JSON.stringify(e).includes('.env') ? { deny: 'no secrets' } : {}))
  await $.tool.call({ tool: 'Read', file_path: '/work/app/a.ts' })
  expect(trail(writes)).toContain('a.ts')
  expect(trail(writes)).not.toContain('(blocked)')
})
