from sqlalchemy import text

from app.core.security import (
    create_access_token,
    decode_access_token,
    decrypt,
    encrypt,
    hash_password,
    pkce_challenge,
    verify_password,
)


def test_password_hashing_roundtrip():
    h = hash_password("s3cure-pass")
    assert h.startswith("scrypt$")
    assert verify_password("s3cure-pass", h)
    assert not verify_password("wrong", h)


def test_aes_gcm_roundtrip_and_randomised_nonce():
    a, b = encrypt("SA0380000000608010167519"), encrypt("SA0380000000608010167519")
    assert a != b  # fresh nonce every time
    assert decrypt(a) == "SA0380000000608010167519"


def test_tampered_ciphertext_is_rejected():
    import base64

    import pytest

    token = encrypt("secret")
    raw = bytearray(base64.b64decode(token[3:]))
    raw[-1] ^= 1
    with pytest.raises(Exception):
        decrypt("v1:" + base64.b64encode(bytes(raw)).decode())


def test_jwt_roundtrip():
    payload = decode_access_token(create_access_token(7, 3))
    assert payload["sub"] == "7" and payload["cid"] == 3


def test_pkce_s256_known_vector():
    # RFC 7636 Appendix B
    assert pkce_challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk") == "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"


def test_tokens_are_encrypted_at_rest(client, demo_headers):
    from app.core.db import engine

    with engine.connect() as conn:
        tokens = [r[0] for r in conn.execute(text("SELECT access_token FROM connections WHERE access_token IS NOT NULL"))]
        ibans = [r[0] for r in conn.execute(text("SELECT iban FROM bank_accounts"))]
    assert tokens and all(t.startswith("v1:") and "sbx_at_" not in t for t in tokens)
    assert ibans and all(i.startswith("v1:") and not i.startswith("SA") for i in ibans)
