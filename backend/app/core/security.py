"""Password hashing, JWT access tokens and AES-256-GCM encryption at rest."""

from __future__ import annotations

import base64
import hashlib
import hmac
import os
import secrets
from datetime import UTC, datetime, timedelta

import jwt
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from sqlalchemy import String
from sqlalchemy.types import TypeDecorator

from .config import get_settings

# --- Passwords (scrypt, memory-hard, stdlib) ---------------------------------

_SCRYPT_N, _SCRYPT_R, _SCRYPT_P = 2**14, 8, 1


def hash_password(password: str) -> str:
    salt = os.urandom(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, n=_SCRYPT_N, r=_SCRYPT_R, p=_SCRYPT_P)
    return "scrypt$%d$%d$%d$%s$%s" % (
        _SCRYPT_N,
        _SCRYPT_R,
        _SCRYPT_P,
        base64.b64encode(salt).decode(),
        base64.b64encode(digest).decode(),
    )


def verify_password(password: str, stored: str) -> bool:
    try:
        scheme, n, r, p, salt_b64, digest_b64 = stored.split("$")
    except ValueError:
        return False
    if scheme != "scrypt":
        return False
    digest = hashlib.scrypt(
        password.encode(), salt=base64.b64decode(salt_b64), n=int(n), r=int(r), p=int(p)
    )
    return hmac.compare_digest(digest, base64.b64decode(digest_b64))


# --- JWT access tokens -------------------------------------------------------


def create_access_token(user_id: int, company_id: int) -> str:
    settings = get_settings()
    now = datetime.now(UTC)
    payload = {
        "sub": str(user_id),
        "cid": company_id,
        "iat": now,
        "exp": now + timedelta(minutes=settings.access_token_minutes),
        "jti": secrets.token_hex(8),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm="HS256")


def decode_access_token(token: str) -> dict:
    return jwt.decode(token, get_settings().jwt_secret, algorithms=["HS256"])


# --- AES-256-GCM field encryption ---------------------------------------------

_PREFIX = "v1:"


def _cipher() -> AESGCM:
    return AESGCM(base64.b64decode(get_settings().encryption_key))


def encrypt(plaintext: str) -> str:
    nonce = os.urandom(12)
    ct = _cipher().encrypt(nonce, plaintext.encode(), None)
    return _PREFIX + base64.b64encode(nonce + ct).decode()


def decrypt(token: str) -> str:
    if not token.startswith(_PREFIX):
        raise ValueError("Unknown ciphertext format")
    raw = base64.b64decode(token[len(_PREFIX) :])
    return _cipher().decrypt(raw[:12], raw[12:], None).decode()


class EncryptedString(TypeDecorator):
    """A string column that is transparently encrypted with AES-256-GCM."""

    impl = String
    cache_ok = True

    def process_bind_param(self, value, dialect):
        if value is None:
            return None
        return encrypt(str(value))

    def process_result_value(self, value, dialect):
        if value is None:
            return None
        return decrypt(value)


def random_token(nbytes: int = 24) -> str:
    return secrets.token_urlsafe(nbytes)


def pkce_challenge(verifier: str) -> str:
    digest = hashlib.sha256(verifier.encode()).digest()
    return base64.urlsafe_b64encode(digest).rstrip(b"=").decode()
