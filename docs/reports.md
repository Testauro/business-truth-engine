# Reports and exit codes

`bte evaluate` always evaluates every rule against every trigger in the evidence, then renders.

```bash
node apps/cli/dist/main.js evaluate \
  --rules rules --evidence run.ndjson --now 2026-01-15T10:03:00Z \
  --format markdown \                      # stdout: text (default) | json | markdown
  --output bte-report/bte.json \           # JSON report
  --junit bte-report/bte.junit.xml \       # JUnit XML
  --markdown bte-report/bte.md \           # Markdown (append to $GITHUB_STEP_SUMMARY)
  --fail-on unknown                        # gate: fail (default) | unknown | pending
# or from a PostgreSQL store (optionally together with -e files); as-of defaults to --now
node apps/cli/dist/main.js ingest --postgres postgres://user:pw@host/db -e run.ndjson
node apps/cli/dist/main.js evaluate --rules rules --postgres postgres://user:pw@host/db --now 2026-01-15T10:03:00Z
```

## Exit codes (the CI contract)

| Code | Meaning                                         | Typical cause                                                                |
| ---: | ----------------------------------------------- | ---------------------------------------------------------------------------- |
|    0 | Evaluated; no verdict failed the gate           | all PASS, or only PENDING/UNKNOWN below the selected `--fail-on`             |
|    1 | Evaluated; at least one verdict failed the gate | any FAIL; UNKNOWN with `--fail-on unknown`; PENDING with `--fail-on pending` |
|    2 | Could not evaluate                              | usage error, unreadable or invalid rule, malformed evidence (file:line)      |

A verdict set with zero triggers exits 0 and the reports say nothing was evaluated; it is never a
PASS. `--now` should always be passed in CI so reports are reproducible.

## JSON report (`schemaVersion: 2`)

```jsonc
{
  "schemaVersion": 2,
  "generator": "bte-cli/0.1.0",
  "evaluatedAt": "2026-01-15T10:03:00.000Z",
  "inputs": { "rules": ["rules"], "evidence": ["run.ndjson"], "eventCount": 3, "sourceCount": 2 },
  "gate": {
    "failOn": "fail",
    "failingVerdicts": ["FAIL"],
    "failed": [{ "ruleId": "...", "correlationValue": "\"ord_1001\"", "verdict": "FAIL" }],
  },
  "exitCode": 1,
  "summary": { "PASS": 0, "FAIL": 1, "PENDING": 0, "UNKNOWN": 0 },
  "verdicts": [
    /* RuleVerdict[] from @bte/core: rule, correlation, trigger, expectations, reasons */
  ],
  "evidence": [
    /* every evidence id cited by a reason, resolved: kind, type, source, times, deliveries */
  ],
}
```

`verdicts[].triggerSource` is the trigger's source assessment when the rule declares
`trigger.source` (else `null`); every source assessment carries `watermarkClamped`, true when the
attested `completeThrough` exceeded `observedAt` and was clamped. `verdicts[].reasons[]` is the audit trail: `{ code, message, evidenceIds }`. Codes are stable
(`packages/core/src/verdict.ts`, `REASON_CODES`). `evidence[]` makes the report self-contained:
every cited id resolves to the event (type, source, `occurredAt`, `collectedAt`, delivery count) or
the source attestation (`observedAt`, status, authoritative, `completeThrough`).

## JUnit report

One `<testsuite>` per rule (`invoice-created-once@v1`), one `<testcase>` per trigger, named by its
correlation (`orderId="ord_1001"`).

| Verdict                      | Element                                                                         |
| ---------------------------- | ------------------------------------------------------------------------------- |
| PASS                         | plain testcase                                                                  |
| fails the gate               | `<failure type="FAIL" message="FAIL: CODE, CODE">` with the explanation as body |
| PENDING / UNKNOWN below gate | `<skipped message="UNKNOWN: CODE"/>`                                            |

Each testcase carries `<properties>`: `bte.verdict`, `bte.rule`, `bte.trigger`, `bte.reasons`,
`bte.evidence` (comma-separated ids). The explanation is also in `<system-out>`. Suite-level
properties record schema version, generator, instant, gate and inputs.

## Markdown report

A headline (gate passed / failed), a summary table, one row per verdict with reason codes and
evidence ids, and a collapsible cited-evidence table. CI appends it to `$GITHUB_STEP_SUMMARY`.

## Playwright attachments

`BteVerifier` attaches `*.verdict.json`, `*.explanation.txt` and `*.evidence.ndjson` for every
settled verdict; traces and screenshots are retained on failure (`tests/e2e/playwright.config.ts`).
