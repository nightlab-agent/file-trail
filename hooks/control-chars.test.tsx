import { expect, test } from 'claude-code/testing'

import { fileText, groupNames, lineOf, statusText, targetOf, visible } from './text'

// What the engine refuses in a text child (2.1.312, read from the binary and the kit that shares it): the
// control characters but tab, newline and return, U+10EEEE, and U+2800 before a combining mark. A refused
// tree draws nothing. Tab, newline and return pass the check and break a line instead. A lone surrogate is
// not refused: it is drawn as U+FFFD, seen in the kit.
const PANE = {
  plugin: 'file-trail',
  component: 'Pane',
  requestId: 'file-trail',
  props: { title: 'File trail', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const
const REFUSED: [string, string][] = [
  ['bell', 'a\u0007b'],
  ['escape', 'a\u001b[31mb'],
  ['delete', 'a\u007fb'],
  ['a C1 control', 'a\u0085b'],
  ['the image placeholder', 'a\u{10eeee}b'],
  ['a braille blank before a mark', 'a\u2800\u0305b'],
]

type Written = { path: string; text: string }
const world = (on: any) => {
  const writes: Written[] = []
  const statuses: (string | undefined)[] = []
  on('session.cwd', () => ({ value: '/w' }))
  on('session.id', () => ({ value: 'sess-1' }))
  on('ui.status', (_: unknown, e: { text?: string }) => {
    statuses.push(e.text)
    return { value: undefined }
  })
  on('fs.write', (_: unknown, e: Written) => {
    writes.push({ path: e.path, text: e.text })
    return { value: undefined }
  })
  on('tool.call', () => ({ result: {} }))
  return { writes, statuses }
}
const trail = (ws: Written[]) => ws.filter(w => w.path.endsWith('sess-1.txt')).at(-1)!.text

for (const [name, target] of REFUSED) {
  test(`the pane still draws after a path holding ${name}`, async ($, on) => {
    world(on)
    await $.tool.call({ tool: 'Read', file_path: `/w/${target}` })
    await $.tool.call({ tool: 'Read', file_path: '/w/next.ts' })
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    expect((await ui.find({ type: 'Text', text: /next\.ts/ }))?.text).toContain('Read')
  })
}

test('a pattern holding a control character does not blank the pane', async ($, on) => {
  world(on)
  await $.tool.call({ tool: 'Grep', pattern: 'a\u0001b' } as never)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /Grep/ }))?.text).toContain('a\\u{1}b')
})

test('a newline in a path cannot forge a line in the file', async ($, on) => {
  const { writes } = world(on)
  await $.tool.call({ tool: 'Read', file_path: '/w/a\n2026-10-28T08:12:09.377Z   Read         nothing.ts' })
  const lines = trail(writes).trimEnd().split('\n')
  expect(lines.length).toBe(2)
  expect(lines[1]).toContain('a\\u{a}2026-10-28')
})

test('return and tab cannot move the line either; an escape sequence never reaches the file', async ($, on) => {
  const { writes } = world(on)
  await $.tool.call({ tool: 'Read', file_path: '/w/a\rb\tc\u001b[2Jd' })
  expect(trail(writes)).toContain('a\\u{d}b\\u{9}c\\u{1b}[2Jd')
  expect(trail(writes)).not.toMatch(/[\r\t\u001b]/)
})

test('the status line and the group line show the escaped name', async ($, on) => {
  const { statuses } = world(on)
  await $.tool.call({ tool: 'Read', file_path: '/w/a\u0007b' })
  expect(statuses.at(-1)).toBe('Read a\\u{7}b')
  expect(groupNames([{ tool: 'Read', input: { file_path: '/w/a\nb' }, isErrored: false }], '/w')).toEqual(['a\\u{a}b'])
})

test('an entry stored before this version, with the raw character, draws escaped', () => {
  const stored = { at: '2026-10-28T08:12:09.377Z', tool: 'Read', target: 'a\u0007\nb', outcome: 'ok' } as const
  expect(lineOf(stored)).toContain('a\\u{7}\\u{a}b')
  expect(fileText([stored], 's').trimEnd().split('\n').length).toBe(2)
})

test('escaping twice is escaping once', () => {
  const once = visible('a\u0007\n\ud800b')
  expect(visible(once)).toBe(once)
  expect(once).toBe('a\\u{7}\\u{a}\\u{d800}b')
})

test('a lone surrogate is written out, so the path it stands in is not shown as U+FFFD', async ($, on) => {
  const { writes } = world(on)
  await $.tool.call({ tool: 'Read', file_path: '/w/a\ud800b' })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /Read/ }))?.text).toContain('a\\u{d800}b')
  expect(trail(writes)).toContain('a\\u{d800}b')
})

test('a right-to-left override cannot reverse the end of a path', () => {
  expect(targetOf({ file_path: '/w/report\u202Egnp.exe' }, '/w')).toBe('report\\u{202e}gnp.exe')
})

test('a line and a paragraph separator are written out', () => {
  expect(visible('a\u2028b\u2029c')).toBe('a\\u{2028}b\\u{2029}c')
})

test('comparison: ordinary names are left alone, wide letters, emoji, a joined emoji, accents, Windows slashes', () => {
  for (const s of ['日本語.ts', '🚀.md', '👩‍💻.md', 'cafe\u0301.txt', 'C:\\src\\a.ts', 'a\u2800b', '🇨🇦']) expect(visible(s)).toBe(s)
})

test('comparison: a status cut after an escape is still within 80 columns', () => {
  expect(statusText(`Read ${visible('\u0007'.repeat(40))}`).endsWith('…')).toBe(true)
})
