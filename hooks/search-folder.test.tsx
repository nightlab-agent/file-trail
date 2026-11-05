import { expect, test } from 'claude-code/testing'

import { groupNames, shorten, targetOf } from './text'

// The README: "Paths under the working folder are shown relative to it." A Grep or Glob names its folder
// in `path`, usually absolute, the way the model sends it.
const world = (on: any) => {
  const statuses: (string | undefined)[] = []
  const texts: string[] = []
  on('session.cwd', () => ({ value: '/work/app' }))
  on('session.id', () => ({ value: 'sess-1' }))
  on('ui.status', (_: unknown, e: { text?: string }) => {
    statuses.push(e.text)
    return { value: undefined }
  })
  on('fs.write', (_: unknown, e: { text: string }) => {
    texts.push(e.text)
    return { value: undefined }
  })
  on('tool.call', () => ({ result: {} }))
  return { statuses, texts }
}

test('a search\'s folder under the working folder is shown relative, in the file and the status line', async ($, on) => {
  const { statuses, texts } = world(on)
  await $.tool.call({ tool: 'Grep', pattern: 'TODO', path: '/work/app/src' } as never)
  expect(texts.at(-1)).toContain('Grep         TODO in src')
  expect(statuses.at(-1)).toBe('Grep TODO in src')
})

test('the same in the group line, for a Glob too', () => {
  const calls = [
    { tool: 'Grep', input: { pattern: 'TODO', path: '/work/app/src' }, isErrored: false },
    { tool: 'Glob', input: { pattern: '**/*.ts', path: '/work/app/hooks' }, isErrored: false },
  ]
  expect(groupNames(calls, '/work/app')).toEqual(['TODO in src', '**/*.ts in hooks'])
})

test('a Windows working folder, either slash', () => {
  expect(targetOf({ pattern: 'x', path: 'C:/proj/src' }, 'C:\\proj')).toBe('x in src')
})

test('comparison: a folder elsewhere, a look-alike and a relative one stay as written', () => {
  expect(targetOf({ pattern: 'x', path: '/elsewhere/src' }, '/work/app')).toBe('x in /elsewhere/src')
  expect(targetOf({ pattern: 'x', path: '/work/app2/src' }, '/work/app')).toBe('x in /work/app2/src')
  expect(targetOf({ pattern: 'x', path: 'src' }, '/work/app')).toBe('x in src')
})

test('comparison: a pattern with no folder is shortened as a path was, and a pattern is not read as a folder', () => {
  expect(targetOf({ pattern: '/work/app/src/*.ts' }, '/work/app')).toBe('src/*.ts')
  expect(targetOf({ pattern: 'a in /work/app/b', path: '/other' }, '/work/app')).toBe('a in /work/app/b in /other')
})

test('comparison: with no working folder known, nothing changes; shorten still does paths', () => {
  expect(targetOf({ pattern: 'x', path: '/work/app/src' })).toBe('x in /work/app/src')
  expect(shorten('/work/app/a.ts', '/work/app')).toBe('a.ts')
})
