#!/bin/sh
# Runs the regression net: every package suite that is green on a clean
# checkout, minus the files listed in scripts/test-quarantine.txt.
# Classification and per-entry reasons: docs/audit/M0.4-test-baseline.md
set -eu

root=$(cd "$(dirname "$0")/.." && pwd)
quarantine="$root/scripts/test-quarantine.txt"
status=0

for pkg in core ui tui agent; do
  dir="$root/packages/$pkg"
  [ -d "$dir" ] || continue

  # Build ignore patterns for this package's quarantined files.
  set --
  if [ -f "$quarantine" ]; then
    while IFS= read -r line; do
      case "$line" in
      "" | \#*) continue ;;
      "packages/$pkg/"*) set -- "$@" --path-ignore-patterns="**/${line#packages/$pkg/}" ;;
      esac
    done <"$quarantine"
  fi

  echo "==> $pkg"
  (cd "$dir" && bun test --timeout 30000 "$@") || status=1
done

# Macro trials, dry (M3.2). The real bar (>=9/10) needs a model, so CI can only
# assert that the trials themselves are well-formed: sandboxes build, prompts
# form, checks are callable. A broken trial that silently skips is worse than
# no trial, and this is what catches it.
echo "==> macro trials (dry)"
(cd "$root" && bun run scripts/macro-trials.ts --dry) || status=1

exit $status
