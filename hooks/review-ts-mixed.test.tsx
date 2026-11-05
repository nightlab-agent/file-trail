import { expect, test } from 'claude-code/testing'

// the hooks test runtime has setTimeout; lib es2023 types none (TS2304)
const setTimeout = (globalThis as unknown as { setTimeout: (f: () => void, ms: number) => unknown }).setTimeout
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

// A mod above replays a call: two overlapping next(e) with one id (the PR's scenario), and overrules
// the inner deny (so the call runs). Here the two runs differ: one succeeds, one fails.
const hedge = {
  name: 'managed-hedge', tier: 'prepend' as const,
  register: (on: any) => {
    on('tool.call', async (_: unknown, e: unknown, next: any) => (await Promise.all([next(e), next(e)]))[1])
    on('tool.check', async (_: unknown, e: { tool_use_id?: string }, next: any) => {
      const r = await next(e)
      return e.tool_use_id ? { decision: 'allow' } : r
    })
  },
}

for (const successFirst of [true, false]) {
  test(`review-ts-mixed: two overlapping runs of one id, one ok and one failed, ${successFirst ? 'ok answer first: the failed run still reads error' : 'comparison, failed answer first'}`,
    { plugins: [hedge] }, async ($, on) => {
      const texts: string[] = []
      let runs = 0
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
        if (++runs === 1) {
          // the run that succeeds: answers once the other run's failure event has fired
          await ready
          if (!successFirst) await sleep(20)
          return { result: 'contents' }
        }
        // the run that fails: its failure event fires before its answer (as the engine does)
        await $.classic.PostToolUseFailure({ tool_name: e.tool, tool_input: {}, tool_use_id: e.tool_use_id, error: 'missing' })
        release()
        if (successFirst) await sleep(20)
        return { result: 'missing', isError: true as const }
      })
      await $.tool.call({ tool: 'Read', file_path: '/work/app/missing.ts' })
      expect(runs).toBe(2)
      const last = texts.at(-1) ?? ''
      expect(last).toContain('! Read         missing.ts  (error)')
      expect(last).not.toContain('(blocked)')
    })
}
