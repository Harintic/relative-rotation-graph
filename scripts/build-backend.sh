#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BACKEND_OUT="$ROOT_DIR/src-tauri/resources/backend"

mkdir -p "$BACKEND_OUT"

if [ -x "$ROOT_DIR/.venv/bin/pyinstaller" ]; then
  PYINSTALLER="$ROOT_DIR/.venv/bin/pyinstaller"
else
  PYINSTALLER="pyinstaller"
fi

"$PYINSTALLER" --noconfirm --clean --onefile \
  --name rrg-backend \
  --distpath "$BACKEND_OUT" \
  --workpath "$ROOT_DIR/.pyinstaller-work" \
  --specpath "$ROOT_DIR/.pyinstaller-spec" \
  --paths "$ROOT_DIR" \
  "$ROOT_DIR/python_backend/__main__.py"
