# file-trail (front desk)

Nested ICM of a Nightlab bet. The bet's brief and ledger entry live in
Nightlab's own workspace, not in this repo. Read this, then `00-catalog/CATALOG.md`, then only what it
points to.

One hooks module, no dependencies: on every `tool.call` of the six built-in
file and search tools it waits for the answer, records time, tool, target and
outcome, draws the newest in a side pane and the status line, and rewrites one
text file per session. Rules: never deny or rewrite a call, never read a
file's contents, no network, a failure of its own is swallowed and the call's
result returned untouched, nothing public uses internal persona names. Kill
date and falsifier: set on placement, in Nightlab's ledger.
