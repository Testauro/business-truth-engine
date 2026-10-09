#!/usr/bin/env bash
# Runs the @demonstration Playwright pair and asserts, from the JUnit output, that
#   1. the ordinary checkout UI test PASSED, and
#   2. the BTE-verified test FAILED with MISSING_EXPECTED_OUTCOME.
# A run with zero tests, or a failure for any other reason, is an error. Used by CI.
set -euo pipefail
cd "$(dirname "$0")/.."
JUNIT=bte-report/e2e-junit.xml
rm -f "$JUNIT"
set +e
pnpm --filter @bte/e2e test:demonstration >/dev/null 2>&1
code=$?
set -e
[ -f "$JUNIT" ] || { echo "demonstration: no JUnit report produced (exit $code)" >&2; exit 1; }
node - "$JUNIT" "$code" <<'NODE'
const fs = require('fs');
const [file, code] = process.argv.slice(2);
const xml = fs.readFileSync(file, 'utf8');
// Split on testcase openings; each segment holds one case's body (Playwright never self-closes here).
const cases = xml
  .split(/<testcase /)
  .slice(1)
  .map((segment) => {
    const name = /^name="([^"]*)"/.exec(segment)?.[1] ?? '';
    const body = segment.slice(0, segment.indexOf('</testcase>'));
    return { name, body, failed: /<(failure|error)[\s>]/.test(body) };
  });
const ui = cases.find((c) => c.name.includes('ordinary checkout UI test'));
const bte = cases.find((c) => c.name.includes('same checkout verified by BTE'));
const problems = [];
if (cases.length !== 2) problems.push(`expected 2 demonstration testcases, found ${cases.length}`);
if (!ui) problems.push('UI testcase missing');
else if (ui.failed) problems.push('the ordinary checkout UI test failed; it must pass');
if (!bte) problems.push('BTE testcase missing');
else if (!bte.failed) problems.push('the BTE-verified test passed; it must fail');
else if (!/MISSING_EXPECTED_OUTCOME/.test(bte.body)) problems.push('the BTE test failed for a reason other than MISSING_EXPECTED_OUTCOME');
if (code === '0') problems.push('playwright exited 0; the pair must exit non-zero');
if (problems.length) { for (const p of problems) console.error(`demonstration: ${p}`); process.exit(1); }
console.log('demonstration: the checkout UI test passed and BTE failed the same checkout with MISSING_EXPECTED_OUTCOME (playwright exit ' + code + ')');
NODE
