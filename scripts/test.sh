#!/usr/bin/env bash
# Backend unit/API tests + frontend typecheck and build.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/backend" && { [ -d .venv ] || python3 -m venv .venv; } && . .venv/bin/activate && pip install -q -r requirements-dev.txt && python -m pytest -q
cd "$ROOT/frontend" && { [ -d node_modules ] || npm ci; } && npm run build
