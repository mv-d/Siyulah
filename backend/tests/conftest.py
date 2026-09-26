import base64
import os
import tempfile

_tmp = tempfile.mkdtemp(prefix="siyulah-test-")
os.environ.setdefault("SIYULAH_DATABASE_URL", f"sqlite:///{_tmp}/test.db")
os.environ.setdefault("SIYULAH_TODAY", "2026-09-26")
os.environ.setdefault("SIYULAH_SEED_DEMO", "false")
os.environ.setdefault("SIYULAH_ALERTS_INTERVAL_MINUTES", "0")
os.environ.setdefault("SIYULAH_JWT_SECRET", "test-secret-" + "x" * 40)
os.environ.setdefault("SIYULAH_ENCRYPTION_KEY", base64.b64encode(b"k" * 32).decode())

import logging  # noqa: E402

import pytest  # noqa: E402

logging.disable(logging.INFO)


@pytest.fixture(scope="session")
def client():
    from fastapi.testclient import TestClient

    from app.main import app

    with TestClient(app) as c:
        yield c


@pytest.fixture(scope="session")
def demo_headers(client):
    r = client.post("/api/auth/demo")
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}
