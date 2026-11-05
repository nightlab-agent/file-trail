import { expect, test } from 'claude-code/testing'

const observer = (forward: boolean) => ({
  name: 'managed-observer', tier: 'prepend' as const,
  register: forward ? (on: any) => {
    on('tool.check', async (_: unknown, e: unknown, next: any) => {
      await next(e)
      return { decision: 'allow' }
    })
    on('classic.PostToolUseFailure', (_: unknown, e: unknown, next: any) => next(e))
  } : (on: any) => {
    on('tool.check', async (_: unknown, e: unknown, next: any) => {
      await next(e)
      return { decision: 'allow' }
    })
    on('classic.PostToolUseFailure', () => ({ additionalContext: ['Failure observed.'] }))
  },
})

for (const forward of [false, true]) {
  test(`a failed call with a managed observer that ${forward ? 'forwards PostToolUseFailure stays error' : 'answers PostToolUseFailure reads blocked, the README\'s limit'}`,
    { plugins: [observer(forward)] }, async ($, on) => {
      const texts: string[] = []
      on('session.root', () => ({ value: '/work/app' }))
      on('session.cwd', () => ({ value: '/work/app' }))
      on('session.id', () => ({ value: 'review' }))
      on('ui.status', () => ({ value: undefined }))
      on('fs.write', (_: unknown, e: { text: string }) => {
        texts.push(e.text)
        return { value: undefined }
      })
      on('tool.check', () => ({ decision: 'deny', reason: 'inner verdict' }))
      on('classic.PostToolUseFailure', () => ({}))
      let runs = 0
      on('tool.call', async (_: unknown, e: { tool: string; tool_use_id: string }) => {
        runs++
        await $.classic.PostToolUseFailure({ tool_name: e.tool, tool_input: {}, tool_use_id: e.tool_use_id, error: 'missing' })
        return { result: 'missing', isError: true as const }
      })
      await $.tool.call({ tool: 'Read', file_path: '/work/app/missing.ts' })
      expect(runs).toBe(1)
      expect(texts.at(-1)).toContain(forward ? '! Read         missing.ts  (error)' : 'x Read         missing.ts  (blocked)')
    })
}

const replay = (parallel: boolean) => ({
  name: 'managed-replay', tier: 'prepend' as const,
  register: parallel ? (on: any) => {
    on('tool.call', async (_: unknown, e: unknown, next: any) => (await Promise.all([next(e), next(e)]))[1])
    on('tool.check', async (_: unknown, e: { tool_use_id?: string }, next: any) => {
      const r = await next(e)
      return e.tool_use_id ? { decision: 'allow' } : r
    })
  } : (on: any) => {
    on('tool.call', async (_: unknown, e: unknown, next: any) => {
      await next(e)
      return next(e)
    })
    on('tool.check', async (_: unknown, e: { tool_use_id?: string }, next: any) => {
      const r = await next(e)
      return e.tool_use_id ? { decision: 'allow' } : r
    })
  },
})

for (const parallel of [true, false]) {
  test(`two next calls ${parallel ? 'overlapping' : 'sequential'} keep executed failures as errors`,
    { plugins: [replay(parallel)] }, async ($, on) => {
      const texts: string[] = []
      const ids: string[] = []
      on('session.root', () => ({ value: '/work/app' }))
      on('session.cwd', () => ({ value: '/work/app' }))
      on('session.id', () => ({ value: 'review' }))
      on('ui.status', () => ({ value: undefined }))
      on('fs.write', (_: unknown, e: { text: string }) => {
        texts.push(e.text)
        return { value: undefined }
      })
      on('tool.check', () => ({ decision: 'deny', reason: 'inner verdict' }))
      on('classic.PostToolUseFailure', () => ({}))
      let release!: () => void
      const ready = new Promise<void>(r => { release = r })
      on('tool.call', async (_: unknown, e: { tool: string; tool_use_id: string }) => {
        await $.classic.PostToolUseFailure({ tool_name: e.tool, tool_input: {}, tool_use_id: e.tool_use_id, error: 'missing' })
        ids.push(e.tool_use_id)
        if (ids.length === 2) release()
        if (parallel) await ready
        return { result: 'missing', isError: true as const }
      })
      await $.tool.call({ tool: 'Read', file_path: '/work/app/missing.ts' })
      expect(ids.length).toBe(2)
      expect(ids[0]).toBe(ids[1])
      expect(texts.at(-1)).not.toContain('(blocked)')
      expect(texts.at(-1)?.split('! Read').length).toBe(3)
    })
}
