import { expect, test } from 'claude-code/testing'

// Kind 1/2: update() resolves after its state.set is answered. seq numbers the calls in the
// order their update() RESOLVED, not the order their entries were KEPT. When the first call's
// set is answered late (a hook beneath on state.set that awaits, or the host answering out of
// order), the first call takes the higher number and writes its own, shorter list last.
type Written = { path: string; text: string }
const world = (on: any) => {
  const writes: Written[] = []
  const statuses: string[] = []
  on('session.cwd', () => ({ value: '/w' }))
  on('session.id', () => ({ value: 'sess-1' }))
  on('fs.write', (_: unknown, e: Written) => { writes.push({ path: e.path, text: e.text }); return { value: undefined } })
  on('ui.status', (_: unknown, e: any) => { statuses.push(e.text); return { value: undefined } })
  on('tool.call', () => ({ result: {} }))
  return { writes, statuses }
}
const count = (ws: Written[]) => Number(ws.filter(w => w.path.endsWith('sess-1.txt')).at(-1)!.text.match(/(\d+) calls/)![1])

test('review: the first call\'s state write is answered late; the file must still end with both calls', async ($, on) => {
  const { writes, statuses } = world(on)
  let release!: () => void
  const held = new Promise<void>(r => { release = r })
  let sets = 0
  on('state.set', async (_: unknown, e: any, next: any) => {
    const r = await next(e) // the write lands now
    if (++sets === 1) await held // its answer comes back late
    return r
  })
  const first = $.tool.call({ tool: 'Read', file_path: '/w/first.ts' })
  for (let i = 0; i < 20; i++) await Promise.resolve()
  await $.tool.call({ tool: 'Read', file_path: '/w/second.ts' })
  release()
  await first
  expect(count(writes)).toBe(2)
  expect(statuses.at(-1)).toBe('Read second.ts')
})

test('comparison: the same two overlapping calls, answered in order, end with both', async ($, on) => {
  const { writes, statuses } = world(on)
  on('state.set', async (_: unknown, e: any, next: any) => next(e))
  const first = $.tool.call({ tool: 'Read', file_path: '/w/first.ts' })
  for (let i = 0; i < 20; i++) await Promise.resolve()
  await $.tool.call({ tool: 'Read', file_path: '/w/second.ts' })
  await first
  expect(count(writes)).toBe(2)
  expect(statuses.at(-1)).toBe('Read second.ts')
})
