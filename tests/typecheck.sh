#!/bin/sh
# Type-check the hooks module, its tests and the mod's contract against the
# engine's own declarations (tsc --noEmit, the options the engine's types
# header gives a hooks module). The declarations come from, in order:
# CC_TYPES; the copy the engine lays beside a loaded mod
# (.claude-plugin/types/claude-code/index.d.ts); /nightlab/tools/cc-types/current.
# tsc comes from TSC, then /nightlab/tools, then PATH. Either one missing is a
# FAIL, never a skip. Run from the repo root: sh tests/typecheck.sh
set -e
cd "$(dirname "$0")/.."
types="${CC_TYPES:-}"
[ -n "$types" ] || { [ -f .claude-plugin/types/claude-code/index.d.ts ] && types=.claude-plugin/types/claude-code/index.d.ts; }
[ -n "$types" ] || types=/nightlab/tools/cc-types/current/claude-code.d.ts
[ -f "$types" ] || { echo "typecheck: FAIL, no engine types at $types (set CC_TYPES)"; exit 1; }
tsc="${TSC:-/nightlab/tools/node_modules/.bin/tsc}"
[ -x "$tsc" ] || tsc="$(command -v tsc || true)"
[ -n "$tsc" ] || { echo "typecheck: FAIL, no tsc (npm install typescript, or set TSC)"; exit 1; }
files=$(ls hooks/*.ts hooks/*.tsx types/*.d.ts 2>/dev/null || true)
"$tsc" --noEmit --target es2023 --lib es2023 --types "" --module esnext \
  --moduleResolution bundler --strict --noUncheckedIndexedAccess --skipLibCheck \
  --jsx react --jsxFactory h --jsxFragmentFactory Fragment "$types" $files
echo "typecheck: tsc --noEmit passed against $(head -1 "$types" | sed 's,^// ,,')"
