# OrangeHRM as a BTE consumer

OrangeHRM is verified here as an **external consumer** of the Business Truth Engine: Playwright
drives the real OrangeHRM UI, a thin adapter maps OrangeHRM's own JSON APIs to BTE evidence, and
BTE's unmodified engine judges the business invariants. BTE is installed from packed tarballs
(`../../dist-packages`), never from workspace sources; BTE core was not changed for this domain.

## What is verified

| Rule                           | Trigger (what the test observed)                           | Independent evidence                                                       | Where it runs          |
| ------------------------------ | ---------------------------------------------------------- | -------------------------------------------------------------------------- | ---------------------- |
| `employee-identity-consistent` | PIM employee details shown in the UI (`employee.observed`) | `GET /api/v2/pim/employees/{empNumber}` via token or session               | public demo, read-only |
| `leave-request-approved`       | leave request submitted in the UI                          | Scheduled requests from `/api/v2/leave/employees/leave-requests`           | private instance only  |
| `leave-usage-recorded`         | a Scheduled request (from the API)                         | `/api/v2/leave/leave-entitlements` `daysUsed` ≥ the request's `lengthDays` | private instance only  |

The authoritative employee identifier is `empNumber` (the key in details URLs and the API); the
user-facing "Employee Id" is a mutable attribute and is compared, not used as the key.

Verdicts: PASS only with a matching record from an authorized API read; FAIL on a confirmed
mismatch; PENDING while a window is open; UNKNOWN whenever authorized API evidence is not
available. UI observations never prove the backend on their own.

## Environment

Copy `.env.example` to `.env` (git-ignored) or export the variables. Credentials are never in code.

| Variable                                                                          | Purpose                                                                                |
| --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `ORANGEHRM_BASE_URL`                                                              | demo URL (default `https://opensource-demo.orangehrmlive.com`)                         |
| `ORANGEHRM_USERNAME` / `ORANGEHRM_PASSWORD`                                       | login for the setup project (the demo publishes its own credentials)                   |
| `ORANGEHRM_API_MODE`                                                              | `token` (Starter API v2 bearer), `session` (reuse the Playwright login cookie), `none` |
| `ORANGEHRM_API_TOKEN`                                                             | OAuth2 bearer token for `token` mode (https://api-starter-orangehrm.readme.io/)        |
| `ORANGEHRM_SESSION_FILE`                                                          | storage state written by the setup project (default `.auth/session.json`)              |
| `ORANGEHRM_PRIVATE_BASE_URL` / `_USERNAME` / `_PASSWORD`                          | private instance for state-changing leave tests                                        |
| `ORANGEHRM_PRIVATE_EMP_NUMBER`, `_LEAVE_TYPE`, `_LEAVE_TYPE_ID`, `_EMPLOYEE_NAME` | leave test data on the private instance                                                |

## Install and run

```bash
# once, in the BTE checkout: build the tarballs
npx --yes pnpm@10 pack:packages

cd examples/orangehrm
npm install                 # installs @bte/* from ../../dist-packages (delete package-lock.json after repacking)
npm run typecheck
npm run test:offline        # contract + fixture replays, no network, no credentials
npm run bte:validate        # bte rules validate
npm run bte:replay          # bte evaluate on a synthetic fixture

# public demo, read-only (set credentials in the environment first)
export ORANGEHRM_USERNAME=... ORANGEHRM_PASSWORD=... ORANGEHRM_API_MODE=session
npm run test:demo

# private instance, state-changing leave workflow
export ORANGEHRM_PRIVATE_BASE_URL=... ORANGEHRM_PRIVATE_USERNAME=... ORANGEHRM_PRIVATE_PASSWORD=... \
       ORANGEHRM_PRIVATE_EMP_NUMBER=... ORANGEHRM_PRIVATE_LEAVE_TYPE=... ORANGEHRM_PRIVATE_LEAVE_TYPE_ID=... ORANGEHRM_PRIVATE_EMPLOYEE_NAME=...
npm run test:private
```

Projects: `setup` logs in once with tracing and screenshots **off**, so credentials never appear in
artifacts; `demo` reuses the saved session; `contract` and `offline` need no network; `private`
is skipped with a stated reason unless configured.

## Tests

| Project  | File                                      | What it proves                                                                                                                        |
| -------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| demo     | `tests/demo/login.smoke.spec.ts`          | saved session works; wrong password is rejected                                                                                       |
| demo     | `tests/demo/employee.spec.ts` A           | traditional Playwright assertions: list row and personal details agree                                                                |
| demo     | `tests/demo/employee.spec.ts` B           | BTE: UI observation vs. the API record → PASS (authorized API) or UNKNOWN                                                             |
| demo     | `tests/demo/employee.spec.ts` C           | with no authorized API, BTE answers UNKNOWN and `expectInvariant` refuses to pass                                                     |
| contract | `tests/contract/adapter.contract.spec.ts` | adapter against a local stub: mapping, token/session auth, 401, expired token, login redirect, 404, schema drift → unavailable source |
| contract | `tests/contract/normalization.spec.ts`    | OrangeHRM JSON → BTE records; missing fields reported, never defaulted                                                                |
| offline  | `tests/offline/fixtures.spec.ts`          | SYNTHETIC fixtures replayed through BTE and the installed CLI: PASS / FAIL / PENDING / UNKNOWN                                        |
| private  | `tests/private/leave.spec.ts`             | apply → approve → BTE verifies Scheduled status and entitlement usage from the API                                                    |

The FAIL fixtures under `fixtures/` are seeded inconsistencies for demonstration; they are not
OrangeHRM product defects.

## Reading a verdict

`bte verify` writes `bte-report/bte.json`, `bte.junit.xml` and `bte.md`; Playwright attaches each
settled verdict (`*.verdict.json`, `*.explanation.txt`, `*.evidence.ndjson`). Exit codes: 0 gate
passed, 1 a verdict failed the gate, 2 could not evaluate. `bte explain employee-identity-consistent <empNumber>`
prints the full decision with the source assessment, including why a source was unavailable.

## Limitations and blockers (as executed on 2026-10-09)

- Public demo, read-only: executed and green (6 tests). The invariant used `session` mode (the
  web client's own `/api/v2` endpoints with the login cookie). The documented Starter API v2 with an
  OAuth2 bearer token (`token` mode) is implemented and contract-tested against a stub, but was not
  executed: registering an OAuth client would modify the shared demo, which this project does not do.
- Leave workflow: no private OrangeHRM instance was available; `tests/private/leave.spec.ts` is
  skipped with that reason and has **not** been executed. Its page objects and API mappings follow
  OrangeHRM 5.x and must be confirmed on your instance. The leave rules are proven on synthetic
  fixtures only.
- The shared demo's data is edited by other visitors; tests select the first row of the employee
  list at run time rather than a fixed employee.
- Employee details are limited to the fields `/pim/employees/{empNumber}` returns (names, employee
  id); job details are a separate endpoint and not part of the invariant.
