#!/usr/bin/env bash
# Runs every seeded demo fault through scenario.js -> NDJSON -> `bte evaluate` and asserts the
# catalogued verdict. Used by `pnpm check:scenarios` and CI. Requires `pnpm build`.
set -euo pipefail
cd "$(dirname "$0")/.."
OUT=bte-report/demo
mkdir -p "$OUT"
NOW=2026-01-15T10:02:31Z
status=0

check() { # <fault|none> <expected summary like FAIL=1>
  local fault=$1 expected=$2 args=()
  [ "$fault" != none ] && args=(--fault "$fault")
  node apps/demo/dist/scenario.js ${args[@]+"${args[@]}"} --out "$OUT/$fault.ndjson" > "$OUT/$fault.meta.json" 2>/dev/null
  local ui
  ui=$(node -e "console.log(require('./$OUT/$fault.meta.json').uiConfirmed)")
  set +e
  node apps/cli/dist/main.js evaluate --rules rules --evidence "$OUT/$fault.ndjson" --now "$NOW" \
    --format json --output "$OUT/$fault.json" --junit "$OUT/$fault.junit.xml" --markdown "$OUT/$fault.md" >/dev/null 2>&1
  local exit_code=$?
  set -e
  local summary
  summary=$(node -e "const r=require('./$OUT/$fault.json');console.log(Object.entries(r.summary).filter(([,n])=>n>0).map(([k,n])=>k+'='+n).join(','))")
  printf '%-22s ui-confirmed=%-5s exit=%s  %s\n' "$fault" "$ui" "$exit_code" "$summary"
  if [ "$ui" != true ]; then echo "  expected the checkout UI to confirm success" >&2; status=1; fi
  if [ "$summary" != "$expected" ]; then echo "  expected $expected" >&2; status=1; fi
  case "$expected" in
    FAIL=*) [ "$exit_code" = 1 ] || { echo "  expected exit 1" >&2; status=1; } ;;
    *)      [ "$exit_code" = 0 ] || { echo "  expected exit 0" >&2; status=1; } ;;
  esac
}

check none PASS=1
check missing-invoice FAIL=1
check duplicate-invoice FAIL=1
check wrong-amount FAIL=1
check delayed-invoice FAIL=1
check invoicing-unavailable UNKNOWN=1
check duplicate-delivery PASS=1

if [ "$status" = 0 ]; then echo "demo scenarios: all verdicts as catalogued"; else echo "demo scenarios: FAILED" >&2; fi
exit $status
