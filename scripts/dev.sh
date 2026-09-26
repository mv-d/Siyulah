#!/usr/bin/env bash
# Development: API with auto-reload on :8000 and the Vite dev server on :5173.
# Open http://localhost:5173 (demo: demo@siyulah.sa / demo1234, or "Explore the live demo").
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

cd "$ROOT/backend"
if [ ! -d .venv ]; then python3 -m venv .venv; fi
. .venv/bin/activate
pip install -q -r requirements-dev.txt

cd "$ROOT/frontend"
[ -d node_modules ] || npm install

cd "$ROOT/backend"
SIYULAH_FRONTEND_URL=http://localhost:5173 uvicorn app.main:app --reload --port 8000 &
API_PID=$!
trap 'kill $API_PID 2>/dev/null' EXIT
cd "$ROOT/frontend" && npm run dev
