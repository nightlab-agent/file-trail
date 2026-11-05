import { expect, test } from 'claude-code/testing'

import { refusedVerdict } from './register'

// How a permission deny reaches tool.call, read from Claude Code 2.1.312 (declarations and binary):
// - Read, Write and Edit: a deny rule on the path is refused in the tool's own input check, inside core,
//   before any PreToolUse hook and before tool.check. No tool.check with this call's id is raised; core
//   answers { result: 'Error: <m>', text: '<tool_use_error><m></tool_use_error>', isError: true }.
// - Glob, Grep, NotebookEdit, and any other refusal at the permission step: tool.check carries the call's
//   id and the verdict, then core answers { result: 'Error: <m>', text: '<m>', isError: true }.
// - An ask nobody can answer: tool.check says ask with no approver, then a PermissionRequest hook or the
//   engine refuses, and core answers as above.
// The kit always raises tool.check for a call once a hook listens, even where the real engine would have
// stopped at the input check, so `refusedInInputCheck` answers that raised check with allow (as nothing in
// the real engine would mark it) and keeps the deny for the query, which is what the real engine answers.
type Written = { path: string; text: string }
const MESSAGE = 'File is in a directory that is denied by your permission settings.'

const world = (on: any) => {
  const writes: Written[] = []
  const statuses: (string | undefined)[] = []
  on('session.cwd', () => ({ value: '/work/app' }))
  on('session.id', () => ({ value: 'sess-1' }))
  on('fs.write', (_: unknown, e: Written) => {
    writes.push({ path: e.path, text: e.text })
    return { value: undefined }
  })
  on('ui.status', (_: unknown, e: { text?: string }) => {
    statuses.push(e.text)
    return { value: undefined }
  })
  return { writes, statuses }
}
const trail = (ws: Written[]) => ws.filter(w => w.path.endsWith('sess-1.txt')).at(-1)!.text

/** The engine's permission settings hold a deny rule for `.env`, a Read rule unless `tools` says other:
 * the query answers for the tool it names, as checkPermissions does, so an Edit asked about a Read rule
 * says allow, though Edit's and Write's input check refuses the path. */
const refusedInInputCheck = (on: any, rule: RegExp = /\.env/, tools = ['Read']) => {
  const queries: unknown[] = []
  on('tool.check', (_: unknown, e: { tool: string; tool_use_id?: string; input: unknown }) => {
    if (e.tool_use_id !== undefined) return { decision: 'allow' }
    queries.push(e.input)
    return tools.includes(e.tool) && rule.test(JSON.stringify(e.input)) ? { decision: 'deny', reason: MESSAGE, rule: 'Read(./.env)' } : { decision: 'allow' }
  })
  on('tool.call', (_: unknown, e: unknown) =>
    rule.test(JSON.stringify(e))
      ? { result: `Error: ${MESSAGE}`, text: `<tool_use_error>${MESSAGE}</tool_use_error>`, isError: true }
      : /missing/.test(JSON.stringify(e))
        ? { result: 'File does not exist.', text: 'File does not exist.', isError: true }
        : { result: {} },
  )
  return queries
}

test('a Read a deny rule refuses in its input check is marked blocked, with no tool.check for the call', async ($, on) => {
  const { writes, statuses } = world(on)
  refusedInInputCheck(on)
  const r = await $.tool.call({ tool: 'Read', file_path: '/work/app/.env' })
  expect(r.isError).toBe(true)
  expect(trail(writes)).toContain('x Read         .env  (blocked)')
  expect(statuses.at(-1)).toBe('Read .env (blocked)')
})

test('the same for a Write and an Edit', async ($, on) => {
  const { writes } = world(on)
  refusedInInputCheck(on)
  await $.tool.call({ tool: 'Write', file_path: '/work/app/.env', content: 'x' })
  await $.tool.call({ tool: 'Edit', file_path: '/work/app/.env', old_string: 'a', new_string: 'b' })
  expect(trail(writes)).toContain('x Write        .env  (blocked)')
  expect(trail(writes)).toContain('x Edit         .env  (blocked)')
})

test('an Edit or a Write its own deny rule refuses is marked blocked too', async ($, on) => {
  const { writes } = world(on)
  refusedInInputCheck(on, /\.env/, ['Edit', 'Write'])
  await $.tool.call({ tool: 'Edit', file_path: '/work/app/.env', old_string: 'a', new_string: 'b' })
  await $.tool.call({ tool: 'Write', file_path: '/work/app/.env', content: 'x' })
  expect(trail(writes)).toContain('x Edit         .env  (blocked)')
  expect(trail(writes)).toContain('x Write        .env  (blocked)')
})

test('a failed Edit is asked about as itself, then as a Read of the path alone', async ($, on) => {
  world(on)
  const queries = refusedInInputCheck(on)
  await $.tool.call({ tool: 'Edit', file_path: '/work/app/missing.ts', old_string: 'a', new_string: 'b' })
  expect(queries).toEqual([{ file_path: '/work/app/missing.ts', old_string: 'a', new_string: 'b' }, { file_path: '/work/app/missing.ts' }])
})

test('comparison: a failed NotebookEdit under a Read rule is not asked about as a Read', async ($, on) => {
  const { writes } = world(on)
  const queries = refusedInInputCheck(on, /\.env/)
  await $.tool.call({ tool: 'NotebookEdit', notebook_path: '/work/app/.env.ipynb', new_source: 'x' } as never)
  expect(trail(writes)).toContain('! NotebookEdit .env.ipynb  (error)')
  expect(queries.length).toBe(1)
})

test('the question put to the engine carries the call\'s arguments and none of the envelope', async ($, on) => {
  world(on)
  const queries = refusedInInputCheck(on)
  await $.tool.call({ tool: 'Read', file_path: '/work/app/.env', limit: 5 } as never)
  expect(queries).toEqual([{ file_path: '/work/app/.env', limit: 5 }])
})

test('comparison: a real failure on a path no rule denies stays an error', async ($, on) => {
  const { writes } = world(on)
  refusedInInputCheck(on)
  await $.tool.call({ tool: 'Read', file_path: '/work/app/missing.ts' })
  expect(trail(writes)).toContain('! Read         missing.ts  (error)')
})

test('comparison: a call that went through asks the engine nothing', async ($, on) => {
  const { writes } = world(on)
  const queries = refusedInInputCheck(on)
  await $.tool.call({ tool: 'Read', file_path: '/work/app/a.ts' })
  expect(trail(writes)).toContain('  Read         a.ts')
  expect(queries).toEqual([])
})

test('a question the engine refuses leaves the call an error and its result untouched', async ($, on) => {
  const { writes } = world(on)
  on('tool.check', (_: unknown, e: { tool_use_id?: string }) => {
    if (e.tool_use_id === undefined) throw new Error('no answer')
    return { decision: 'allow' }
  })
  const answer = { result: `Error: ${MESSAGE}`, text: MESSAGE, isError: true as const }
  on('tool.call', () => answer)
  const r = await $.tool.call({ tool: 'Read', file_path: '/work/app/.env' })
  expect(r.text).toBe(MESSAGE)
  expect(trail(writes)).toContain('! Read         .env  (error)')
})

test('a Grep the permission step denies is marked blocked, and the model reads the engine\'s own reason', async ($, on) => {
  const { writes } = world(on)
  on('tool.check', () => ({ decision: 'deny', reason: 'no secrets here', rule: 'Read(./private/**)' }))
  on('tool.call', () => ({ result: {} }))
  const r = await $.tool.call({ tool: 'Grep', pattern: 'key', path: 'private' } as never)
  expect(r.text).toBe('no secrets here')
  expect(r.isError).toBe(true)
  expect(trail(writes)).toContain('x Grep         key in private  (blocked)')
})

test('a subagent\'s call only its own rules deny is marked blocked: the verdict on the call, not the session\'s query', async ($, on) => {
  const { writes } = world(on)
  on('tool.check', (_: unknown, e: { tool_use_id?: string }) => (e.tool_use_id !== undefined ? { decision: 'deny', reason: 'no' } : { decision: 'allow' }))
  on('tool.call', () => ({ result: {} }))
  await $.tool.call({ tool: 'NotebookEdit', notebook_path: '/work/app/n.ipynb', new_source: 'x', agentId: 'agent-123456789' } as never)
  expect(trail(writes)).toContain('x NotebookEdit n.ipynb  (blocked)  [subagent agent-12]')
})

test('an ask nobody can answer, refused by the engine, is marked blocked', async ($, on) => {
  const { writes } = world(on)
  on('tool.check', () => ({ decision: 'ask', reason: 'needs a person' }))
  on('tool.call', () => ({ result: {} }))
  const r = await $.tool.call({ tool: 'Read', file_path: '/work/app/a.ts', agentId: 'bg-1' } as never)
  expect(r.isError).toBe(true)
  expect(trail(writes)).toContain('x Read         a.ts  (blocked)')
})

test('an ask nobody can answer, refused by a PermissionRequest hook, is marked blocked', async ($, on) => {
  const { writes } = world(on)
  on('tool.check', () => ({ decision: 'ask' }))
  on('classic.PermissionRequest', () => ({ decision: { behavior: 'deny', message: 'not today' } }))
  on('tool.call', () => ({ result: {} }))
  const r = await $.tool.call({ tool: 'Read', file_path: '/work/app/a.ts' })
  expect(r.text).toBe('not today')
  expect(trail(writes)).toContain('x Read         a.ts  (blocked)')
})

test('comparison: an ask a PermissionRequest hook allows runs and stays ok', async ($, on) => {
  const { writes } = world(on)
  on('tool.check', () => ({ decision: 'ask' }))
  on('classic.PermissionRequest', () => ({ decision: { behavior: 'allow' } }))
  on('tool.call', () => ({ result: {} }))
  await $.tool.call({ tool: 'Read', file_path: '/work/app/a.ts' })
  expect(trail(writes)).not.toContain('(blocked)')
})

test('comparison: a call the permission step allows that then fails stays an error', async ($, on) => {
  const { writes } = world(on)
  on('tool.check', () => ({ decision: 'allow' }))
  on('tool.call', () => ({ result: 'File does not exist.', isError: true as const }))
  await $.tool.call({ tool: 'Read', file_path: '/work/app/gone.ts' })
  expect(trail(writes)).toContain('! Read         gone.ts  (error)')
})

test('two calls at once, one denied: only that one is marked blocked', async ($, on) => {
  const { writes } = world(on)
  on('tool.check', (_: unknown, e: { input: unknown }) => ((e.input as { file_path?: string }).file_path?.endsWith('.env') ? { decision: 'deny', reason: 'no' } : { decision: 'allow' }))
  on('tool.call', () => ({ result: 'boom', isError: true as const }))
  await Promise.all([$.tool.call({ tool: 'Read', file_path: '/work/app/.env' }), $.tool.call({ tool: 'Read', file_path: '/work/app/a.ts' })])
  expect(trail(writes)).toContain('x Read         .env  (blocked)')
  expect(trail(writes)).toContain('! Read         a.ts  (error)')
})

test('an ask counts as refused only with nobody to answer it, a person and a host can', () => {
  expect(refusedVerdict('ask', undefined)).toBe(true)
  expect(refusedVerdict('ask', 'person')).toBe(false)
  expect(refusedVerdict('ask', 'host')).toBe(false)
})

test('comparison: a deny is refused whoever answers asks, an allow never', () => {
  expect(refusedVerdict('deny', 'person')).toBe(true)
  expect(refusedVerdict('deny', undefined)).toBe(true)
  expect(refusedVerdict('allow', undefined)).toBe(false)
})
