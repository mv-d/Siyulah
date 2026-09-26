from urllib.parse import parse_qs, urlparse


def register(client, email, sector="retail"):
    r = client.post(
        "/api/auth/register",
        json={
            "email": email,
            "password": "password123",
            "full_name": "Test Owner",
            "company_name": "Test Co",
            "sector": sector,
            "pdpl_consent": True,
        },
    )
    assert r.status_code == 201, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def connect(client, headers, provider, institution=None):
    r = client.post(f"/api/integrations/{provider}/authorize", json={"institution": institution}, headers=headers)
    assert r.status_code == 200, r.text
    url = urlparse(r.json()["authorize_url"])
    q = {k: v[0] for k, v in parse_qs(url.query).items()}
    page = client.get(url.path, params=q)
    assert page.status_code == 200 and "Allow" in page.text
    decision = client.post(
        f"/api/sandbox/oauth/{provider}/decision",
        data={
            "state": q["state"],
            "redirect_uri": q["redirect_uri"],
            "code_challenge": q["code_challenge"],
            "institution": q.get("institution", ""),
            "decision": "allow",
        },
        follow_redirects=False,
    )
    assert decision.status_code == 303
    back = parse_qs(urlparse(decision.headers["location"]).query)
    return back["code"][0], back["state"][0]


def test_requires_auth(client):
    assert client.get("/api/dashboard").status_code == 401
    assert client.get("/api/dashboard", headers={"Authorization": "Bearer nope"}).status_code == 401


def test_register_requires_pdpl_consent(client):
    r = client.post(
        "/api/auth/register",
        json={"email": "x@y.sa", "password": "password123", "full_name": "X", "company_name": "Y", "pdpl_consent": False},
    )
    assert r.status_code == 422


def test_full_onboarding_flow(client):
    h = register(client, "owner@services.sa", sector="services")
    empty = client.get("/api/dashboard", headers=h).json()
    assert empty["has_data"] is False

    code, state = connect(client, h, "tarabut", "snb")
    r = client.post("/api/integrations/callback", json={"code": code, "state": state}, headers=h)
    assert r.status_code == 200, r.text
    assert r.json()["institution_name"] == "Saudi National Bank"
    # Codes are single-use.
    assert client.post("/api/integrations/callback", json={"code": code, "state": state}, headers=h).status_code == 400

    code, state = connect(client, h, "zoho")
    assert client.post("/api/integrations/callback", json={"code": code, "state": state}, headers=h).status_code == 200

    conns = client.get("/api/integrations/connections", headers=h).json()
    assert {c["provider"] for c in conns} == {"tarabut", "zoho"}
    dash = client.get("/api/dashboard", headers=h).json()
    assert dash["has_data"] and dash["balance"] > 0
    assert dash["receivables"]["open_count"] > 0
    obligations = client.get("/api/obligations", headers=h).json()
    assert {"payroll", "gosi", "rent"} <= {o["kind"] for o in obligations}

    # Duplicate bank connection is refused.
    assert client.post("/api/integrations/tarabut/authorize", json={"institution": "snb"}, headers=h).status_code == 400

    # Disconnecting deletes imported data (PDPL).
    bank = next(c for c in conns if c["kind"] == "bank")
    assert client.delete(f"/api/integrations/connections/{bank['id']}", headers=h).status_code == 204
    assert client.get("/api/dashboard", headers=h).json()["balance"] == 0


def test_pkce_and_redirect_uri_are_enforced(client):
    h = register(client, "pkce@test.sa")
    r = client.post("/api/integrations/lean/authorize", json={"institution": "alinma"}, headers=h)
    q = {k: v[0] for k, v in parse_qs(urlparse(r.json()["authorize_url"]).query).items()}
    evil = client.get(urlparse(r.json()["authorize_url"]).path, params={**q, "redirect_uri": "https://evil.example/cb"})
    assert evil.status_code == 400
    # A code issued for a different PKCE challenge cannot be redeemed.
    d = client.post(
        "/api/sandbox/oauth/lean/decision",
        data={"state": q["state"], "redirect_uri": q["redirect_uri"], "code_challenge": "not-the-real-one", "institution": "alinma", "decision": "allow"},
        follow_redirects=False,
    )
    code = parse_qs(urlparse(d.headers["location"]).query)["code"][0]
    bad = client.post("/api/integrations/callback", json={"code": code, "state": q["state"]}, headers=h)
    assert bad.status_code == 400 and "PKCE" in bad.json()["detail"]


def test_demo_dashboard_contents(client, demo_headers):
    d = client.get("/api/dashboard?horizon=90", headers=demo_headers).json()
    m = d["forecast"]["metrics"]
    assert d["balance"] > 0 and len(d["forecast"]["series"]) == 90 and len(d["forecast"]["history"]) == 30
    assert m["lowest_balance"] < d["company"]["min_cash_buffer"]
    assert 0 < m["shortfall_probability"] < 1
    assert d["insights"] and all(i["text_ar"] and i["text_en"] for i in d["insights"])
    assert d["suggestions"] and all(s["adjustments"] for s in d["suggestions"])
    assert d["backtest"]["accuracy"] > 0.8
    assert any(a["kind"] == "shortfall_risk" for a in d["alerts"])


def test_scenarios_crud_and_preview(client, demo_headers):
    inv = client.get("/api/invoices?kind=receivable&status=open", headers=demo_headers).json()[0]
    bad = client.post("/api/scenarios/preview", json={"adjustments": [{"type": "delay_receivable"}]}, headers=demo_headers)
    assert bad.status_code == 422
    body = {"adjustments": [{"type": "delay_receivable", "invoice_id": inv["id"], "days": 30}], "horizon": 90}
    p = client.post("/api/scenarios/preview", json=body, headers=demo_headers).json()
    assert p["scenario"]["metrics"]["total_inflow"] <= p["baseline"]["metrics"]["total_inflow"] + 1
    created = client.post("/api/scenarios", json={"name": "Late payer", **{"adjustments": body["adjustments"]}}, headers=demo_headers)
    assert created.status_code == 201
    sid = created.json()["id"]
    assert client.get(f"/api/scenarios/{sid}/run", headers=demo_headers).status_code == 200
    assert client.delete(f"/api/scenarios/{sid}", headers=demo_headers).status_code == 204


def test_tenant_isolation(client, demo_headers):
    other = register(client, "other@tenant.sa")
    sid = client.get("/api/scenarios", headers=demo_headers).json()[0]["id"]
    assert client.get(f"/api/scenarios/{sid}/run", headers=other).status_code == 404
    inv = client.get("/api/invoices?kind=receivable", headers=demo_headers).json()[0]
    assert client.patch(f"/api/invoices/{inv['id']}", json={"status": "paid"}, headers=other).status_code == 404


def test_invoice_and_obligation_management(client):
    h = register(client, "tracker@test.sa")
    r = client.post(
        "/api/invoices",
        json={"kind": "payable", "number": "B-1", "counterparty": "Supplier", "issue_date": "2026-09-20", "due_date": "2026-10-20", "amount": 11500},
        headers=h,
    )
    assert r.status_code == 201 and r.json()["vat_amount"] == 1500
    iid = r.json()["id"]
    r = client.patch(f"/api/invoices/{iid}", json={"expected_date": "2026-10-25"}, headers=h)
    assert r.json()["expected_date"] == "2026-10-25"
    r = client.patch(f"/api/invoices/{iid}", json={"status": "paid"}, headers=h)
    assert r.json()["status"] == "paid" and r.json()["outstanding"] == 0
    assert client.delete(f"/api/invoices/{iid}", headers=h).status_code == 204

    o = client.post(
        "/api/obligations",
        json={"kind": "zakat", "name": "Zakat 2026", "amount": 42000, "frequency": "once", "next_due_date": "2026-11-30"},
        headers=h,
    )
    assert o.status_code == 201 and o.json()["next_payment_date"] == "2026-11-30"
    oid = o.json()["id"]
    assert client.patch(f"/api/obligations/{oid}", json={"amount": 45000}, headers=h).json()["user_modified"] is True
    assert client.delete(f"/api/obligations/{oid}", headers=h).status_code == 204


def test_alert_rules_and_test_notification(client, demo_headers):
    rules = client.get("/api/alerts/rules", headers=demo_headers).json()
    assert {r["kind"] for r in rules} >= {"low_balance", "runway", "shortfall_risk"}
    r = client.put("/api/alerts/rules/low_balance", json={"threshold_days": 60, "channels": ["in_app", "sms"]}, headers=demo_headers)
    assert r.status_code == 200 and r.json()["threshold_days"] == 60
    alerts = client.get("/api/alerts", headers=demo_headers).json()
    assert any(a["kind"] == "low_balance" for a in alerts)
    t = client.post("/api/alerts/test", json={"channel": "email"}, headers=demo_headers).json()
    assert t["status"] == "sandbox"
    notes = client.get("/api/alerts/notifications", headers=demo_headers).json()
    assert notes and notes[0]["channel"] == "email"


def test_privacy_export_and_delete(client):
    h = register(client, "pdpl@test.sa")
    code, state = connect(client, h, "lean", "riyad")
    client.post("/api/integrations/callback", json={"code": code, "state": state}, headers=h)
    r = client.get("/api/privacy/export", headers=h)
    assert r.status_code == 200
    data = r.json()
    assert data["transactions"] and "access_token" not in data["connections"][0]
    assert client.post("/api/privacy/delete-account", json={"password": "wrong", "confirm": "DELETE"}, headers=h).status_code == 400
    assert client.post("/api/privacy/delete-account", json={"password": "password123", "confirm": "DELETE"}, headers=h).status_code == 204
    assert client.get("/api/auth/me", headers=h).status_code == 401


def test_company_settings_validation(client):
    h = register(client, "settings@test.sa")
    assert client.put("/api/company", json={"vat_number": "123"}, headers=h).status_code == 422
    ok = client.put("/api/company", json={"vat_number": "300000000000003", "min_cash_buffer": 75000}, headers=h)
    assert ok.status_code == 200 and ok.json()["min_cash_buffer"] == 75000
