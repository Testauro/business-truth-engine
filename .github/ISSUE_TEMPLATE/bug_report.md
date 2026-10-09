---
name: Bug report
about: A verdict, report or command behaved differently from the documented contract
labels: bug
---

## What happened

<!-- The command you ran, its output, and what you expected instead. -->

## Reproduction

<!-- Ideally: a rule YAML, an NDJSON evidence file (redacted), and the `--now` instant.
     Fixture-shaped inputs under examples/fixtures/ are perfect. -->

```bash
node apps/cli/dist/main.js evaluate --rules ... --evidence ... --now ...
```

## Verdict semantics

<!-- If this is about PASS / FAIL / PENDING / UNKNOWN, which rule in docs/adr/0002-verdict-semantics.md
     do you believe was violated? -->

## Environment

- BTE version / commit:
- Node version:
- OS:
