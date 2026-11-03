import type { ToolCallResult } from 'claude-code'

import type { Entry } from '../types'

// file-trail's text: what each call names, how an entry reads in the pane, the status line and the file,
// and how wide that text is in terminal columns. No state and no engine calls: register.tsx does those.

export const TOOLS = ['Read', 'Write', 'Edit', 'NotebookEdit', 'Glob', 'Grep'] as const

/** What the call named: the path for file tools, the pattern (and folder) for searches. */
export const targetOf = (args: Record<string, unknown>) => {
  const s = (k: string) => (typeof args[k] === 'string' ? (args[k] as string) : '')
  const path = s('file_path') || s('notebook_path')
  if (path) return path
  const pattern = s('pattern')
  const where = s('path')
  return where ? `${pattern} in ${where}` : pattern
}

/** A path under the working folder, shown relative to it; anything else unchanged. */
export const shorten = (target: string, cwd: string) => {
  if (!cwd) return target
  // A Windows working folder (a drive letter, or backslashes and no slash): its paths may use either
  // slash and any case of letter, as Windows itself allows. The rest is shown as the path wrote it.
  if (/^[A-Za-z]:[\\/]/.test(cwd) || (cwd.includes('\\') && !cwd.includes('/'))) {
    const key = (p: string) => p.replace(/\//g, '\\').toLowerCase()
    const base = cwd.replace(/[\\/]+$/, '')
    const next = target[base.length]
    return (next === '\\' || next === '/') && key(target.slice(0, base.length)) === key(base)
      ? target.slice(base.length + 1)
      : target
  }
  const base = cwd.endsWith('/') ? cwd : `${cwd}/`
  return target.startsWith(base) ? target.slice(base.length) : target
}

export const outcomeOf = (r: ToolCallResult): Entry['outcome'] =>
  r.deny !== undefined ? 'blocked' : r.isError === true ? 'error' : 'ok'

const MARK: Record<Entry['outcome'], string> = { ok: ' ', error: '!', blocked: 'x' }

/** One line: `03:58:12 x Read   .env  (blocked)`; times are local to the machine. */
export const lineOf = (x: Entry) => {
  const t = new Date(x.at)
  const hms = [t.getHours(), t.getMinutes(), t.getSeconds()].map(n => String(n).padStart(2, '0')).join(':')
  const tail = x.outcome === 'ok' ? '' : `  (${x.outcome})`
  const who = x.agentId ? `  [subagent ${x.agentId.slice(0, 8)}]` : ''
  return `${hms} ${MARK[x.outcome]} ${x.tool.padEnd(12)} ${x.target}${tail}${who}`
}

/** What each file call in a group named, in order; an errored one carries `!`. */
export const groupNames = (calls: ReadonlyArray<{ tool: string; input: unknown; isErrored: boolean }>, cwd: string) =>
  calls
    .filter(c => (TOOLS as readonly string[]).includes(c.tool) && c.input !== null && typeof c.input === 'object')
    .map(c => ({ name: shorten(targetOf(c.input as Record<string, unknown>), cwd), isErrored: c.isErrored }))
    .filter(x => x.name !== '')
    .map(x => (x.isErrored ? `${x.name} !` : x.name))

// A character as the user sees it (a grapheme: a flag, an emoji with its skin tone or its joined
// parts, a letter with its accents) takes two terminal columns when any of its code points is in the
// common wide ranges below (Chinese, Japanese, Korean, full-width forms; JavaScript has no East Asian
// Width property) or is an emoji drawn as one, or it holds U+FE0F (asks for the emoji form).
const WIDE = /[\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFF60\uFFE0-\uFFE6\u{1F300}-\u{1FAFF}\u{20000}-\u{3FFFD}\uFE0F]|\p{Emoji_Presentation}/u
const GRAPHEMES = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
const graphemes = (s: string) => Array.from(GRAPHEMES.segment(s), x => x.segment)
const columnsOf = (g: string) => (WIDE.test(g) ? 2 : 1)
/** The columns a terminal gives the text. */
export const width = (s: string) => graphemes(s).reduce((n, g) => n + columnsOf(g), 0)
/** The text cut to `cols` columns, whole characters only (never half a flag or an emoji's parts),
 * `…` at a cut. */
export const cut = (s: string, cols: number) => {
  if (width(s) <= cols) return s
  let out = ''
  let used = 0
  for (const g of graphemes(s)) {
    if (used + columnsOf(g) > cols - 1) break
    out += g
    used += columnsOf(g)
  }
  return `${out}…`
}

/** One line under the group: the names, comma separated, cut to the width with how many are left. */
export const groupLine = (names: string[], columns: number) => {
  const room = Math.max(20, columns - 4)
  let line = '  ⎿ '
  for (let i = 0; i < names.length; i++) {
    const sep = i === 0 ? '' : ', '
    const rest = names.length - i - 1
    const more = rest > 0 ? `, +${rest} more` : ''
    if (width(line + sep + names[i] + more) > room) {
      if (i > 0) return `${line}, +${names.length - i} more`
      // a first name too long on its own is cut, so the line still fits
      return `${line}${cut(names[i]!, room - width(line) - width(more))}${more}`
    }
    line += sep + names[i]
  }
  return line
}

/** The status text cut to 80 columns, whole characters only. */
export const statusText = (s: string) => cut(s, 80)

/** The file's whole text, oldest first, one line per entry. */
export const fileText = (all: Entry[], session: string, calls = all.length) =>
  `# file-trail${session ? ` ${session}` : ''}: ${calls} calls (x blocked, ! error)\n` +
  all.map(x => `${x.at} ${lineOf(x).slice(9)}`).join('\n') +
  '\n'
