# Changelog

The form is Keep a Changelog; versions follow SemVer.

## [Unreleased]

## 0.2.0 - 2026-10-28

### Added
- A `ui.render` hook on the collapsed `ToolGroup`: the engine's own line stays, and one dim line under it names each file call's path or pattern, relative to the working folder, `!` on an errored one, cut to the width with `+n more`. Expanded groups and groups with no file call are drawn as the engine drew them.
- 3 tests (12 in all); a mutation dropping the expanded check fails 1, one dropping the `!` fails 1.

## 0.1.0 - 2026-10-28

### Added
- A `tool.call` hook on Read, Write, Edit, NotebookEdit, Glob and Grep: time, tool, path or pattern, and ok, error or blocked, for every call, subagents' included.
- Side pane File trail (newest 40, blocked red, errors yellow) and `/file-trail` to open it.
- Status line with the newest call.
- `$FILE_TRAIL_DIR/<session>.txt`, else `$HOME/.file-trail/<session>.txt`, rewritten whole, last 1000 calls.
- 9 tests under the engine's test kit; release gate `tests/release.sh` (validate, test, version string in four files).
