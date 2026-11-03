import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, ToolCallResult } from 'claude-code'

import type { Entry } from '../types'

// file-trail: which file each file tool touched, with the time and whether it
// was blocked, in one place the collapsed conversation view does not show
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

/** The trail file's state in this session: whether a write is in flight, whether one is owed, whether
 * the folder is the mod's own (so it gets a .gitignore), the working folder its .gitignore was last
 * written under, and the newest entries to write with the number of the call that kept them. */
type TrailFile = {
  writing: Promise<void> | null
  owed: boolean
  own: boolean
  ignoredUnder: string | null
  newest: { n: number; all: Entry[]; session: string; calls: number } | null
}

/** One trail write at a time, always from the newest entries kept: a call that finds a write in flight
 * marks the file as owed and goes on; the call doing the write then writes again, from the newest
 * entries, until nothing is owed. So a late answer from the engine can never put the file back a step,
 * no call waits on another call's write, and a failed write is made up by the next call, whose text
 * holds every entry so far. Before the first write of a session: `<dir>/.gitignore` holding `*`, so git
 * ignores the folder in every project with no step from the user (the trail names every file the
 * session touched). */
async function writeTrail($: EngineInterface, dir: string, file: TrailFile) {
  if (file.writing) {
    file.owed = true
    return
  }
  let done!: () => void
  file.writing = new Promise<void>(r => (done = r))
  try {
    do {
      file.owed = false
      // a relative dir follows the session's folder (/cd, a worktree): each new folder gets its .gitignore
      if (file.own) {
        const cwd = await $.session.cwd().catch(() => '')
        if (file.ignoredUnder !== cwd) {
          await $.fs.write(`${dir}/.gitignore`, '*\n')
          file.ignoredUnder = cwd
        }
      }
      if (file.newest) await $.fs.write(trailPath(dir, file.newest.session), fileText(file.newest.all, file.newest.session, file.newest.calls))
    } while (file.owed)
  } finally {
    file.writing = null
    done()
  }
}

const trailPath = (dir: string, session: string) => `${dir}/${session || 'session'}.txt`

/** A conversation a /clear or a resume ended: its id, its whole list (the calls that began in it and
 * came back after the end too), its count, and its writes, one after another. */
type Ended = { gen: number; session: string; all: Entry[]; calls: number; saving: Promise<void> }

/** Writes the ended conversation's file from its newest list, after any write in flight (which may be
 * of its older list), so the file never goes back a step. */
const saveEnded = ($: EngineInterface, dir: string, file: TrailFile, gone: Ended) => {
  gone.saving = gone.saving
    .then(async () => {
      while (file.writing) await file.writing
      await $.fs.write(trailPath(dir, gone.session), fileText(gone.all, gone.session, Math.max(gone.calls, gone.all.length)))
    })
    .catch(() => {
      // the ended file misses a write; the next conversation's is untouched
    })
  return gone.saving
}

export const register: Register = (on, options) => {
  // Only a folder named .file-trail is the mod's own; any other may hold the user's files (even be the
  // project itself, `.`), so no .gitignore is written there.
  const own = String(options.dir || '.file-trail').replace(/[\\/]+$/, '').split(/[\\/]/).at(-1) === '.file-trail'
  const file: TrailFile = { writing: null, owed: false, own, ignoredUnder: null, newest: null }
  // numbers the calls in the order their entries were saved: the attempt `update` saves read the value the
  // call before it saved, so it runs after that call's attempt, whenever either call's answer comes back
  let seq = 0
  // The conversation's number, raised at a /clear or a resume, so a call that began before one keeps
  // nothing in the next conversation's trail.
  let generation = 0
  // Every call of the conversation kept in this process, the ones past KEEP too.
  let calls = 0
  // The `dir` option; a relative folder is under the project the session runs in.
  const dir = String(options.dir || '.file-trail')
  // The conversation the last /clear or resume ended, for the calls that began in it.
  let ended: Ended | null = null
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
    const cwd = await $.session.cwd().catch(() => '')
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
    return { text: `File trail opened: ${Math.max(calls, all.length)} calls this session, ${blocked} blocked.` }
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

  // A settings PreToolUse hook (the chain runs it beneath every hooks module) that denies a call
  // comes back to tool.call as an error result; its own event shows the deny, so it is marked here.
  // The two events carry copies of the call, alike in tool_use_id.
  const denied = new Set<string>()
  // A /clear or a resume ends the conversation, not the process: it goes on under another session id
  // with no session.start, so the ended conversation's calls would carry into the next one's trail and pane.
  // The end step (next) may move the process to the next session id before it returns, so the
  // conversation's number is raised before it, with the ending id (e.sessionId) kept beside it: a call
  // that began in the ended conversation is never kept in the next one's list, and its entry goes to
  // the ended conversation's own file, whenever its answer or its session id read comes back.
  on('session.end', async ($, e, next) => {
    const ends = e.reason === 'clear' || e.reason === 'resume'
    if (ends) {
      const gone: Ended = { gen: generation, session: e.sessionId, all: [], calls, saving: Promise.resolve() }
      ended = gone
      generation++
      calls = 0
      file.newest = null
      try {
        // the late calls added during the read come after the ones kept before the end
        gone.all = [...(await read($, entries)), ...gone.all].slice(-KEEP)
      } catch {
        // the ended file holds only its late calls
      }
      if (gone.all.length > 0) await saveEnded($, dir, file, gone)
    }
    const r = await next(e)
    if (ends) {
      try {
        await update($, entries, () => [])
        file.newest = null
      } catch {
        // the old calls stay in the pane until the next call
      }
    }
    return r
  })

  on('classic.PreToolUse', async ($, e, next) => {
    const r = await next(e)
    if (r?.deny !== undefined && e.tool_use_id) denied.add(e.tool_use_id)
    return r
  })

  on('tool.call', async ($, e, next) => {
    const mineGen = generation
    const r = await next(e)
    // a deny an outer hook overruled let the call run: only a call that came back refused is blocked
    const blocked = e.tool_use_id !== undefined && denied.delete(e.tool_use_id) && r.isError === true
    if (!(TOOLS as readonly string[]).includes(e.tool)) return r
    try {
      const cwd = await $.session.cwd().catch(() => '')
      const entry: Entry = {
        at: new Date().toISOString(),
        tool: e.tool,
        target: shorten(targetOf(e as unknown as Record<string, unknown>), cwd),
        outcome: blocked ? 'blocked' : outcomeOf(r),
        ...(e.agentId ? { agentId: e.agentId } : {}),
      }
      let mine = 0
      const all = await update($, entries, xs => {
        // a call that began in an ended conversation is not the next one's
        if (generation !== mineGen) return xs
        mine = ++seq
        return [...xs, entry].slice(-KEEP)
      })
      if (mine === 0) {
        // began in a conversation a /clear or a resume has ended since: its entry is that one's
        const gone = ended
        if (gone !== null && gone.gen === mineGen) {
          gone.all = [...gone.all, entry].slice(-KEEP)
          gone.calls++
          await saveEnded($, dir, file, gone)
        }
        return r
      }
      // counted once the entry is kept: an attempt `update` retried runs its function again
      const count = generation === mineGen ? ++calls : 0
      // a call saved after this one has shown its own entry already
      if (mine === seq) {
        try {
          $.ui.status(statusText(`${entry.tool} ${entry.target}${entry.outcome === 'ok' ? '' : ` (${entry.outcome})`}`))
        } catch {
          // a surface with no status line
        }
      }
      let session = ''
      try {
        session = await $.session.id()
      } catch {
        // no session id on this host: one file for all
      }
      // a call saved later has kept its entries already, and they hold this one too
      // the session id read after an end names the next conversation: the end wrote this call's file
      if (generation !== mineGen) return r
      if (!file.newest || mine > file.newest.n) file.newest = { n: mine, all, session, calls: Math.max(count, all.length) }
      await writeTrail($, dir, file)
    } catch {
      // the trail misses one write; the call's result is untouched
    }
    return r
  })
}
