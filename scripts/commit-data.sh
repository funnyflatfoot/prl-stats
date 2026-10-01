#!/usr/bin/env bash
# Commit refreshed data files back to main. Used by .github/workflows/prl-daily.yml, once per page,
# so the chain page is published even if the miners walk later times out. No-op when nothing changed.
set -euo pipefail
label="$1"; shift

git config user.name  "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"

git add -- "$@"
if git diff --quiet --cached; then
  echo "$label: no changes"
  exit 0
fi

if [ "$label" = chain ]; then
  tip=$(node -e "try{console.log(require('./data/checkpoint.json').lastIngestedHeight)}catch{console.log('?')}")
  msg="Chain data to #${tip}"
else
  tip=$(node -e "try{console.log(require('./data/miner_behavior.json').tip_height)}catch{console.log('?')}")
  msg="Miner behaviour to #${tip}"
fi

git commit -m "$msg"
# another run (or a hand commit) may have landed meanwhile
git pull --rebase --autostash
git push
echo "$label: pushed — $msg"
