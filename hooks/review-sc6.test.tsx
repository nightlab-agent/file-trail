// Probe (surfaces-and-checks, PR d546f68): the edge the fix must keep. A call whose state write landed
// before the end read the list, but whose hook has not passed `update` when the /clear arrives: the end's
// read holds it, so the new check must leave it alone, and the ended file holds it once with "2 calls".
// A rewrite that drops the membership check (`mine = 0` whenever the generation ended) adds it again.
import { expect, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

// the hooks test runtime has setTimeout; lib es2023 types none (TS2304)
const setTimeout = (globalThis as unknown as { setTimeout: (f: () => void, ms: number) => unknown }).setTimeout
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

type Written = { path: string; text: string }
const last = (ws: Written[], name: string) => ws.filter(w => w.path.endsWith(`/${name}`)).at(-1)?.text ?? ''
const ticks = async (n = 40) => {
  for (let i = 0; i < n; i++) await Promise.resolve()
}
const count = (s: string, sub: string) => s.split(sub).length - 1

test('probe sc6: a call whose write landed before the end read the list, hook resuming after the end, is in the ended file once', async ($: Parameters<TestBody>[0], on: Parameters<TestBody>[1]) => {
  const session = { id: 'sess-a' }
  const writes: Written[] = []
  let landed = false
  on('session.cwd', () => ({ value: '/work/app' }))
  on('session.id', () => ({ value: session.id }))
  on('session.end', async (_, e) => {
    await sleep(60)
    return { sessionId: e.sessionId }
  })
  on('fs.write', (_, e) => {
    writes.push({ path: e.path, text: e.text })
    return { value: undefined }
  })
  on('ui.status', () => ({ value: undefined }))
  on('tool.call', () => ({ result: {} }))
  on('state.set', async (_, e, next) => {
    const r = await next(e)
    // the write has landed in the store; the call's hook does not learn it for 40 ms
    if (JSON.stringify(e).includes('late.ts')) {
      landed = true
      await sleep(40)
    }
    return r
  })
  await $.tool.call({ tool: 'Read', file_path: '/work/app/old.ts' })
  const late = $.tool.call({ tool: 'Read', file_path: '/work/app/late.ts' })
  for (let i = 0; i < 50 && !landed; i++) await ticks()
  expect(landed).toBe(true)
  await $.session.end({ reason: 'clear', sessionId: 'sess-a', resume: {} as never })
  session.id = 'sess-b'
  await late
  await ticks(200)
  const a = last(writes, 'sess-a.txt')
  expect(count(a, 'late.ts')).toBe(1)
  expect(a.split('\n')[0]).toContain('2 calls')
})
