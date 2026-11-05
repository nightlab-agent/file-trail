import { expect, test } from 'claude-code/testing'

// The user deletes the folder while a session runs. `$.fs.write` makes the folders it needs, so the next call
// brings the folder back; `$.fs.exists` answers from what is on disk (index.d.ts, the `fs` noun).
const world = (on: any) => {
  const disk = new Map<string, string>()
  const log: string[] = []
  on('session.cwd', () => ({ value: '/work/app' }))
  on('session.id', () => ({ value: 'sess-1' }))
  on('ui.status', () => ({ value: undefined }))
  on('tool.call', () => ({ result: {} }))
  on('fs.exists', (_: unknown, e: { path: string }) => ({ value: disk.has(e.path) }))
  on('fs.write', (_: unknown, e: { path: string; text: string }) => {
    disk.set(e.path, e.text)
    log.push(e.path)
    return { value: undefined }
  })
  return { disk, log }
}
const ignored = (disk: Map<string, string>) => [...disk].filter(([p]) => p.endsWith('/.file-trail/.gitignore')).map(([, t]) => t)

test('the folder deleted mid-session comes back with its .gitignore before its trail file', async ($, on) => {
  const { disk, log } = world(on)
  await $.tool.call({ tool: 'Read', file_path: '/work/app/a.ts' })
  disk.clear()
  log.length = 0
  await $.tool.call({ tool: 'Read', file_path: '/work/app/b.ts' })
  expect(ignored(disk)).toEqual(['*\n'])
  expect(log.map(p => p.split('/').at(-1))).toEqual(['.gitignore', 'sess-1.txt'])
})

test('only the .gitignore deleted: it comes back too', async ($, on) => {
  const { disk } = world(on)
  await $.tool.call({ tool: 'Read', file_path: '/work/app/a.ts' })
  for (const p of disk.keys()) if (p.endsWith('.gitignore')) disk.delete(p)
  await $.tool.call({ tool: 'Read', file_path: '/work/app/b.ts' })
  expect(ignored(disk)).toEqual(['*\n'])
})

test('comparison: while it stands the .gitignore is written once', async ($, on) => {
  const { log } = world(on)
  await $.tool.call({ tool: 'Read', file_path: '/work/app/a.ts' })
  await $.tool.call({ tool: 'Read', file_path: '/work/app/b.ts' })
  await $.tool.call({ tool: 'Read', file_path: '/work/app/c.ts' })
  expect(log.filter(p => p.endsWith('.gitignore')).length).toBe(1)
})

test('two calls at once after a delete write it once, ahead of the trail', async ($, on) => {
  const { disk, log } = world(on)
  await $.tool.call({ tool: 'Read', file_path: '/work/app/a.ts' })
  disk.clear()
  log.length = 0
  await Promise.all([$.tool.call({ tool: 'Read', file_path: '/work/app/b.ts' }), $.tool.call({ tool: 'Read', file_path: '/work/app/c.ts' })])
  expect(log[0]!.endsWith('.gitignore')).toBe(true)
  expect(log.filter(p => p.endsWith('.gitignore')).length).toBe(1)
})

test('a /clear after the delete writes the ended file beside a .gitignore too', async ($, on) => {
  const { disk } = world(on)
  on('session.end', (_: unknown, e: { sessionId: string }) => ({ sessionId: e.sessionId }))
  await $.tool.call({ tool: 'Read', file_path: '/work/app/a.ts' })
  disk.clear()
  await $.session.end({ reason: 'clear', sessionId: 'sess-1', resume: {} as never })
  expect(ignored(disk)).toEqual(['*\n'])
})

test('a check that fails, after the folder was deleted, still leaves the folder ignored', async ($, on) => {
  const disk = new Map<string, string>()
  let broken = false
  on('session.cwd', () => ({ value: '/work/app' }))
  on('session.root', () => ({ value: '/work/app' }))
  on('session.id', () => ({ value: 'sess-1' }))
  on('ui.status', () => ({ value: undefined }))
  on('tool.call', () => ({ result: {} }))
  on('fs.exists', (_: unknown, e: { path: string }) => {
    if (broken) throw new Error('refused')
    return { value: disk.has(e.path) }
  })
  on('fs.write', (_: unknown, e: { path: string; text: string }) => {
    disk.set(e.path, e.text)
    return { value: undefined }
  })
  await $.tool.call({ tool: 'Read', file_path: '/work/app/a.ts' })
  disk.clear()
  broken = true
  await $.tool.call({ tool: 'Read', file_path: '/work/app/b.ts' })
  expect([...disk.keys()].map(p => p.split('/').at(-1)).sort()).toEqual(['.gitignore', 'sess-1.txt'])
})
