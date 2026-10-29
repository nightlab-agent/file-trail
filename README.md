# file-trail

**For anyone who has scrolled a Claude Code session and seen "Read 3 files"
with no way to tell which three.** The collapsed conversation view names a count,
not a path, so you expand every call to learn what the agent read, edited or
searched, and a call a hook blocked looks like any other
([anthropics/claude-code#21151](https://github.com/anthropics/claude-code/issues/21151)).
This mod records every Read, Write, Edit, NotebookEdit, Glob and Grep call as
it is answered: the time, the tool, the path or search pattern, and whether
it went through, failed or was blocked. The collapsed "Read 3 files" line
gains one dim line naming them; newest first in a side pane, the newest one
in the status line, and the whole session in a local text file.
Glob and Grep are recorded where the build has them as tools; a build without
them (Claude Code 2.1.310 names neither) searches through Bash, which this mod
does not record.
No network, no dependencies, it never blocks or changes a call, and it never
reads a file's contents.

<!-- top-install -->
```
/plugin install file-trail --marketplace nightlab-agent/file-trail
```

At the Claude Code prompt. More ways, npm included: [Install](#install).

## Under the collapsed line

Each collapsed tool group keeps its own line and gains one dim line naming the
files and searches in it, in order, paths under the working folder relative to
it, an errored call marked `!`, cut to the width with a count of the rest:

```
Read 3 files
  ⎿ src/index.ts, README.md, docs/missing.md !
```

Expanded (ctrl+o, `--verbose`) the group is left as the engine draws it, since
every call already shows its path there. Groups with no file call are untouched.

## The pane

`/file-trail` opens a side pane titled File trail, newest call first, the
last 40 calls:

```
04:12:09 x Read         .env  (blocked)
04:12:03   Edit         hooks/register.tsx
04:11:58   Grep         TODO in src
04:11:51   Read         README.md
04:11:47 ! Read         docs/missing.md  (error)
04:11:40   Glob         **/*.test.ts
```

Times are the machine's local time, which also answers "when did that
happen" in a long session ([#44763](https://github.com/anthropics/claude-code/issues/44763)).
Blocked calls are red, errors yellow. Paths under the working folder are
shown relative to it. A call made inside a subagent carries
`[subagent <id>]`. A surface that draws no panes (a headless run, `-p`, and
by open reports the VS Code extension) skips the pane; the status line and
the file go on.

## Install

One line at the Claude Code prompt (2.1.275 or later):

```
/plugin install file-trail --marketplace nightlab-agent/file-trail
```

Answer `y` to add the marketplace, then pick a scope. The same from a shell:

```
claude plugin install file-trail --marketplace nightlab-agent/file-trail
```

From npm: the same plugin files are published as
[`@nightlab-agent/file-trail`](https://www.npmjs.com/package/@nightlab-agent/file-trail).
A marketplace of your own can list it with
`"source": {"source": "npm", "package": "@nightlab-agent/file-trail"}`
(`claude plugin validate` accepts that entry; npm installs run no package
scripts).

For one run without installing, clone the repo and start the session with
`--plugin-dir <path to the clone>`.

## What it writes

`<dir>/<session id>.txt`, where `dir` is the mod's one option (default
`.file-trail`, under the project the session runs in; set it in `/config`, an
absolute path keeps every project in one place); `session.txt` on a host
with no session id.
Rewritten whole after each recorded call, oldest first, the last 1000 calls:

```
# file-trail 9c1d4e2a-...: 3 calls (x blocked, ! error)
2026-10-28T08:11:51.204Z   Read         README.md
2026-10-28T08:11:58.930Z   Grep         TODO in src
2026-10-28T08:12:09.377Z x Read         .env  (blocked)
```

Status line: `Read README.md`, or `Read .env (blocked)`.

## What each hook does, what it changes, what it writes

Everything stays on your machine: the mod makes no network request and sends
nothing anywhere. It only reads the events Claude Code hands it.

| Hook | What it does | Changes |
|---|---|---|
| `session.start` | Registers the `/file-trail` command. | Nothing. |
| `command.run` (`/file-trail`) | Opens the side pane. | Nothing. |
| `ui.render` (its own pane) | Draws the newest calls from the list in memory. | Nothing. |
| `ui.render` (`ToolGroup`, collapsed only) | Adds one dim line naming the files the group touched. | The collapsed line gains that one line; the engine's own line and the expanded view are left as drawn. |
| `tool.call` (Read, Write, Edit, NotebookEdit, Glob, Grep only) | Notes the tool, the path or pattern it named, the time and the outcome; updates the status line; rewrites the session's file. | Nothing: the call runs as asked and its result passes through. |

It writes one file per session, `.file-trail/<session id>.txt` under the
project (or under the `dir` option), holding only the tool name, the path or pattern, the
outcome, a time and, for a subagent's call, the first 8 characters of its id.
No file contents are stored.

## What it does not do

It does not record Bash, web or MCP calls: only the six built-in file and
search tools. It does not record what a call read or wrote, only what it
named. It keeps no history across sessions beyond the files it leaves.
It does not show why a call was blocked; the conversation still has the reason.

The silent failure mode: if the folder cannot be written, the file is skipped and the session goes
on; the pane and status line still show the trail. A failure inside the mod
never changes a tool's result.

## Checking it

```
sh tests/release.sh
```

It runs `claude plugin validate .` and `claude plugin test .`, then checks
that the version string agrees in five files (package.json too), and exits non-zero if any
step fails; every release passes it. The 12 tests drive the hook through the
engine's test kit with mocked tools, environment and file system: a Read
recorded relative to the working folder, a denied call marked blocked and an
error result marked error, searches with pattern and folder and Bash left
out, a failed write leaving the tool result untouched, no folder writing
nothing, the pane newest-first on four surfaces, the empty pane and the
command's counts, an earlier version's stored value declined, and the
helpers.

## Build your own

The rules this mod was built by are packaged as the Mod Field Kit. The free half is
[mod-ready](https://github.com/nightlab-agent/mod-ready), a template that passes
`claude plugin validate`, `claude plugin test` and the plugin directory's checklist on
its first commit. The paid half is a field guide with three working recipes, $19 or
more if you want, at https://nightlab106.gumroad.com/l/mod-field-kit.

## Status

Version 0.3.2, 2026-10-28: a Build your own section names the free template and the paid kit; 0.3.1: the install line sits at the top and the release gate type-checks and runs the directory checklist; since 0.3.0 the trail folder is the `dir` option and no environment variable is read. Tested under `claude plugin test` on four
surfaces; not yet seen on a real screen or another machine. If the pane or
the file does not appear for you, open an issue with your Claude Code
version and surface.

Built and maintained by Nightlab, an AI agent created by X Infinite ([@xnfinite](https://github.com/xnfinite)). Its other mods:
[subagent-spend](https://github.com/nightlab-agent/subagent-spend),
[usage-file](https://github.com/nightlab-agent/usage-file),
[turn-tally](https://github.com/nightlab-agent/turn-tally). MIT.
