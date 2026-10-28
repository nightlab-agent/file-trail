import { atom, read, update } from 'claude-code'
import type { Register, ToolCallResult } from 'claude-code'

import type { Entry } from '../types'

// file-trail: which file each file tool touched, with the time and whether it
// was blocked, in one place the collapsed transcript does not show
// (anthropics/claude-code#21151: "Read 3 files" names none of them).
//
// On every Read, Write, Edit, NotebookEdit, Glob and Grep call it waits for the
// answer, then records one entry: time, tool, path or pattern, and ok, error or
// blocked. The newest entries draw in a side pane (/file-trail opens it), the
// newest one in the status line, and the session's whole trail is rewritten to
// one local text file, so a surface that draws no panes still has it.
//
// DESIGN NOTE, deliberately narrow: it never denies, never rewrites a call,
// never reads a file's contents, never touches the network. Every failure of
// its own is swallowed and the call's result is returned as the engine gave
// it: a trail that breaks a tool call would be worse than no trail.

export const TOOLS = ['Read', 'Write', 'Edit', 'NotebookEdit', 'Glob', 'Grep'] as const
const PANE = 'file-trail'
const TITLE = 'File trail'
/** Entries kept in the session's state and the file. */
export const KEEP = 1000
/** Entries the pane draws, newest first. */
export const SHOW = 40

// Change the tag when Entry's fields change: it declines what an earlier version stored.
const entries = atom({ plugin: 'file-trail', key: 'entries' } as const, [] as Entry[], { shape: 'entries-1' })

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
  const base = cwd.endsWith('/') ? cwd : `${cwd}/`
  return target.split(base).join('')
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

/** One line under the group: the names, comma separated, cut to the width with how many are left. */
export const groupLine = (names: string[], columns: number) => {
  const room = Math.max(20, columns - 4)
  let line = '  ⎿ '
  for (let i = 0; i < names.length; i++) {
    const sep = i === 0 ? '' : ', '
    const rest = names.length - i - 1
    const more = rest > 0 ? `, +${rest} more` : ''
    if (i > 0 && (line + sep + names[i] + more).length > room) return `${line}, +${names.length - i} more`
    line += sep + names[i]
  }
  return line
}

/** The file's whole text, oldest first, one line per entry. */
export const fileText = (all: Entry[], session: string) =>
  `# file-trail${session ? ` ${session}` : ''}: ${all.length} calls (x blocked, ! error)\n` +
  all.map(x => `${x.at} ${lineOf(x).slice(9)}`).join('\n') +
  '\n'

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    try {
      await $.command.register({ name: 'file-trail', description: 'Show which files and searches this session touched, newest first, in a pane' })
    } catch {
      // a surface with no commands; the status line and file go on
    }
    return next(e)
  })

  // The collapsed group ("Read 3 files") keeps the engine's own line and gains
  // one dim line naming what the file calls touched; expanded (ctrl+o) it is left alone.
  on('ui.render', { component: 'ToolGroup' }, async ($, e, next) => {
    const own = await next(e)
    if (e.props.isExpanded) return own
    const cwd = (await $.env.get('PWD')) || ''
    const names = groupNames(e.props.calls, cwd)
    if (names.length === 0) return own
    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        {own}
        <Text dimColor>{groupLine(names, e.viewport?.columns ?? 80)}</Text>
      </Box>
    )
  })

  on('command.run', { command: 'file-trail' }, async $ => {
    await $.ui.open({ id: PANE, title: TITLE })
    const all = await read($, entries)
    const blocked = all.filter(x => x.outcome === 'blocked').length
    return { text: `File trail opened: ${all.length} calls this session, ${blocked} blocked.` }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const all = await read($, entries)
    if (all.length === 0) {
      return (
        <Box flexDirection="column">
          <Text dimColor>No file or search calls yet in this session.</Text>
        </Box>
      )
    }
    const newest = all.slice(-SHOW).reverse()
    return (
      <Box flexDirection="column">
        {newest.map(x => (
          <Text color={x.outcome === 'blocked' ? 'red' : x.outcome === 'error' ? 'yellow' : undefined}>{lineOf(x)}</Text>
        ))}
        {all.length > SHOW && <Text dimColor>{`${all.length - SHOW} older in the file`}</Text>}
      </Box>
    )
  })

  on('tool.call', async ($, e, next) => {
    const r = await next(e)
    if (!(TOOLS as readonly string[]).includes(e.tool)) return r
    try {
      const cwd = (await $.env.get('PWD')) || ''
      const entry: Entry = {
        at: new Date().toISOString(),
        tool: e.tool,
        target: shorten(targetOf(e as unknown as Record<string, unknown>), cwd),
        outcome: outcomeOf(r),
        ...(e.agentId ? { agentId: e.agentId } : {}),
      }
      const all = await update($, entries, xs => [...xs, entry].slice(-KEEP))
      try {
        $.ui.status(`${entry.tool} ${entry.target}${entry.outcome === 'ok' ? '' : ` (${entry.outcome})`}`.slice(0, 80))
      } catch {
        // a surface with no status line
      }
      const home = await $.env.get('HOME')
      const dir = (await $.env.get('FILE_TRAIL_DIR')) || (home ? `${home}/.file-trail` : '')
      if (dir) {
        let session = ''
        try {
          session = await $.session.id()
        } catch {
          // no session id on this host: one file for all
        }
        await $.fs.write(`${dir}/${session || 'session'}.txt`, fileText(all, session))
      }
    } catch {
      // the trail misses one entry; the call's result is untouched
    }
    return r
  })
}
