"""Runtime configuration.

Every setting can be overridden with an environment variable prefixed with
``SIYULAH_`` (e.g. ``SIYULAH_DATABASE_URL``). In development, secrets that are
not provided are generated once and persisted under ``data/dev-secrets.json``
so encrypted tokens stay readable across restarts. In production
(``SIYULAH_ENV=production``) missing secrets are a hard error.
"""

from __future__ import annotations

import base64
import json
import os
import secrets
from datetime import date, datetime, timedelta, timezone
from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parents[2]
DATA_DIR = BACKEND_DIR / "data"
RIYADH = timezone(timedelta(hours=3), "Asia/Riyadh")


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="SIYULAH_", env_file=".env", extra="ignore")

    env: str = "development"
    database_url: str = f"sqlite:///{DATA_DIR / 'siyulah.db'}"

    # Security
    jwt_secret: str = ""
    # Base64-encoded 32-byte key used for AES-256-GCM encryption at rest.
    encryption_key: str = ""
    access_token_minutes: int = 60 * 12

    # Where the SPA lives (used for OAuth redirects back to the app).
    frontend_url: str = "http://localhost:5173"
    # Public base URL of this API for sandbox OAuth authorize URLs. Empty means
    # same-origin (relative URLs), which works behind the Vite proxy and when the
    # API serves the built SPA.
    api_url: str = ""
    cors_origins: list[str] = ["http://localhost:5173", "http://127.0.0.1:5173"]

    # PDPL: data residency label surfaced in the UI and exports.
    data_region: str = "KSA — Riyadh (me-central-1)"
    data_region_ar: str = "المملكة العربية السعودية — الرياض (me-central-1)"

    # Brute-force protection: failed logins allowed per email+IP per window.
    login_max_attempts: int = 5
    login_window_seconds: int = 300

    # Notifications. Empty values mean "sandbox": messages are recorded in the
    # notification log instead of being delivered.
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_password: str = ""
    smtp_from: str = "alerts@siyulah.sa"
    sms_provider_url: str = ""  # e.g. an Unifonic / Taqnyat REST endpoint
    sms_api_key: str = ""

    # Background alert evaluation interval (minutes). 0 disables the loop.
    alerts_interval_minutes: int = 360

    # Seed the demo company (demo@siyulah.sa / demo1234) on startup.
    seed_demo: bool = True

    # Freeze "today" (YYYY-MM-DD) for demos and tests. Empty = real date (Asia/Riyadh).
    today: str = ""

    @property
    def is_production(self) -> bool:
        return self.env.lower() == "production"


def today() -> date:
    override = get_settings().today
    if override:
        return date.fromisoformat(override)
    return datetime.now(RIYADH).date()


def _load_dev_secrets() -> dict[str, str]:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    path = DATA_DIR / "dev-secrets.json"
    if path.exists():
        return json.loads(path.read_text())
    values = {
        "jwt_secret": secrets.token_urlsafe(48),
        "encryption_key": base64.b64encode(secrets.token_bytes(32)).decode(),
    }
    path.write_text(json.dumps(values, indent=2))
    os.chmod(path, 0o600)
    return values


@lru_cache
def get_settings() -> Settings:
    settings = Settings()
    if not settings.jwt_secret or not settings.encryption_key:
        if settings.is_production:
            raise RuntimeError(
                "SIYULAH_JWT_SECRET and SIYULAH_ENCRYPTION_KEY must be set in production"
            )
        dev = _load_dev_secrets()
        settings.jwt_secret = settings.jwt_secret or dev["jwt_secret"]
        settings.encryption_key = settings.encryption_key or dev["encryption_key"]
    if len(base64.b64decode(settings.encryption_key)) != 32:
        raise RuntimeError("SIYULAH_ENCRYPTION_KEY must be a base64-encoded 32-byte key (AES-256)")
    return settings
