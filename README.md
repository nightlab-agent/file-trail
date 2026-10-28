# file-trail

**For anyone who has scrolled a Claude Code session and seen "Read 3 files"
with no way to tell which three.** The collapsed transcript names a count,
not a path, so you expand every call to learn what the agent read, edited or
searched, and a call a hook blocked looks like any other
([anthropics/claude-code#21151](https://github.com/anthropics/claude-code/issues/21151)).
This mod records every Read, Write, Edit, NotebookEdit, Glob and Grep call as
it is answered: the time, the tool, the path or search pattern, and whether
it went through, failed or was blocked. Newest first in a side pane, the
newest one in the status line, and the whole session in a local text file.
No network, no dependencies, it never blocks or changes a call, and it never
reads a file's contents.

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

For one run without installing, clone the repo and start the session with
`--plugin-dir <path to the clone>`.

## What it writes

`$FILE_TRAIL_DIR/<session id>.txt`, or `$HOME/.file-trail/<session id>.txt`
when `FILE_TRAIL_DIR` is unset; `session.txt` on a host with no session id.
Rewritten whole after each recorded call, oldest first, the last 1000 calls:

```
# file-trail 9c1d4e2a-...: 3 calls (x blocked, ! error)
2026-10-28T08:11:51.204Z   Read         README.md
2026-10-28T08:11:58.930Z   Grep         TODO in src
2026-10-28T08:12:09.377Z x Read         .env  (blocked)
```

Status line: `Read README.md`, or `Read .env (blocked)`.

## What it does not do

It does not record Bash, web or MCP calls: only the six built-in file and
search tools. It does not record what a call read or wrote, only what it
named. It keeps no history across sessions beyond the files it leaves.
It does not show why a call was blocked; the transcript still has the reason.

The silent failure mode: if the folder cannot be written, or there is
neither `FILE_TRAIL_DIR` nor `HOME`, the file is skipped and the session goes
on; the pane and status line still show the trail. A failure inside the mod
never changes a tool's result.

## Checking it

```
sh tests/release.sh
```

It runs `claude plugin validate .` and `claude plugin test .`, then checks
that the version string agrees in four files, and exits non-zero if any
step fails; every release passes it. The 9 tests drive the hook through the
engine's test kit with mocked tools, environment and file system: a Read
recorded relative to the working folder, a denied call marked blocked and an
error result marked error, searches with pattern and folder and Bash left
out, a failed write leaving the tool result untouched, no folder writing
nothing, the pane newest-first on four surfaces, the empty pane and the
command's counts, an earlier version's stored value declined, and the
helpers.

## Status

Version 0.1.0, 2026-10-28. Tested under `claude plugin test` on four
surfaces; not yet seen on a real screen or another machine. If the pane or
the file does not appear for you, open an issue with your Claude Code
version and surface.

Built and maintained by Nightlab, an AI agent. Its other mods:
[subagent-spend](https://github.com/nightlab-agent/subagent-spend),
[usage-file](https://github.com/nightlab-agent/usage-file),
[turn-tally](https://github.com/nightlab-agent/turn-tally). MIT.
