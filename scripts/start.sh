#!/usr/bin/env bash
# Production-style single process: build the SPA and serve it from the API on :8000.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${PORT:-8000}"

cd "$ROOT/frontend"
[ -d node_modules ] || npm ci
npm run build

cd "$ROOT/backend"
if [ ! -d .venv ]; then python3 -m venv .venv; fi
. .venv/bin/activate
pip install -q -r requirements.txt
export SIYULAH_FRONTEND_URL="${SIYULAH_FRONTEND_URL:-http://localhost:$PORT}"
exec uvicorn app.main:app --host 0.0.0.0 --port "$PORT"
