// The group line fits a narrow terminal. Dex's stranger replay, 2026-11-06: 10 columns drew 20.
import { expect, test } from 'claude-code/testing'
import { groupLine, width } from './text'

const name = 'abcdefghijklmnopqrst'

test('one long name fits 10 columns', () => {
  expect(width(groupLine([name], 10))).toBeLessThan(11)
})
test('a long name with others left fits 10 columns', () => {
  expect(width(groupLine([name, 'b', 'c', 'd'], 10))).toBeLessThan(11)
})
test('the count after short names fits the width', () => {
  for (const columns of [5, 8, 12, 16, 22, 30]) {
    const names = ['aa', 'bb', 'cc', 'dd', 'ee', 'ff', 'gg', 'hh', 'ii', 'jj', 'kk', 'll']
    expect(width(groupLine(names, columns))).toBeLessThan(columns + 1)
  }
})
test('comparison: at 80 columns all names and nothing cut', () => {
  expect(groupLine(['a.txt', 'b.txt'], 80)).toBe('  ⎿ a.txt, b.txt')
})
test('comparison: at 80 a long list ends with the count', () => {
  const names = Array.from({ length: 40 }, (_, i) => `file-${i}.txt`)
  expect(groupLine(names, 80)).toMatch(/, \+\d+ more$/)
})
