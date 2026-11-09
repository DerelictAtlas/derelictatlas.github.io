#!/usr/bin/env bash
# tools/singles/action.sh -- the one step of .github/workflows/singles.yml (see tools/singles/README.md).
# Runs in the repo root of a checkout of main. Also runs locally against a throwaway git repo:
#   SINGLES_ISSUES_FILE=issues.json  read issues from this JSON file instead of the GitHub API
#   SINGLES_DRY_RUN=calls.jsonl      write the issue comment / close calls to this file, no API, no Pages request
#   SINGLES_NO_MAPS=1  skip the map step; SINGLES_MAPS_MAX (300 maps per run), SINGLES_MAPS_MINUTES (6)
#   SINGLES_WORK, SINGLES_WORKERS, SINGLES_SCAN_MINUTES, PYTHON, NODE, SINGLES_REMOTE, SINGLES_BRANCH   (defaults below)
# Never reads issue text itself: only tools/singles/singles.py does, with strict regular expressions.
set -euo pipefail

PY=${PYTHON:-python3}
TOOL=tools/singles/singles.py
WORK=${SINGLES_WORK:-${RUNNER_TEMP:-/tmp}/singles}
RUN_ID=${GITHUB_RUN_ID:-local}
REMOTE=${SINGLES_REMOTE:-origin}
BRANCH=${SINGLES_BRANCH:-main}
WORKERS=${SINGLES_WORKERS:-$(nproc 2>/dev/null || echo 2)}   # one Node scanner per CPU (public-repo runners: 4)
# Scanning stops starting new systems SCAN_MINUTES after the job started (also across the push retries below), so the
# job ends well inside its timeout-minutes; addresses not reached stay in their open issues / in singles/held.csv.
DEADLINE=$(( $(date +%s) + ${SINGLES_SCAN_MINUTES:-55} * 60 ))
mkdir -p "$WORK"

git config user.name "atlas-singles-bot"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"

# 1. the scanner files must match scan/w29.json (exit 3 otherwise: job fails, nothing committed, issues untouched)
"$PY" -I "$TOOL" check-w29 --repo .

# 2. the issue set of this run, fetched once (retries below reuse it)
if [ -n "${SINGLES_ISSUES_FILE:-}" ]; then
  cp "$SINGLES_ISSUES_FILE" "$WORK/issues.json"
else
  "$PY" -I "$TOOL" fetch-issues --out "$WORK/issues.json"
fi

# 3. process + commit + push; when main moved (the PC scanner pushes too), recompute on the newest main.
#    Recomputing (not a plain rebase) re-checks every single against region files published in the meantime, so an
#    address is never in a region file and in singles/ at once; scans are cached, so a retry costs seconds.
pushed=no
for attempt in 1 2 3; do
  "$PY" -I "$TOOL" process --repo . --issues-file "$WORK/issues.json" --cache "$WORK/scan-cache.jsonl" \
    --summary "$WORK/summary.json" --message "$WORK/message.txt" --run-id "$RUN_ID" --workers "$WORKERS" \
    --deadline "$DEADLINE"
  # MAPS1: the map of every system in a map list that has none in views/top100.json(.gz) yet (the singles that broke into
  # a list), as the PC publish makes it. Never fails the job: on any error maps.py leaves the bundle untouched and the
  # singles data of this hour is committed below as before; the missing maps are made by the next run.
  if [ -z "${SINGLES_NO_MAPS:-}" ]; then
    "$PY" -I tools/singles/maps.py --repo . --work "$WORK" --message "$WORK/message.txt" --deadline $(( DEADLINE + 300 ))       || echo "maps step failed (ignored): the map bundle is untouched"
  fi
  other=$(git status --porcelain --untracked-files=all \
          | grep -v -E '^.. (singles/.*|index/singles\.csv|views/singles-extras\.csv|views/finders\.csv|stats/speed\.json|views/map-lists\.txt|stats/systems\.json|views/top100\.json|views/top100\.json\.gz|views/top100-loot\.json)$' || true)
  if [ -n "$other" ]; then
    echo "the processor changed files outside its outputs, stopping:"
    echo "$other"
    exit 1
  fi
  git add -A .
  if git diff --cached --quiet; then
    pushed=nothing
    break
  fi
  git commit -q -F "$WORK/message.txt"
  if git push -q "$REMOTE" "HEAD:$BRANCH"; then
    pushed=yes
    break
  fi
  echo "push refused (attempt $attempt): $BRANCH moved; taking the new $BRANCH and recomputing"
  git fetch -q "$REMOTE" "$BRANCH"
  git reset -q --hard FETCH_HEAD        # our commit is dropped and rebuilt on top of the new main (never conflicts)
done
if [ "$pushed" = no ]; then
  echo "could not push after 3 attempts; issues left open for the next run"
  exit 1
fi
echo "push: $pushed"

# 4. only after a successful push (or when nothing changed): ask for a Pages build, then comment + close the issues
#    that are done (an issue with addresses the run did not reach stays open, without a comment, for the next run)
if [ "$pushed" = yes ] && [ -z "${SINGLES_DRY_RUN:-}" ]; then
  "$PY" -I "$TOOL" pages-build || true
fi
if [ -n "${SINGLES_DRY_RUN:-}" ]; then
  "$PY" -I "$TOOL" comment --summary "$WORK/summary.json" --dry-run "$SINGLES_DRY_RUN"
else
  "$PY" -I "$TOOL" comment --summary "$WORK/summary.json"
fi
