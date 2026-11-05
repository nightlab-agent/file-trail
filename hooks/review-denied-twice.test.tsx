import { expect, test } from 'claude-code/testing'

// Two next calls with one id, as for `ran`: each refused run is marked on its own.
// A subagent's Read a settings PreToolUse hook denies: README says blocked, from the verdict on the call itself.
const replay = {
  name: 'managed-replay', tier: 'prepend' as const,
  register: (on: any) => {
    on('tool.call', async (_: unknown, e: unknown, next: any) => (await Promise.all([next(e), next(e)]))[1])
  },
}

for (const [label, plugins] of [['one answer', []], ['two answers, one id', [replay]]] as const) {
  test(`a subagent Read a settings PreToolUse hook denies is blocked (${label})`, { plugins: [...plugins] }, async ($, on) => {
    const texts: string[] = []
    on('session.root', () => ({ value: '/work/app' }))
    on('session.cwd', () => ({ value: '/work/app' }))
    on('session.id', () => ({ value: 'probe' }))
    on('ui.status', () => ({ value: undefined }))
    on('fs.write', (_: unknown, e: { text: string }) => { texts.push(e.text); return { value: undefined } })
    on('classic.PreToolUse', (_: unknown, e: unknown) => (JSON.stringify(e).includes('.env') ? { deny: 'no secrets' } : {}))
    on('tool.call', () => ({ result: {} }))
    await $.tool.call({ tool: 'Read', file_path: '/work/app/.env', agentId: 'sub-1' } as any)
    const last = texts.at(-1) ?? ''
    expect(last).not.toContain('(error)')
  })
}
