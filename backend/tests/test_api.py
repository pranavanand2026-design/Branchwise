"""End-to-end API tests: auth, CSRF, per-account isolation, brand flow.

Run:  .venv/bin/python -m pytest backend/tests -q
Needs data/sydney_pois.parquet (run scripts/prepare_sydney.py --synthetic).
"""

from __future__ import annotations

import os
import tempfile

_tmp = tempfile.mkdtemp()
os.environ["DATABASE_URL"] = f"sqlite:///{_tmp}/test.db"
os.environ["APP_ENV"] = "test"

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from backend.app.main import app  # noqa: E402

H = {"X-Requested-With": "branchwise"}
PW = "correct-horse-battery"


def client() -> TestClient:
    return TestClient(app)


def signup(c: TestClient, email: str) -> None:
    r = c.post("/api/auth/signup", json={"email": email, "password": PW}, headers=H)
    assert r.status_code == 201, r.text


def make_brand(c: TestClient, name: str = "Tea Lab") -> dict:
    r = c.put("/api/brand", headers=H, json={
        "name": name, "vertical": "bubble_tea",
        "priorities": {"market_saturation": 4, "cannibalisation": 3, "surrounding_amenities": 2,
                       "transit_accessibility": 2, "demographic_match": 1},
        "regions": ["inner_west"], "onboarded": True,
    })
    assert r.status_code == 200, r.text
    return r.json()


@pytest.fixture(scope="module")
def c():
    with TestClient(app) as cl:
        yield cl


def test_csrf_header_required(c):
    r = c.post("/api/auth/signup", json={"email": "x@example.com", "password": PW})
    assert r.status_code == 403


def test_signup_validation(c):
    r = c.post("/api/auth/signup", json={"email": "nope", "password": PW}, headers=H)
    assert r.status_code == 422
    r = c.post("/api/auth/signup", json={"email": "short@example.com", "password": "abc"}, headers=H)
    assert r.status_code == 422


def test_full_flow_and_isolation():
    with TestClient(app) as a, TestClient(app) as b:
        signup(a, "owner-a@example.com")
        signup(b, "owner-b@example.com")

        # cookie is httpOnly + SameSite
        r = a.post("/api/auth/login", json={"email": "owner-a@example.com", "password": PW}, headers=H)
        cookie = r.headers["set-cookie"].lower()
        assert "httponly" in cookie and "samesite=lax" in cookie

        # no brand yet -> map endpoints refuse
        assert a.get("/api/heatmap").status_code == 409

        brand_a = make_brand(a, "Tea Lab")
        assert abs(sum(brand_a["weights"].values()) - 100) < 0.5

        places = a.get("/api/places/search", params={"q": "gong"}).json()["places"]
        assert places
        r = a.put("/api/brand/stores", headers=H, json={"stores": [
            {"name": p["name"], "lat": p["lat"], "lng": p["lng"], "locality": p["locality"],
             "fsq_place_id": p["fsq_place_id"]} for p in places[:5]
        ]})
        assert len(r.json()["stores"]) == 5

        sites = a.get("/api/rankings", params={"limit": 5}).json()["sites"]
        assert 1 <= len(sites) <= 5
        assert sites == sorted(sites, key=lambda s: -s["score"])

        rep = a.get(f"/api/report/{sites[0]['h3_id']}").json()
        assert rep["summary"] and rep["score"] == sites[0]["score"]

        saved = a.post("/api/shortlist", headers=H, json={"h3_id": sites[0]["h3_id"]}).json()
        assert a.get("/api/shortlist").json()["sites"][0]["h3_id"] == sites[0]["h3_id"]

        # B cannot see or touch A's data
        assert b.get("/api/brand").status_code == 409
        make_brand(b, "Other Co")
        assert b.get("/api/shortlist").json()["sites"] == []
        assert b.delete(f"/api/shortlist/{saved['id']}", headers=H).status_code == 404
        assert a.get("/api/shortlist").json()["sites"]

        # logout kills the session
        a.post("/api/auth/logout", headers=H)
        assert a.get("/api/brand").status_code == 401


def test_bad_inputs(c):
    with TestClient(app) as a:
        signup(a, "inputs@example.com")
        make_brand(a)
        assert a.get("/api/report/not-a-cell").status_code == 422
        r = a.put("/api/brand/stores", headers=H, json={"stores": [{"name": "Moon", "lat": 0, "lng": 0}]})
        assert r.status_code == 422
        r = a.put("/api/brand", headers=H, json={"name": "x", "vertical": "nope"})
        assert r.status_code == 422
        # LIKE wildcards are escaped, not interpreted
        assert a.get("/api/places/search", params={"q": "%%"}).json()["places"] == []


def test_login_rate_limit():
    with TestClient(app) as a:
        signup(a, "limited@example.com")
        codes = [
            a.post("/api/auth/login", json={"email": "limited@example.com", "password": "wrong-password-1"},
                   headers=H).status_code
            for _ in range(10)
        ]
        assert codes[0] == 401 and 429 in codes


def test_password_change_and_delete():
    with TestClient(app) as a:
        signup(a, "delete-me@example.com")
        r = a.post("/api/account/password", headers=H,
                   json={"current_password": PW, "new_password": "another-long-passphrase"})
        assert r.status_code == 200
        r = a.request("DELETE", "/api/account", headers=H, json={"password": "another-long-passphrase"})
        assert r.status_code == 204
        r = a.post("/api/auth/login", json={"email": "delete-me@example.com",
                                            "password": "another-long-passphrase"}, headers=H)
        assert r.status_code == 401
