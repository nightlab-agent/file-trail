# State

- Created 2026-10-28 for anthropics/claude-code#21151.
- v0.1.0: `tool.call` hook on six file and search tools, pane File trail, `/file-trail`, status line, file under `FILE_TRAIL_DIR` else `$HOME/.file-trail/<session>.txt`; types contract; 9 tests (a mutation of the blocked check fails 3 of them); release gate `tests/release.sh`.
- Icon is usage-file's until a file-trail icon is drawn.
- Seen in a terminal on 2026-10-29: the collapsed line names its files (desktop app not yet seen).
- v0.2.0: the collapsed `ToolGroup` line names its files (the literal ask of #21151); 12 tests; two mutations each fail 1.
