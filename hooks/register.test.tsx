import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

// What the engine stamps on a typed command: the person at the composer.
const RUN = { origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } } as const

import { fileText, groupLine, groupNames, KEEP, shorten, SHOW, targetOf } from './register'

// Each test stands for the engine beneath the plugin: it answers the tool
// calls (or denies them), `$.fs.write`, `$.ui.status`, `$.session.cwd`
// and `$.session.id`, and reads what the plugin wrote. Nothing touches the real
// file system.

type Written = { path: string; text: string }
type On = Parameters<TestBody>[1]

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

const world = (on: On, cwd: string, opts: { writeFails?: boolean; deny?: RegExp; errorOn?: RegExp } = {}) => {
  const writes: Written[] = []
  const statuses: (string | undefined)[] = []
  on('session.cwd', () => ({ value: cwd }))
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
  const { writes, statuses } = world(on, '/work/app')
  await $.tool.call({ tool: 'Read', file_path: '/work/app/src/index.ts' })
  expect(writes.length).toBe(2)
  expect(writes[1]!.path.endsWith('/.file-trail/sess-1.txt')).toBe(true)
  expect(writes[1]!.text).toContain('Read         src/index.ts')
  expect(writes[1]!.text).toContain('1 calls')
  expect(statuses.at(-1)).toBe('Read src/index.ts')
})

test('a denied call is marked blocked and an error result is marked error', { options: { dir: '/trail' } }, async ($, on) => {
  const { writes, statuses } = world(on, '', { deny: /\.env/, errorOn: /missing/ })
  const denied = await $.tool.call({ tool: 'Read', file_path: '/work/.env' })
  expect(denied.deny).toBe('blocked by a rule')
  expect(statuses.at(-1)).toBe('Read /work/.env (blocked)')
  await $.tool.call({ tool: 'Edit', file_path: '/work/missing.ts', old_string: 'a', new_string: 'b' })
  const text = writes.at(-1)!.text
  expect(text).toContain('x Read         /work/.env  (blocked)')
  expect(text).toContain('! Edit         /work/missing.ts  (error)')
  expect(writes.at(-1)!.path).toBe('/trail/sess-1.txt')
})

test('searches show the pattern and folder; tools outside the list are not recorded', { options: { dir: '/trail' } }, async ($, on) => {
  const { writes } = world(on, '')
  await $.tool.call({ tool: 'Bash', command: 'ls' })
  expect(writes.length).toBe(0)
  // Grep and Glob are built-in tools on some builds only (the 2.1.310 types name neither), so they do not name them.
  type Call = Parameters<typeof $.tool.call>[0]
  await $.tool.call({ tool: 'Grep', pattern: 'TODO', path: 'src' } as unknown as Call)
  await $.tool.call({ tool: 'Glob', pattern: '**/*.md' } as unknown as Call)
  const text = writes.at(-1)!.text
  expect(text).toContain('Grep         TODO in src')
  expect(text).toContain('Glob         **/*.md')
  expect(text).not.toContain('Bash')
})

test('a failed write leaves the tool result untouched', { options: { dir: '/nowhere' } }, async ($, on) => {
  const { writes, statuses } = world(on, '', { writeFails: true })
  const r = await $.tool.call({ tool: 'Write', file_path: '/x/y.txt', content: 'hi' })
  expect(r.deny).toBe(undefined)
  expect(writes.length).toBe(0)
  expect(statuses.at(-1)).toBe('Write /x/y.txt')
})

test('the dir option names the folder; left unset it is .file-trail under the project', { options: { dir: '/var/trails' } }, async ($, on) => {
  const { writes, statuses } = world(on, '')
  await $.tool.call({ tool: 'Read', file_path: '/a' })
  expect(writes.at(-1)!.path).toBe('/var/trails/sess-1.txt')
  expect(statuses.at(-1)).toBe('Read /a')
})

test('the pane lists the newest call first, blocked ones included, on every surface', async ($, on) => {
  world(on, '', { deny: /secret/ })
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
  world(on, '', { deny: /secret/ })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ type: 'Text' }))?.text).toBe('No file or search calls yet in this session.')
  await ui.unmount()
  await $.tool.call({ tool: 'Read', file_path: '/a/secret' })
  await $.tool.call({ tool: 'Read', file_path: '/a/b' })
  const r = await $.command.run({ command: 'file-trail', args: '', ...RUN })
  expect(r.text).toBe('File trail opened: 2 calls this session, 1 blocked.')
})

test('a value an earlier version stored is declined', async ($, on) => {
  on('state.get', () => ({ value: { value: [{ path: '/old' }], version: 1 } }))
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Text' }))?.text).toBe('No file or search calls yet in this session.')
  await ui.unmount()
})

const GROUP = { plugin: 'file-trail', component: 'ToolGroup', requestId: 'msg-1' } as const
const call = (tool: string, input: unknown, isErrored = false) => ({ tool, input, isErrored, isRunning: false, isInterrupted: false })

test('a collapsed group keeps the engine line and names its files, relative, on every surface', async ($, on) => {
  on('session.cwd', () => ({ value: '/work/app' }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>Read 3 files</Text>
  })
  const calls = [
    call('Read', { file_path: '/work/app/src/a.ts' }),
    call('Bash', { command: 'ls' }),
    call('Read', { file_path: '/elsewhere/b.md' }),
    call('Grep', { pattern: 'TODO', path: 'src' }),
    call('Read', { file_path: '/work/app/gone.ts' }, true),
  ]
  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...GROUP, surface, props: { calls, isActive: false, isExpanded: false } })
    expect((await ui.find({ type: 'Text', text: /Read 3 files/ }))?.text).toBe('Read 3 files')
    expect((await ui.find({ type: 'Text', text: /⎿/ }))?.text).toBe('  ⎿ src/a.ts, /elsewhere/b.md, TODO in src, gone.ts !')
    await ui.unmount()
  }
})

test('an expanded group, or one with no file calls, is drawn as the engine drew it', async ($, on) => {
  on('session.cwd', () => ({ value: '/w' }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  const expanded = await $.ui.mount({ ...GROUP, surface: 'terminal', props: { calls: [call('Read', { file_path: '/w/a' })], isActive: false, isExpanded: true } })
  expect(await expanded.find({ type: 'Text', text: /⎿/ })).toBeUndefined()
  await expanded.unmount()
  const bash = await $.ui.mount({ ...GROUP, surface: 'terminal', props: { calls: [call('Bash', { command: 'ls' })], isActive: false, isExpanded: false } })
  expect(await bash.find({ type: 'Text', text: /⎿/ })).toBeUndefined()
  expect((await bash.find({ type: 'Text' }))?.text).toBe('engine')
  await bash.unmount()
})

test('the group line is cut to the width with a count of the rest', () => {
  const names = Array.from({ length: 30 }, (_, i) => `src/file-${i}.ts`)
  const line = groupLine(names, 60)
  expect(line.length).toBeLessThanOrEqual(60)
  expect(line).toMatch(/^ {2}⎿ src\/file-0\.ts, .*, \+\d+ more$/)
  const shown = line.split(', ').length - 1
  expect(line.endsWith(`+${30 - shown} more`)).toBe(true)
  expect(groupLine(['one.ts'], 80)).toBe('  ⎿ one.ts')
  expect(groupNames([call('Read', null), call('Glob', { pattern: '' })], '')).toEqual([])
})

test('helpers: target, shorten, file text, limits', () => {
  expect(targetOf({ notebook_path: '/n.ipynb' })).toBe('/n.ipynb')
  expect(targetOf({ pattern: 'x' })).toBe('x')
  expect(targetOf({})).toBe('')
  expect(shorten('/w/a/b.ts', '/w')).toBe('a/b.ts')
  expect(shorten('/other/b.ts', '/w')).toBe('/other/b.ts')
  expect(shorten('/w/a.ts', '')).toBe('/w/a.ts')
  // look-alikes: the working folder's name inside another path, or repeated, is not cut
  expect(shorten('/mnt/w/a.ts', '/w')).toBe('/mnt/w/a.ts')
  expect(shorten('/w/x/w/y.ts', '/w')).toBe('x/w/y.ts')
  expect(fileText([], '')).toBe('# file-trail: 0 calls (x blocked, ! error)\n\n')
  expect(SHOW).toBeLessThan(KEEP)
})

test('before its first write the mod writes <dir>/.gitignore holding one line, *, once, so git never sees the folder', async ($, on) => {
  const { writes } = world(on, '/work/app')
  await $.tool.call({ tool: 'Read', file_path: '/work/app/src/index.ts' })
  await $.tool.call({ tool: 'Read', file_path: '/work/app/README.md' })
  expect(writes[0]!.path.endsWith('/.file-trail/.gitignore')).toBe(true)
  expect(writes[0]!.text).toBe('*\n')
  expect(writes.filter(w => w.path.endsWith('/.gitignore')).length).toBe(1)
  expect(writes.filter(w => w.path.endsWith('.txt')).length).toBe(2)
})

test('with dir set to the project itself, the project\'s own .gitignore is left alone', { options: { dir: '.' } }, async ($, on) => {
  const { writes } = world(on, '/work/app')
  await $.tool.call({ tool: 'Read', file_path: '/work/app/src/index.ts' })
  expect(writes.filter(w => w.path.endsWith('.gitignore')).length).toBe(0)
  expect(writes.filter(w => w.path.endsWith('.txt')).length).toBe(1)
})

test('two calls at once: the first call\'s session id comes back late, and the file still holds both entries', async ($, on) => {
  const writes: Written[] = []
  on('session.cwd', () => ({ value: '/w' }))
  on('fs.write', (_, e) => {
    writes.push({ path: e.path, text: e.text })
    return { value: undefined }
  })
  on('ui.status', () => ({ value: undefined }))
  on('tool.call', () => ({ result: {} }))
  // the first session id read waits until the second call has written
  let release!: () => void
  const held = new Promise<void>(resolve => {
    release = resolve
  })
  let reads = 0
  on('session.id', async () => {
    if (++reads === 1) await held
    return { value: 'sess-1' }
  })
  const first = $.tool.call({ tool: 'Read', file_path: '/w/first.ts' })
  const second = $.tool.call({ tool: 'Read', file_path: '/w/second.ts' })
  await second
  const afterSecond = writes.filter(w => w.path.endsWith('.txt')).at(-1)!.text
  expect(afterSecond).toContain('first.ts')
  expect(afterSecond).toContain('second.ts')
  release()
  await first
  const final = writes.filter(w => w.path.endsWith('.txt')).at(-1)!.text
  expect(final).toContain('2 calls')
  expect(final).toContain('first.ts')
  expect(final).toContain('second.ts')
})

test('control: two calls one after the other write the file twice, the second with both entries', async ($, on) => {
  const { writes } = world(on, '/w')
  await $.tool.call({ tool: 'Read', file_path: '/w/first.ts' })
  await $.tool.call({ tool: 'Read', file_path: '/w/second.ts' })
  const texts = writes.filter(w => w.path.endsWith('.txt')).map(w => w.text)
  expect(texts.length).toBe(2)
  expect(texts[0]).toContain('1 calls')
  expect(texts[1]).toContain('2 calls')
  expect(texts[1]).toContain('second.ts')
})

test('three calls at once share one writer, the counts never going back; a failed write is made up by the next call', async ($, on) => {
  const writes: Written[] = []
  let fail = false
  on('session.cwd', () => ({ value: '/w' }))
  on('session.id', () => ({ value: 'sess-1' }))
  on('ui.status', () => ({ value: undefined }))
  on('tool.call', () => ({ result: {} }))
  // every write takes a few turns of the event loop, so calls overlap it
  on('fs.write', async (_, e) => {
    for (let i = 0; i < 5; i++) await Promise.resolve()
    if (fail) throw new Error('disk full')
    writes.push({ path: e.path, text: e.text })
    return { value: undefined }
  })
  await Promise.all([
    $.tool.call({ tool: 'Read', file_path: '/w/a.ts' }),
    $.tool.call({ tool: 'Read', file_path: '/w/b.ts' }),
    $.tool.call({ tool: 'Read', file_path: '/w/c.ts' }),
  ])
  const counts = writes.filter(w => w.path.endsWith('.txt')).map(w => Number(w.text.match(/(\d+) calls/)![1]))
  expect(counts.at(-1)).toBe(3)
  for (let i = 1; i < counts.length; i++) expect(counts[i]!).toBeGreaterThanOrEqual(counts[i - 1]!)
  expect(writes.filter(w => w.path.endsWith('/.gitignore')).length).toBe(1)
  // a write that fails costs nothing lasting: the next call's text holds every entry
  fail = true
  await $.tool.call({ tool: 'Read', file_path: '/w/d.ts' })
  fail = false
  await $.tool.call({ tool: 'Read', file_path: '/w/e.ts' })
  const last = writes.filter(w => w.path.endsWith('.txt')).at(-1)!.text
  expect(last).toContain('5 calls')
  expect(last).toContain('d.ts')
})
