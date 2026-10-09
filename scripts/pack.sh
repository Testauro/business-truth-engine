#!/usr/bin/env bash
# Build and pack every public @bte package into dist-packages/ as npm tarballs.
# Consumers install from these with `file:` paths; nothing is published.
set -euo pipefail
cd "$(dirname "$0")/.."
OUT=${1:-dist-packages}
if command -v pnpm >/dev/null 2>&1; then PNPM=pnpm; else PNPM="npx --yes pnpm@10"; fi
rm -rf "$OUT"; mkdir -p "$OUT"
$PNPM build >/dev/null
for pkg in @bte/core @bte/rules @bte/evidence @bte/evidence-http @bte/evidence-postgres @bte/sdk @bte/playwright @bte/cli; do
  $PNPM --filter "$pkg" pack --pack-destination "$(pwd)/$OUT" >/dev/null
done
# Sanity: every tarball ships dist + types, and no src/ or tests.
status=0
for t in "$OUT"/*.tgz; do
  if ! tar -tzf "$t" | grep -q "package/dist/index.js"; then echo "FAIL $t has no dist/index.js" >&2; status=1; fi
  if ! tar -tzf "$t" | grep -q "package/dist/index.d.ts"; then echo "FAIL $t has no dist/index.d.ts" >&2; status=1; fi
  if tar -tzf "$t" | grep -qE "package/(src|test)/"; then echo "FAIL $t ships sources or tests" >&2; status=1; fi
  printf '%-40s %6s KB\n' "$(basename "$t")" "$(( $(stat -f%z "$t" 2>/dev/null || stat -c%s "$t") / 1024 ))"
done
tar -tzf "$OUT"/bte-cli-*.tgz | grep -q "package/dist/main.js" || { echo "FAIL cli tarball has no bin" >&2; status=1; }
exit $status
