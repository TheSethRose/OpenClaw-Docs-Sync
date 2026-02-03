#!/usr/bin/env bash
set -euo pipefail

QMD_SRC="/opt/homebrew/lib/node_modules/qmd/src/qmd.ts"

if [[ ! -f "$QMD_SRC" ]]; then
  echo "qmd source not found at $QMD_SRC" >&2
  echo "Reinstall qmd or adjust QMD_SRC in scripts/qmd.sh." >&2
  exit 1
fi

if command -v tsx >/dev/null 2>&1; then
  exec tsx "$QMD_SRC" "$@"
fi

if command -v npx >/dev/null 2>&1; then
  exec npx -y tsx "$QMD_SRC" "$@"
fi

echo "tsx (or npx) not found. Install via: npm i -g tsx" >&2
exit 1