#!/bin/sh
# Release gate: the manifest and module validate, the tests pass, and the
# version string is the same in the plugin manifest, the marketplace manifest,
# the changelog's newest release and the README.
# Exit non-zero on any of them. Run from the repo root: sh tests/release.sh
set -e
cd "$(dirname "$0")/.."
claude plugin validate .
claude plugin test .
python3 -I - <<'PY'
import json, re, sys
plugin = json.load(open('.claude-plugin/plugin.json'))['version']
market = json.load(open('.claude-plugin/marketplace.json'))['plugins'][0]['version']
changelog = re.search(r'^## (\d+\.\d+\.\d+) ', open('CHANGELOG.md').read(), re.M).group(1)
readme = re.search(r'Version (\d+\.\d+\.\d+),', open('README.md').read()).group(1)
versions = {'plugin.json': plugin, 'marketplace.json': market, 'CHANGELOG.md': changelog, 'README.md': readme}
if len(set(versions.values())) != 1:
    sys.exit(f"version strings differ: {versions}")
print(f"version check: all four say {plugin}")
PY
echo "release gate: validate, test and version check passed"
