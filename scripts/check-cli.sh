#!/usr/bin/env bash
# Exercises the built CLI end to end against the fixture catalogue and the documented exit codes.
# Used by `pnpm check:cli` and CI. Requires `pnpm build`.
set -euo pipefail
cd "$(dirname "$0")/.."
OUT=bte-report/cli
mkdir -p "$OUT"
BTE="node apps/cli/dist/main.js"
status=0
expect_exit() { # <expected> <description> <command...>
  local expected=$1 desc=$2; shift 2
  set +e; "$@" >/dev/null 2>&1; local actual=$?; set -e
  if [ "$actual" = "$expected" ]; then printf 'ok   exit %s  %s\n' "$actual" "$desc"; else printf 'FAIL exit %s (expected %s)  %s\n' "$actual" "$expected" "$desc" >&2; status=1; fi
}

$BTE validate --rules rules >/dev/null
expect_exit 0 "validate rules" $BTE validate --rules rules
expect_exit 0 "PASS fixture" $BTE evaluate -r rules -e examples/fixtures/normal.ndjson --now 2026-01-15T10:03:00Z -o "$OUT/normal.json" --junit "$OUT/normal.junit.xml" --markdown "$OUT/normal.md"
expect_exit 1 "FAIL fixture gates" $BTE evaluate -r rules -e examples/fixtures/duplicate-invoice.ndjson --now 2026-01-15T10:03:00Z -o "$OUT/duplicate-invoice.json" --junit "$OUT/duplicate-invoice.junit.xml" --markdown "$OUT/duplicate-invoice.md"
expect_exit 0 "UNKNOWN passes default gate" $BTE evaluate -r rules -e examples/fixtures/unavailable-source.ndjson --now 2026-01-15T10:03:00Z
expect_exit 1 "UNKNOWN fails --fail-on unknown" $BTE evaluate -r rules -e examples/fixtures/unavailable-source.ndjson --now 2026-01-15T10:03:00Z --fail-on unknown
expect_exit 1 "PENDING fails --fail-on pending" $BTE evaluate -r rules -e examples/fixtures/not-yet-due.ndjson --now 2026-01-15T10:01:00Z --fail-on pending
expect_exit 2 "malformed evidence" $BTE evaluate -r rules -e examples/fixtures/invalid/bad-evidence.ndjson --now 2026-01-15T10:03:00Z
expect_exit 2 "invalid rule" $BTE evaluate -r examples/fixtures/invalid/bad-rule.yaml -e examples/fixtures/normal.ndjson --now 2026-01-15T10:03:00Z
expect_exit 2 "usage error" $BTE evaluate -e examples/fixtures/normal.ndjson
expect_exit 0 "--help" $BTE --help

# Reproducibility: identical inputs give byte-identical JSON.
$BTE evaluate -r rules -e examples/fixtures/mixed-orders.ndjson --now 2026-01-15T10:03:00Z -f json > "$OUT/repro-1.json" || true
$BTE evaluate -r rules -e examples/fixtures/mixed-orders.ndjson --now 2026-01-15T10:03:00Z -f json > "$OUT/repro-2.json" || true
if cmp -s "$OUT/repro-1.json" "$OUT/repro-2.json"; then echo "ok   reproducible JSON"; else echo "FAIL JSON differs between runs" >&2; status=1; fi

# Every catalogued fixture (both catalogues) yields its expected verdict (same source of truth as the unit tests).
node -e '
const fs=require("fs"),path=require("path"),{execFileSync}=require("child_process");let bad=0;
for(const file of ["examples/fixtures/cases.json","examples/fixtures/aggregates/cases.json"]){
  const cat=JSON.parse(fs.readFileSync(file,"utf8"));const dir=path.dirname(file);
  for(const c of cat.cases){
    let out;try{out=execFileSync("node",["apps/cli/dist/main.js","evaluate","-r",cat.rule,"-e",path.join(dir,c.name+".ndjson"),"--now",c.now,"-f","json"],{stdio:["ignore","pipe","ignore"]}).toString()}catch(e){out=e.stdout.toString()}
    const r=JSON.parse(out);const got=r.verdicts.map(v=>({correlationValue:v.correlationValue,verdict:v.verdict,reasons:v.reasons.map(x=>x.code)}));
    const ok=JSON.stringify(got)===JSON.stringify(c.expected);if(!ok)bad++;
    console.log((ok?"ok   ":"FAIL ")+c.name.padEnd(26)+got.map(g=>g.verdict).join(","));
  }
}
process.exit(bad?1:0)' || status=1

if [ "$status" = 0 ]; then echo "cli checks: all passed"; else echo "cli checks: FAILED" >&2; fi
exit $status
