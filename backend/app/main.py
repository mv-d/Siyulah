"""Siyulah (سيولة) — SME cash-flow forecaster API."""

from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import select

from .api import alerts, auth, forecast, integrations, scenarios, settings, tracker
from .core.config import get_settings, today
from .core.db import SessionLocal, init_db
from .models import Company

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("siyulah")

FRONTEND_DIST = Path(__file__).resolve().parents[2] / "frontend" / "dist"


async def _alert_loop(interval_minutes: int) -> None:
    from .services.alerts import evaluate_alerts
    from .services.sync import sync_company

    while True:
        await asyncio.sleep(interval_minutes * 60)
        try:
            with SessionLocal() as db:
                for company in db.scalars(select(Company)):
                    try:
                        sync_company(db, company)
                        evaluate_alerts(db, company)
                    except Exception:  # keep the loop alive for other companies
                        log.exception("scheduled refresh failed for company %s", company.id)
        except Exception:
            log.exception("scheduled refresh failed")


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    init_db()
    if settings.seed_demo:
        from .services.seed import seed_demo

        with SessionLocal() as db:
            seed_demo(db)
    task = asyncio.create_task(_alert_loop(settings.alerts_interval_minutes)) if settings.alerts_interval_minutes > 0 else None
    log.info("Siyulah API ready (today=%s)", today())
    yield
    if task:
        task.cancel()


app = FastAPI(
    title="Siyulah API",
    description="Cash-flow forecasting for Saudi SMEs: open banking + accounting sync, predictive runway, scenarios and alerts.",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=get_settings().cors_origins,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["Authorization", "Content-Type"],
)


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    response.headers.setdefault("X-Frame-Options", "DENY")
    if request.url.path.startswith("/api/"):
        response.headers.setdefault("Cache-Control", "no-store")
    if get_settings().is_production:
        response.headers.setdefault("Strict-Transport-Security", "max-age=63072000; includeSubDomains")
    return response


for r in (auth.router, forecast.router, scenarios.router, tracker.router, integrations.router, integrations.sandbox_router, alerts.router, settings.router):
    app.include_router(r)


@app.get("/api/health")
def health():
    return {"status": "ok", "today": today()}


@app.exception_handler(ValueError)
async def value_error(_: Request, exc: ValueError):
    return JSONResponse({"detail": str(exc)}, status_code=422)


# Serve the built SPA (single-process deployment). In development Vite serves it.
if FRONTEND_DIST.exists():
    app.mount("/assets", StaticFiles(directory=FRONTEND_DIST / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str):
        if path == "api" or path.startswith("api/"):
            return JSONResponse({"detail": "Not Found"}, status_code=404)
        candidate = FRONTEND_DIST / path
        if path and candidate.is_file() and FRONTEND_DIST in candidate.resolve().parents:
            return FileResponse(candidate)
        return FileResponse(FRONTEND_DIST / "index.html")
