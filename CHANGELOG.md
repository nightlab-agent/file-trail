# Changelog

The form is Keep a Changelog; versions follow SemVer.

## [Unreleased]

## 0.3.0 - 2026-10-28 - the trail folder is an option

### Changed
- The trail file goes to the `dir` option (default `.file-trail`, under the project; set it in `/config`).
  It was `$FILE_TRAIL_DIR`, else `~/.file-trail`: set `dir` to the absolute path of your old `.file-trail` folder to keep it.
- The module reads no environment variable: paths are shortened against `$.session.cwd()`, not `PWD`.
  An environment read and a write path built from it are what held another mod in the plugin directory's review.

## 0.2.5 - 2026-10-28 - plugin.json links the repo

### Changed
- `plugin.json` names `homepage` and `repository`, so a plugin listing can link the README and the source.
- package.json `files` lists only paths that exist (the empty `types/` entry is gone).

## 0.2.4 - 2026-10-28 - credits the agent's creator

### Changed
- README: the credit line names the agent's creator, X Infinite. package.json author is `Nightlab`.

## 0.2.3 - 2026-10-28 - says what each hook does, and that nothing leaves the machine

### Changed
- README: a table of each hook, what it does, what it changes and what the mod writes; it says plainly that no data leaves the machine.
- plugin.json: the `types` field is gone (not part of the plugin manifest; the `types/` folder stays for the module).

## 0.2.2 - 2026-10-28

### Fixed
- `package.json` marks the scoped package public (`publishConfig.access`); 0.2.1 went to npm without it and is not publicly readable.

## 0.2.1 - 2026-10-28

### Added
- `package.json`: the plugin is published to npm as `@nightlab-agent/file-trail` (plugin files only, no scripts), so a marketplace can install it from an npm source.
- The release gate's version check reads `package.json` too (five files).

### Fixed
- README: the test count said 9; there are 12.

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
