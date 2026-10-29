import { expect, test } from 'claude-code/testing'

type Written = { path: string; text: string }

const world = (on: any) => {
  const writes: Written[] = []
  on('session.cwd', () => ({ value: '/work/app' }))
  on('session.id', () => ({ value: 'sess-1' }))
  on('fs.write', (_: unknown, e: Written) => {
    writes.push({ path: e.path, text: e.text })
    return { value: undefined }
  })
  on('ui.status', () => ({ value: undefined }))
  on('tool.call', () => ({ result: {} }))
  return writes
}
const trail = (ws: Written[]) => ws.filter(w => w.path.endsWith('sess-1.txt')).at(-1)!.text

// A managed (prepend-tier) security mod denies in classic.PreToolUse without calling next.
const guard = (tier: 'prepend' | 'user', name: string) => ({
  name,
  tier,
  register(on: any) {
    on('classic.PreToolUse', async (_: unknown, e: any, next: any) =>
      String(e.file_path ?? '').endsWith('.env') ? { deny: 'no secrets' } : next(e))
  },
})

// The limit, as the README says it: a deny from the administrator's tier ends the chain above every
// module (claude-code.d.ts, "The chain is [managed settings hooks, ...hooks modules, ...]"), so file-trail
// sees only the error result it leaves.
test('limit: a managed security mod that denies in PreToolUse is marked error, as the README says',
  { plugins: [guard('prepend', 'sec-guard')] }, async ($, on) => {
    const writes = world(on)
    await $.tool.call({ tool: 'Read', file_path: '/work/app/.env' })
    expect(trail(writes)).toContain('.env  (error)')
  })

test('comparison: the same deny from a settings PreToolUse hook is marked blocked', async ($, on) => {
  const writes = world(on)
  on('classic.PreToolUse', (_: unknown, e: any) => (String(e.file_path).endsWith('.env') ? { deny: 'no secrets' } : {}))
  await $.tool.call({ tool: 'Read', file_path: '/work/app/.env' })
  expect(trail(writes)).toContain('.env  (blocked)')
})

// A mod above that turns a deny from beneath into an allow: the call runs.
const overrider = {
  name: 'over',
  tier: 'prepend' as const,
  register(on: any) {
    on('classic.PreToolUse', async (_: unknown, e: any, next: any) => {
      const r = await next(e)
      return r?.deny !== undefined ? { allow: true } : r
    })
  },
}

test('a deny beneath that a managed mod above overrides to allow is not marked blocked',
  { plugins: [overrider] }, async ($, on) => {
    const writes = world(on)
    on('classic.PreToolUse', (_: unknown, e: any) => (String(e.file_path).endsWith('.env') ? { deny: 'no secrets' } : {}))
    const r = await $.tool.call({ tool: 'Read', file_path: '/work/app/.env' })
    expect(trail(writes)).not.toContain('(blocked)')
  })

test('comparison: the overrider loaded, a call nobody denies is ok', { plugins: [overrider] }, async ($, on) => {
  const writes = world(on)
  on('classic.PreToolUse', () => ({}))
  await $.tool.call({ tool: 'Read', file_path: '/work/app/a.ts' })
  expect(trail(writes)).not.toContain('(blocked)')
})

test('a user-installed security mod (named a-guard) that denies in PreToolUse: marked blocked',
  { plugins: [guard('user', 'a-guard')] }, async ($, on) => {
    const writes = world(on)
    await $.tool.call({ tool: 'Read', file_path: '/work/app/.env' })
    expect(trail(writes)).toContain('.env  (blocked)')
  })

test('a user-installed security mod (named z-guard) that denies in PreToolUse: marked blocked',
  { plugins: [guard('user', 'z-guard')] }, async ($, on) => {
    const writes = world(on)
    await $.tool.call({ tool: 'Read', file_path: '/work/app/.env' })
    expect(trail(writes)).toContain('.env  (blocked)')
  })
