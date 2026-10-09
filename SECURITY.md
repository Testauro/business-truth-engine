# Security policy

## Scope

Business Truth Engine processes rule files and evidence files you provide. It does not open
network connections except in the demo application and the Playwright suite, which bind to
`127.0.0.1` by default. No telemetry is sent anywhere.

## Reporting a vulnerability

Please do not open a public issue for security problems. Email the maintainers at the address in
the repository's GitHub profile (or use GitHub's private vulnerability reporting if enabled) with:

- affected component (`packages/core`, `apps/cli`, `apps/demo`, ...), version or commit;
- a minimal reproduction (rule, evidence, command);
- impact as you understand it.

You will get an acknowledgement within 5 working days and a fix or mitigation plan within 30 days
for confirmed issues. We credit reporters in the changelog unless asked not to.

## Design notes relevant to security

- All external input (YAML rules, NDJSON evidence, HTTP bodies in the demo) is validated with Zod
  before use; unknown keys are rejected.
- The demo renders customer-controlled strings through `escapeHtml`; it keeps all state in memory
  and has no authentication because it is a demonstration, not a product. Do not expose it publicly.
- The admin endpoints (`/admin/faults`, `/admin/clock/*`) exist for tests and demos only.
- No secrets are required or read; `.env.example` documents the only environment variables.
- Dependencies are updated weekly by Dependabot; CI runs on Node 24 and 26.
