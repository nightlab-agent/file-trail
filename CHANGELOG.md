# Changelog

The form is Keep a Changelog; versions follow SemVer.

## [Unreleased]

## 0.4.3 - 2026-10-29

### Fixed
- A call that a settings PreToolUse hook denies is marked blocked, not error.
  Such a deny reaches the mod's tool.call hook as an error result; the mod now also reads the PreToolUse
  event itself and matches the two by the call's id. A test shows it beside a plugin-level deny.
- A call whose deny from beneath was overruled by a hook above (so it ran) is no longer marked blocked.
- The mod writes its `.gitignore` only in a folder named `.file-trail`: with the `dir` option set to `.`,
  it replaced the project's own `.gitignore` with `*`. The default folder still gets its `.gitignore`.
- README: says that a deny from an administrator-managed hook is marked error (the mod cannot see it).
- CHANGELOG: an older line named the creator in a form he does not use; it says xnfinite.

## 0.4.2 - 2026-10-29

### Fixed
- A path is cut to the working folder only when it starts with that folder: before, `/mnt/w/a.ts` with
  the working folder `/w` was shown as `/mnta.ts`. Two tests cover paths that repeat the folder's name.

### Changed
- README: the picture's address is the full GitHub one, so the npm page shows it too.
- README: a picture of the collapsed line from a Claude Code 2.1.312 terminal; scopes explained; how to
  uninstall; how it differs from ctrl+o and filetree. The repo's notes say what they mean in plain words.

## 0.4.1 - 2026-10-29 - a late session id no longer loses an entry

### Fixed
- Two file calls at once each wait on the session id before writing the trail file. When the first call's answer
  came back late, its text (one entry short) landed on top of the second call's, and the second entry was gone
  from the file until the next call. Now one write runs at a time, from the newest entries kept (the calls
  are numbered in the order their state updates resolved); a call that finds a write in flight marks the
  file as owed and goes on, and the writing call writes again until nothing is owed, then returns. So a
  call never waits on an earlier call's write, and the file never goes back a step. A failed write is made
  up by the next call. Found by karanb192 reviewing awesome-claude-code-mods PR #427; the test fails on 0.4.0.
- The `.gitignore` write happens inside that same single writer, so two first calls at once write it once.

### Changed
- `tsconfig.json`, which Claude Code lays beside a loaded mod with its type declarations, is ignored by git (it appeared here on 2026-10-29 after a session loaded the mod). `tests/typecheck.sh` tells tsc to ignore such an untracked file: tsc 7.0.2 stopped on it with error TS5112.

## 0.4.0 - 2026-10-29 - the trail folder is kept out of git

### Added
- Before its first write in a session the mod writes `<dir>/.gitignore` holding one line, `*`, so git ignores the trail
  folder in every project with no step from you. The trail names every file and search the session touched, and until
  now nothing kept a user from committing it with the project (found by an outside review, 2026-10-29).
- A test for it, which failed before the change.

### Changed
- README rewritten in plain words: what it draws, how to install it, what it writes and how to delete it. It no longer
  carries a version history (this file does), and no longer advertises other products.
- `tests/release.sh` checks the version string in four files (the README no longer carries one).

## 0.3.2 - 2026-10-28 - the README names the kit

### Added
- README: a Build your own section names the free template (mod-ready) and the paid Mod Field Kit.

## 0.3.1 - 2026-10-28 - the release script type-checks

### Changed
- README: the one-line install now sits under the README's first paragraph, with a link to the full Install section.
- package.json drops `publishConfig` (the publish service refuses it; the package is already public on npm, so nothing changes for installs).
- The checklist fails (was: warns) on a `publishConfig` in package.json, and fails on a package.json repository that is not the plugin's own GitHub repo.
- `tests/typecheck.sh` fails when `TSC` is neither an executable nor a command on PATH (before, it fell back to PATH), or when there is no hooks module file to check (before, it passed).
- The release script type-checks the hooks module, its tests and the state contract with `tsc --noEmit` against the
  engine's own declarations (`tests/typecheck.sh`, the compiler options the declarations' header gives a hooks module).
  No `tsc` or no declarations fails the release script; it never skips.

### Fixed
- The README says Glob and Grep are recorded only where the build has them as tools (the 2.1.310 declarations name neither; searches there run through Bash, which this mod does not record).

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
- README: the credit line names the agent's creator, xnfinite. package.json author is `Nightlab`.

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
- The release script's version check reads `package.json` too (five files).

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
- 9 tests under the engine's test kit; release script `tests/release.sh` (validate, test, version string in four files).
