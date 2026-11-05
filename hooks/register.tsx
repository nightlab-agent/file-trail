import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, ToolCallResult } from 'claude-code'

import type { Entry } from '../types'
import { fileText, groupLine, groupNames, lineOf, outcomeOf, statusText, targetOf, TOOLS } from './text'
export { cut, fileText, groupLine, groupNames, lineOf, outcomeOf, shorten, statusText, targetOf, TOOLS, width } from './text'

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

const PANE = 'file-trail'
const TITLE = 'File trail'
/** Entries kept in the session's state and the file. */
export const KEEP = 1000
/** Entries the pane draws, newest first. */
export const SHOW = 40

// Change the tag when Entry's fields change: it declines what an earlier version stored.
const entries = atom({ plugin: 'file-trail', key: 'entries' } as const, [] as Entry[], { shape: 'entries-1' })

/** The trail file's state in this session: whether a write is in flight, whether one is owed, whether
 * the folder is the mod's own (so it gets a .gitignore), the folder its .gitignore was last written in,
 * and the newest entries to write with the number of the call that kept them. */
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
 * no live call waits on another call's write (a late call and the end step wait for any write in
 * flight, live or ended, and for the ended file's earlier saves), and a failed write is made up by the next call, whose text
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
      const dirNow = await folderOf($, dir)
      await ignore($, dirNow, file)
      if (file.newest) await $.fs.write(trailPath(dirNow, file.newest.session), fileText(file.newest.all, file.newest.session, file.newest.calls))
    } while (file.owed)
  } finally {
    file.writing = null
    done()
  }
}

/** The folder the trail goes in right now: `dir` as given when absolute, else under the session's root.
 * A relative path handed to $.fs.write would resolve under the working folder, which a shell cd moves;
 * the root moves only with /cd or a worktree (declarations, session.root). On a host with no root, the
 * working folder; with neither, `dir` as it stands. */
async function folderOf($: EngineInterface, dir: string) {
  if (/^([\\/]|[A-Za-z]:[\\/])/.test(dir)) return dir
  const base = await $.session.root().catch(() => $.session.cwd()).catch(() => '')
  return base ? `${base.replace(/[\\/]+$/, '')}/${dir}` : dir
}

/** Before a trail file is written in a folder of the mod's own, that folder gets its .gitignore, once per
 * folder and again whenever it is gone (deleting the folder is the README's way to forget a trail). A
 * check that fails is taken as the file gone: writing it again costs one write, and a trail file with no
 * .gitignore beside it is open to git. */
async function ignore($: EngineInterface, dir: string, file: TrailFile) {
  if (!file.own) return
  if (file.ignoredUnder === dir && (await $.fs.exists(`${dir}/.gitignore`).catch(() => false))) return
  await $.fs.write(`${dir}/.gitignore`, '*\n')
  file.ignoredUnder = dir
}

const trailPath = (dir: string, session: string) => `${dir}/${session || 'session'}.txt`

/** A conversation a /clear or a resume ended: its id, its whole list (the calls that began in it and
 * came back after the end too), its count, its writes, one after another, and whether a later
 * conversation of the same id (a resume back into it) has kept a call since, and the list as the end
 * read it, for a call saved after that read. */
type Ended = { gen: number; session: string; all: Entry[]; calls: number; saving: Promise<void>; resumed: boolean; read: Promise<Entry[]> }

/** Writes the ended conversation's file from its newest list, after any write in flight (which may be
 * of its older list), so the file never goes back a step. It holds the same one-at-a-time lock as the
 * live writes, so a live call that arrives meanwhile is owed and written after it. Once a conversation
 * resumed into the same id has kept a call, the file is that one's: checked right before the write,
 * and the ended list is not written over it. */
const saveEnded = ($: EngineInterface, dir: string, file: TrailFile, gone: Ended) => {
  gone.saving = gone.saving
    .then(async () => {
      while (file.writing) await file.writing
      let done!: () => void
      file.writing = new Promise<void>(r => (done = r))
      try {
        const dirNow = await folderOf($, dir)
        await ignore($, dirNow, file)
        if (!gone.resumed) await $.fs.write(trailPath(dirNow, gone.session), fileText(gone.all, gone.session, Math.max(gone.calls, gone.all.length)))
      } catch {
        // the ended file misses this write; a live call owed meanwhile is still written below
      } finally {
        file.writing = null
        done()
      }
      if (file.owed) await writeTrail($, dir, file)
    })
    .catch(() => {
      // the owed live write failed too; the next live call writes every entry so far
    })
  return gone.saving
}

/** Read, Write and Edit refuse a path a deny rule names in their own input check, before PreToolUse and
 * before tool.check (Claude Code 2.1.312), so no event names the call and it comes back as a plain error.
 * For an error result only, the engine's own permission decision is asked; the query runs nothing. A deny
 * rule on the path means the call cannot have run. Write and Edit are asked about as a Read of the path
 * too: their input check refuses a path a Read rule covers, and the query, which runs the tool's permission
 * check and not its input check, reads their own edit rules only. A subagent's call is not asked about:
 * the query carries no agentId (declarations, ToolCheckInput), so its answer is the main conversation's
 * rules and proves nothing about a subagent's. Unproven, or a query that fails, leaves the call an error. */
async function ruleRefused($: EngineInterface, e: Record<string, unknown>, r: ToolCallResult) {
  if (r.isError !== true || e.agentId) return false
  try {
    const { tool, tool_use_id: _id, agentId: _agent, consent: _consent, requestMeta: _meta, ...input } = e
    if ((await $.tool.check({ tool: tool as string, input })).decision === 'deny') return true
    if (tool !== 'Write' && tool !== 'Edit') return false
    return (await $.tool.check({ tool: 'Read', input: { file_path: input.file_path } })).decision === 'deny'
  } catch {
    return false
  }
}

/** A verdict that ends the call refused unless something above overrules it: a deny, or an ask with no
 * approver (the declarations' `approver`: absent where nobody can be asked). */
export const refusedVerdict = (decision: string, approver: string | undefined) =>
  decision === 'deny' || (decision === 'ask' && approver === undefined)

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
  // The `dir` option; a relative folder is under the project the session runs in (folderOf).
  const dir = String(options.dir || '.file-trail')
  // The conversations a /clear or a resume ended, by number, for the calls that began in them; one is
  // dropped once it is ended and none of its calls is still out (so two ends before one answer lose nothing).
  const ended = new Map<number, Ended>()
  const out = new Map<number, number>()
  const settle = (gen: number) => {
    if ((out.get(gen) ?? 0) > 0) return
    out.delete(gen)
    if (gen !== generation) ended.delete(gen)
  }
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

  // A settings PreToolUse hook (the chain runs it beneath every hooks module) or the permission step that
  // refuses a call comes back to tool.call as an error result; their own events show it, so it is marked
  // there. The events carry copies of the call, alike in tool_use_id.
  const denied = new Set<string>()
  // A tool that ran and failed raises PostToolUseFailure before tool.call's answer; a refused call raises
  // none (2.1.312). So a deny an outer hook overruled, which this module's hook cannot see, ends here.
  const ran = new Set<string>()
  // A /clear or a resume ends the conversation, not the process: it goes on under another session id
  // with no session.start, so the ended conversation's calls would carry into the next one's trail and pane.
  // The end step (next) may move the process to the next session id before it returns, so the
  // conversation's number is raised before it, with the ending id (e.sessionId) kept beside it: a call
  // that began in the ended conversation is never kept in the next one's list, and its entry goes to
  // the ended conversation's own file, whenever its answer or its session id read comes back.
  on('session.end', async ($, e, next) => {
    const ends = e.reason === 'clear' || e.reason === 'resume'
    if (ends) {
      // the list as the end read it: a call whose save lands after this read is not in it
      const listed = read($, entries)
      const gone: Ended = { gen: generation, session: e.sessionId, all: [], calls, saving: Promise.resolve(), resumed: false, read: listed.catch(() => []) }
      ended.set(gone.gen, gone)
      generation++
      calls = 0
      file.newest = null
      try {
        // the late calls added during the read come after the ones kept before the end
        gone.all = [...(await listed), ...gone.all].slice(-KEEP)
      } catch {
        // the ended file holds only its late calls
      }
      if (gone.all.length > 0) await saveEnded($, dir, file, gone)
      settle(gone.gen)
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

  on('classic.PostToolUseFailure', async ($, e, next) => {
    ran.add(e.tool_use_id)
    return next(e)
  })

  // Listens to the six tools only: a tool.check hook on a tool changes how the engine treats that tool's
  // asks (a kept ask is not reused), so no other tool's call is touched. Passes the verdict on unchanged,
  // the same object, so the engine reads its own decision and the model its own reason. An ask with no
  // approver has nobody to answer it, so it ends refused unless a PermissionRequest hook or the classifier
  // lets it run; tool.call still needs the error result to call it blocked.
  on('tool.check', { tool: new RegExp(`^(${TOOLS.join('|')})$`) }, async ($, e, next) => {
    const r = await next(e)
    if (e.tool_use_id && refusedVerdict(r.decision, e.approver)) denied.add(e.tool_use_id)
    return r
  })

  on('tool.call', async ($, e, next) => {
    const mineGen = generation
    out.set(mineGen, (out.get(mineGen) ?? 0) + 1)
    try {
      const r = await next(e)
      // a deny an outer hook overruled let the call run: only a call that came back refused is blocked
      const marked = e.tool_use_id !== undefined && denied.delete(e.tool_use_id) && r.isError === true
      const failed = e.tool_use_id !== undefined && ran.delete(e.tool_use_id)
      if (!(TOOLS as readonly string[]).includes(e.tool)) return r
      try {
        const blocked = !failed && (marked || (await ruleRefused($, e as unknown as Record<string, unknown>, r)))
        const cwd = await $.session.cwd().catch(() => '')
        const entry: Entry = {
          at: new Date().toISOString(),
          tool: e.tool,
          target: targetOf(e as unknown as Record<string, unknown>, cwd),
          outcome: blocked ? 'blocked' : outcomeOf(r),
          ...(e.agentId ? { agentId: e.agentId } : {}),
        }
        let mine = 0
        const all = await update($, entries, xs => {
          // a call that began in an ended conversation is not the next one's
          // an attempt `update` runs again starts over: only the attempt that saved counts
          mine = 0
          if (generation !== mineGen) return xs
          mine = ++seq
          return [...xs, entry].slice(-KEEP)
        })
        // saved in time for this conversation, but after the end read the list: the ended file lacks it,
        // and the end's clear will drop it from the list, so it goes the late way
        const goneNow = ended.get(mineGen)
        if (mine !== 0 && goneNow !== undefined) {
          const same = (x: Entry) => x.at === entry.at && x.tool === entry.tool && x.target === entry.target && x.agentId === entry.agentId
          // two calls on one file can share a millisecond: counted, so a twin the end read does not stand in
          // for this one (at the KEEP cap a twin at the head of the read can be cut from `all`: not covered)
          const twins = (xs: Entry[]) => xs.filter(same).length
          if (twins(await goneNow.read) < twins(all)) mine = 0
        }
        if (mine === 0) {
          // began in a conversation a /clear or a resume has ended since: its entry is that one's
          const gone = ended.get(mineGen)
          if (gone !== undefined) {
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
        // a resume back into an ended id: this conversation's list owns the file from here on
        for (const gone of ended.values()) if (gone.session === file.newest.session) gone.resumed = true
        await writeTrail($, dir, file)
      } catch {
        // the trail misses one write; the call's result is untouched
      }
      return r
    } finally {
      out.set(mineGen, (out.get(mineGen) ?? 1) - 1)
      settle(mineGen)
    }
  })
}
