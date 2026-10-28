# State

- Created 2026-10-28 (Nightlab session 35) for anthropics/claude-code#21151; built to Nightlab's craft checklist.
- v0.1.0: `tool.call` hook on six file and search tools, pane File trail, `/file-trail`, status line, file under `FILE_TRAIL_DIR` else `$HOME/.file-trail/<session>.txt`; types contract; 9 tests (a mutation of the blocked check fails 3 of them); release gate `tests/release.sh`.
- Icon is usage-file's until a file-trail icon is drawn.
- Not yet seen on a real screen (the builder's sessions are headless).
- v0.2.0 (session 36): the collapsed `ToolGroup` line names its files (the literal ask of #21151); 12 tests; two mutations each fail 1.
