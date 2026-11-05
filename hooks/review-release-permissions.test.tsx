import { expect, test } from 'claude-code/testing'

// A tool that ran and failed raises PostToolUseFailure, on the way to tool.call's answer; a call refused at
// its input check or the permission step raises none (Claude Code 2.1.312, read from the binary). The kit
// raises it for no one, so `failing` does, where the engine would.
const world = (on: any) => {
  const texts: string[] = []
  let ran = 0
  on('session.root', () => ({ value: '/work/app' }))
  on('session.cwd', () => ({ value: '/work/app' }))
  on('session.id', () => ({ value: 'session-a' }))
  on('ui.status', () => ({ value: undefined }))
  on('classic.PostToolUseFailure', () => ({}))
  on('fs.write', (_: unknown, e: { text: string }) => {
    texts.push(e.text)
    return { value: undefined }
  })
  return { texts, ran: () => ran, count: () => ran++ }
}
const failing = ($: any, on: any, w: { count: () => number }) =>
  on('tool.call', async (_: unknown, e: { tool: string; tool_use_id: string }) => {
    w.count()
    await $.classic.PostToolUseFailure({ tool_name: e.tool, tool_input: {}, tool_use_id: e.tool_use_id, error: 'File does not exist.' })
    return { result: 'File does not exist.', isError: true as const }
  })

const override = {
  name: 'permission-override', tier: 'prepend' as const,
  register(on: any) {
    on('tool.check', async (_: unknown, e: unknown, next: any) => {
      await next(e)
      return { decision: 'allow' }
    })
  },
}
// allows the real call and leaves a query alone, so the query says what the rules say
const overrideCall = {
  name: 'permission-override-call', tier: 'prepend' as const,
  register(on: any) {
    on('tool.check', async (_: unknown, e: { tool_use_id?: string }, next: any) => {
      const r = await next(e)
      return e.tool_use_id === undefined ? r : { decision: 'allow' }
    })
  },
}

test('a denied verdict overridden above file-trail runs and its failure stays error', { plugins: [override] }, async ($, on) => {
  const w = world(on)
  failing($, on, w)
  on('tool.check', () => ({ decision: 'deny', reason: 'inner deny' }))
  await $.tool.call({ tool: 'Read', file_path: '/work/app/missing.ts' })
  expect(w.ran()).toBe(1)
  expect(w.texts.at(-1)).toContain('! Read         missing.ts  (error)')
})

test('an ask nobody can answer, overridden above file-trail, runs and its failure stays error', { plugins: [override] }, async ($, on) => {
  const w = world(on)
  failing($, on, w)
  on('tool.check', () => ({ decision: 'ask' }))
  await $.tool.call({ tool: 'Read', file_path: '/work/app/missing.ts' })
  expect(w.ran()).toBe(1)
  expect(w.texts.at(-1)).toContain('! Read         missing.ts  (error)')
})

test('a call overridden above file-trail that ran and failed is not asked about at all', { plugins: [overrideCall] }, async ($, on) => {
  const w = world(on)
  failing($, on, w)
  on('tool.check', () => ({ decision: 'deny', reason: 'inner deny' }))
  await $.tool.call({ tool: 'Grep', pattern: 'x' } as never)
  expect(w.ran()).toBe(1)
  expect(w.texts.at(-1)).toContain('! Grep         x  (error)')
})

test('comparison: an allowed verdict and the same executed failure stays error', { plugins: [override] }, async ($, on) => {
  const w = world(on)
  failing($, on, w)
  on('tool.check', () => ({ decision: 'allow' }))
  await $.tool.call({ tool: 'Read', file_path: '/work/app/missing.ts' })
  expect(w.ran()).toBe(1)
  expect(w.texts.at(-1)).toContain('! Read         missing.ts  (error)')
})

test('two at once: the one refused is blocked, the one that ran and failed is an error', async ($, on) => {
  const w = world(on)
  on('tool.check', (_: unknown, e: { input: unknown }) =>
    ((e.input as { file_path?: string }).file_path?.endsWith('.env') ? { decision: 'deny', reason: 'no' } : { decision: 'allow' }))
  failing($, on, w)
  await Promise.all([$.tool.call({ tool: 'Read', file_path: '/work/app/.env' }), $.tool.call({ tool: 'Read', file_path: '/work/app/missing.ts' })])
  expect(w.texts.at(-1)).toContain('x Read         .env  (blocked)')
  expect(w.texts.at(-1)).toContain('! Read         missing.ts  (error)')
})
