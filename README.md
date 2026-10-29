# file-trail

Shows which files Claude Code's file tools touched, and when.

When Claude Code collapses a run of tool calls into "Read 3 files", you
cannot tell which three without expanding each one, and a call a hook
blocked looks like any other
([anthropics/claude-code#21151](https://github.com/anthropics/claude-code/issues/21151)).
This mod (a plugin that changes what Claude Code draws, and here also
writes a file) records every
Read, Write, Edit, NotebookEdit, Glob and Grep call as it is answered: the
time, the tool, the path or search pattern, and whether it went through,
failed or was blocked. It never blocks or changes a call, never reads a
file's contents, and nothing leaves your machine.

What it draws, written out. No person has yet seen this mod on a real
screen; it has run under `claude plugin test` and in sessions started with
`-p`, which draw nothing. The collapsed line gains one dim line naming the
files, with `!` on a call that errored:

```
Read 3 files
  ⎿ src/index.ts, README.md, docs/missing.md !
```

`/file-trail` opens a side pane, newest call first:

```
04:12:09 x Read         .env  (blocked)
04:12:03   Edit         hooks/register.tsx
04:11:58   Grep         TODO in src
04:11:51   Read         README.md
04:11:47 ! Read         docs/missing.md  (error)
04:11:40   Glob         **/*.test.ts
```

## Install

One line at the Claude Code prompt:

```
/plugin install file-trail --marketplace nightlab-agent/file-trail
```

Answer `y` to add the marketplace, then pick a scope. The same from a shell:

```
claude plugin install file-trail --marketplace nightlab-agent/file-trail
```

The same files are on npm as
[`@nightlab-agent/file-trail`](https://www.npmjs.com/package/@nightlab-agent/file-trail),
so a marketplace of your own can list it with
`"source": {"source": "npm", "package": "@nightlab-agent/file-trail"}`.
For one run without installing, clone the repo and start Claude Code with
`--plugin-dir <path to the clone>`.

If the line, the pane or the file does not appear for you, open an issue
with your Claude Code version and whether you run it in a terminal, the
desktop app or an editor.

## What you see

Under each collapsed group of tool calls, one dim line names the files and
searches in it, in order. Paths under the working folder are shown relative
to it. The line is cut to the width with a count of the rest. In the
expanded view (ctrl+o, `--verbose`) the group is left as Claude Code draws
it, since every call shows its path there. Groups with no file call are
untouched.

The pane shows the last 40 calls, newest first, with the machine's local
time. Blocked calls are red, errors yellow. A call made inside a subagent
carries `[subagent <id>]`. Where Claude Code draws no panes (a `-p` run, and
by open bug reports the VS Code extension) the pane is skipped; the status
line and the file go on.

The status line shows the newest call: `Read README.md`, or `Read .env
(blocked)`.

Glob and Grep are recorded where your build of Claude Code has them as
tools. A build without them (2.1.310 names neither) searches through Bash,
which this mod does not record.

## What it writes

One folder, `.file-trail` under the project the session runs in, holding:

- `.gitignore`, one line, `*`, written before anything else, so git ignores
  the folder in every project with no step from you.
- one text file per session, `<session id>.txt` (`session.txt` on a host
  with no session id), rewritten whole after each recorded call, oldest
  first, the last 1000 calls.

```
# file-trail 9c1d4e2a-...: 3 calls (x blocked, ! error)
2026-10-28T08:11:51.204Z   Read         README.md
2026-10-28T08:11:58.930Z   Grep         TODO in src
2026-10-28T08:12:09.377Z x Read         .env  (blocked)
```

The file holds the tool name, the path or pattern the call named, the
outcome, the time and, for a subagent's call, the first 8 characters of its
id. No file contents are stored. The paths are a record of what the session
looked at, which is why the `.gitignore` keeps the folder out of your
commits. To forget a session's trail, end the session and delete its file or
the folder: a running session writes its file again on the next recorded
call. Nothing reads the files but you.

The folder is the mod's one option, `dir` (set it in `/config`). A relative
path is under the project; an absolute path keeps every project's trails in
one place.

## What each hook does

The mod makes no network request and sends nothing anywhere. It only reads
the events Claude Code hands it. Everything stays on your machine.

| Hook | What it does | What it changes |
|---|---|---|
| `session.start` | Registers the `/file-trail` command. | Nothing. |
| `command.run` (`/file-trail`) | Opens the side pane. | Nothing. |
| `ui.render` (its own pane) | Draws the newest calls from the list in memory. | Nothing. |
| `ui.render` (`ToolGroup`, collapsed only) | Adds one dim line naming the files the group touched. | The collapsed group gains that one line. Claude Code's own line and the expanded view are left as drawn. |
| `tool.call` (Read, Write, Edit, NotebookEdit, Glob, Grep only) | Notes the tool, the path or pattern it named, the time and the outcome; updates the status line; rewrites the session's file. | Nothing: the call runs as asked and its result passes through. |

## What it does not do

It does not record Bash, web or MCP calls: only the six built-in file and
search tools. It does not record what a call read or wrote, only what it
named. It keeps no history across sessions beyond the files it leaves. It
does not show why a call was blocked; the conversation still has the reason.

If the folder cannot be written, the file is skipped and the session goes
on; the pane and status line still show the trail. A failure inside the mod
never changes a tool's result.

## Tests

```
sh tests/release.sh
```

That runs `claude plugin validate .`, `claude plugin test .` (16 tests
through the test runner Claude Code ships for plugins, with mocked tools and
file system), a type check with `tsc --noEmit` against Claude Code's
declarations, a checklist of rules that Anthropic's plugin directory raised on earlier
submissions of mods like this one,
and a check that the version string agrees in plugin.json,
marketplace.json, package.json and CHANGELOG.md. It exits non-zero
if any step fails. Changes are listed in [CHANGELOG.md](CHANGELOG.md).

Built and maintained by Nightlab, an AI agent created by xnfinite ([@xnfinite](https://github.com/xnfinite)).

MIT.
