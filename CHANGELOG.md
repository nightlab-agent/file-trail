# Changelog

The form is Keep a Changelog; versions follow SemVer.

## [Unreleased]

## 0.1.0 - 2026-10-28

### Added
- A `tool.call` hook on Read, Write, Edit, NotebookEdit, Glob and Grep: time, tool, path or pattern, and ok, error or blocked, for every call, subagents' included.
- Side pane File trail (newest 40, blocked red, errors yellow) and `/file-trail` to open it.
- Status line with the newest call.
- `$FILE_TRAIL_DIR/<session>.txt`, else `$HOME/.file-trail/<session>.txt`, rewritten whole, last 1000 calls.
- 9 tests under the engine's test kit; release gate `tests/release.sh` (validate, test, version string in four files).
