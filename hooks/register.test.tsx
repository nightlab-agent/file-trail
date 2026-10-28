import { expect, mock, test } from 'claude-code/testing'

import { fileText, KEEP, shorten, SHOW, targetOf } from './register'

// Each test stands for the engine beneath the plugin: it answers the tool
// calls (or denies them), `$.fs.write`, `$.ui.status`, `$.env.get` and
// `$.session.id`, and reads what the plugin wrote. Nothing touches the real
// file system.

type Written = { path: string; text: string }
type On = Parameters<Parameters<typeof test>[1]>[1]

const PANE = {
  plugin: 'file-trail',
  component: 'Pane',
  requestId: 'file-trail',
  props: {
    title: 'File trail',
    isFocused: false,
    bodyColumns: 80,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

const world = (on: On, env: Record<string, string>, opts: { writeFails?: boolean; deny?: RegExp; errorOn?: RegExp } = {}) => {
  const writes: Written[] = []
  const statuses: (string | undefined)[] = []
  mock.env(on, env)
  on('fs.write', (_, e) => {
    if (opts.writeFails) throw new Error('read-only file system')
    writes.push({ path: e.path, text: e.text })
    return { value: undefined }
  })
  on('ui.status', (_, e) => {
    statuses.push(e.text)
    return { value: undefined }
  })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('command.register', () => ({ value: { command: 'file-trail' } }))
  on('session.id', () => ({ value: 'sess-1' }))
  on('tool.call', (_, e) => {
    const t = JSON.stringify(e)
    if (opts.deny?.test(t)) return { deny: 'blocked by a rule' }
    if (opts.errorOn?.test(t)) return { result: 'File does not exist.', isError: true }
    return { result: {} }
  })
  return { writes, statuses }
}

test('a Read is recorded with its path, relative to the working folder, in the file and the status line', async ($, on) => {
  const { writes, statuses } = world(on, { HOME: '/home/someone', PWD: '/work/app' })
  await $.tool.call({ tool: 'Read', file_path: '/work/app/src/index.ts' })
  expect(writes.length).toBe(1)
  expect(writes[0]!.path).toBe('/home/someone/.file-trail/sess-1.txt')
  expect(writes[0]!.text).toContain('Read         src/index.ts')
  expect(writes[0]!.text).toContain('1 calls')
  expect(statuses.at(-1)).toBe('Read src/index.ts')
})

test('a denied call is marked blocked and an error result is marked error', async ($, on) => {
  const { writes, statuses } = world(on, { FILE_TRAIL_DIR: '/trail' }, { deny: /\.env/, errorOn: /missing/ })
  const denied = await $.tool.call({ tool: 'Read', file_path: '/work/.env' })
  expect(denied.deny).toBe('blocked by a rule')
  expect(statuses.at(-1)).toBe('Read /work/.env (blocked)')
  await $.tool.call({ tool: 'Edit', file_path: '/work/missing.ts', old_string: 'a', new_string: 'b' })
  const text = writes.at(-1)!.text
  expect(text).toContain('x Read         /work/.env  (blocked)')
  expect(text).toContain('! Edit         /work/missing.ts  (error)')
  expect(writes.at(-1)!.path).toBe('/trail/sess-1.txt')
})

test('searches show the pattern and folder; tools outside the list are not recorded', async ($, on) => {
  const { writes } = world(on, { FILE_TRAIL_DIR: '/trail' })
  await $.tool.call({ tool: 'Bash', command: 'ls' })
  expect(writes.length).toBe(0)
  await $.tool.call({ tool: 'Grep', pattern: 'TODO', path: 'src' })
  await $.tool.call({ tool: 'Glob', pattern: '**/*.md' })
  const text = writes.at(-1)!.text
  expect(text).toContain('Grep         TODO in src')
  expect(text).toContain('Glob         **/*.md')
  expect(text).not.toContain('Bash')
})

test('a failed write leaves the tool result untouched', async ($, on) => {
  const { writes, statuses } = world(on, { FILE_TRAIL_DIR: '/nowhere' }, { writeFails: true })
  const r = await $.tool.call({ tool: 'Write', file_path: '/x/y.txt', content: 'hi' })
  expect(r.deny).toBe(undefined)
  expect(writes.length).toBe(0)
  expect(statuses.at(-1)).toBe('Write /x/y.txt')
})

test('with no FILE_TRAIL_DIR and no HOME nothing is written', async ($, on) => {
  const { writes, statuses } = world(on, {})
  await $.tool.call({ tool: 'Read', file_path: '/a' })
  expect(writes.length).toBe(0)
  expect(statuses.at(-1)).toBe('Read /a')
})

test('the pane lists the newest call first, blocked ones included, on every surface', async ($, on) => {
  world(on, { FILE_TRAIL_DIR: '/trail' }, { deny: /secret/ })
  await $.tool.call({ tool: 'Read', file_path: '/a/first.ts' })
  await $.tool.call({ tool: 'Read', file_path: '/a/secret.key' })
  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    const first = await ui.find({ type: 'Text' })
    expect(first?.text).toContain('secret.key  (blocked)')
    expect((await ui.find({ type: 'Text', text: /first\.ts/ }))?.text).toContain('Read')
    await ui.unmount()
  }
})

test('the pane says so before any call, and the command opens it with the counts', async ($, on) => {
  world(on, { FILE_TRAIL_DIR: '/trail' }, { deny: /secret/ })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ type: 'Text' }))?.text).toBe('No file or search calls yet in this session.')
  await ui.unmount()
  await $.tool.call({ tool: 'Read', file_path: '/a/secret' })
  await $.tool.call({ tool: 'Read', file_path: '/a/b' })
  const r = await $.command.run({ command: 'file-trail', args: '' })
  expect(r.text).toBe('File trail opened: 2 calls this session, 1 blocked.')
})

test('a value an earlier version stored is declined', async ($, on) => {
  on('state.get', () => ({ value: { value: [{ path: '/old' }], version: 1 } }))
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Text' }))?.text).toBe('No file or search calls yet in this session.')
  await ui.unmount()
})

test('helpers: target, shorten, file text, limits', () => {
  expect(targetOf({ notebook_path: '/n.ipynb' })).toBe('/n.ipynb')
  expect(targetOf({ pattern: 'x' })).toBe('x')
  expect(targetOf({})).toBe('')
  expect(shorten('/w/a/b.ts', '/w')).toBe('a/b.ts')
  expect(shorten('/other/b.ts', '/w')).toBe('/other/b.ts')
  expect(shorten('/w/a.ts', '')).toBe('/w/a.ts')
  expect(fileText([], '')).toBe('# file-trail: 0 calls (x blocked, ! error)\n\n')
  expect(SHOW).toBeLessThan(KEEP)
})
