# Catalog

| File | Read when |
|---|---|
| `CLAUDE.md` | First, always. |
| `README.md` | You are a user installing it, or checking what it does not do. |
| `hooks/register.tsx` | You are changing which calls are recorded, the list and its state, or when the pane, status line and file are written. |
| `hooks/text.tsx` | You are changing which tools are listed (`TOOLS`), what a call names, how an entry reads in the pane, status line or file, or column widths (no state, no engine calls). |
| `hooks/register.test.tsx` | You changed the module: `claude plugin test .` runs it. |
| `types/index.d.ts` | You changed what the pane stores: the state contract `validate` checks. |
| `tests/release.sh` | You are releasing: validate, module tests, type check, directory checklist, version check; exit non-zero on any failing; `nightlab-release.json` names it. |
| `tests/checklist.py` | You are changing a plugin directory rule the release check applies; its safety rules read every non-test source file under `hooks/` and `types/`. |
| `CHANGELOG.md` | You are cutting a version: what changed and why. |
| `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, `hooks/hooks.json` | You are changing how the plugin installs or which module it loads. |
| `01-context/purpose.md` | You wonder who this is for and what would kill it. |
| `04-memory/STATE.md`, `04-memory/log/` | You need what is true now, or history. |
