#!/usr/bin/env bash
# pre-push-check.sh <commit-range>
#
# Called by the pre-push git hook with the range being pushed. Two gates:
#
#   1. The tests pass.
#   2. If the range changes anything GitHub Pages serves, it also changes the
#      VERSION line in sw.js. The service worker is cache-first, so a deploy
#      without a bump never reaches an installed app — and nothing about the
#      push or the deploy looks wrong when that happens.
set -euo pipefail

range="${1:?usage: pre-push-check.sh <commit-range>}"
cd "$(git rev-parse --show-toplevel)"

if ! command -v node >/dev/null 2>&1; then
  echo "pre-push-check: node is not installed, so the tests cannot run." >&2
  exit 1
fi
node --test

# Everything outside these paths is served by Pages. Keep this in step with what
# the site actually needs: a new top-level directory of dev-only files belongs here.
not_served='^(test|tools|scripts|\.github)/|\.md$|^\.gitignore$'

served="$(git diff --name-only "$range" | grep -Ev "$not_served" || true)"
if [ -n "$served" ] && ! git diff "$range" -- sw.js | grep -q '^+const VERSION'; then
  echo "pre-push-check: BLOCKED — these served files changed but sw.js VERSION did not:" >&2
  printf '  %s\n' $served >&2
  echo "Bump VERSION in sw.js, or installed apps will keep the old files." >&2
  exit 1
fi
