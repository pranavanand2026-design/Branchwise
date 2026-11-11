"""Password hashing, signed sessions, CSRF guard, shared rate limiting.

Design (built to run on many stateless instances):
- Passwords: Argon2id (argon2-cffi defaults), rehashed when parameters change.
- Sessions: an HMAC-SHA256 signed cookie {uid, version, expiry}. Verifying it needs no
  database read. Each request then loads the user once (the brand comes in the same
  document), and the token's version must match the account's session_version, so
  "sign out everywhere", password changes and account deletion revoke every token.
  The cookie is httpOnly, SameSite=Lax and Secure in production.
- CSRF: every state-changing /api request must carry `X-Requested-With: branchwise`.
  Browsers will not send a custom header cross-site without a CORS preflight, and
  CORS only allows configured origins.
- Rate limiting: fixed-window counters in the shared store (Firestore or SQL), so all
  instances count together.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import secrets
import time

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError
from fastapi import Depends, HTTPException, Request, Response, status

from .repo import Repo, UserRec, get_repo
from .settings import settings

SESSION_COOKIE = "bw_session"
CSRF_HEADER = "x-requested-with"
CSRF_VALUE = "branchwise"

_ph = PasswordHasher()
# Used to equalise timing when the email does not exist
_DUMMY_HASH = _ph.hash(secrets.token_urlsafe(16))


# ─── Passwords ───────────────────────────────────────────────────────────────


def hash_password(pw: str) -> str:
    return _ph.hash(pw)


def verify_password(stored_hash: str | None, pw: str) -> bool:
    try:
        return _ph.verify(stored_hash or _DUMMY_HASH, pw) and stored_hash is not None
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False


def needs_rehash(stored_hash: str) -> bool:
    try:
        return _ph.check_needs_rehash(stored_hash)
    except InvalidHashError:
        return False


def password_problem(pw: str, email: str) -> str | None:
    if len(pw) < 10:
        return "Use at least 10 characters."
    if len(pw) > 200:
        return "Use 200 characters or fewer."
    if pw.lower() == email.lower() or pw.lower() in email.lower():
        return "Your password can't contain your email."
    if len(set(pw)) < 5:
        return "Pick something less repetitive."
    return None


# ─── Signed sessions ─────────────────────────────────────────────────────────


def _b64(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode()


def _unb64(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def _sign(payload: bytes) -> str:
    return _b64(hmac.new(settings.secret_key.encode(), payload, hashlib.sha256).digest())


def make_token(user: UserRec) -> str:
    payload = json.dumps({"u": user.id, "v": user.session_version,
                          "e": int(time.time()) + settings.session_days * 86400}, separators=(",", ":")).encode()
    return f"{_b64(payload)}.{_sign(payload)}"


def read_token(token: str) -> dict | None:
    try:
        body, sig = token.split(".", 1)
        payload = _unb64(body)
    except (ValueError, TypeError):
        return None
    if not hmac.compare_digest(sig, _sign(payload)):
        return None
    try:
        data = json.loads(payload)
    except ValueError:
        return None
    if not isinstance(data, dict) or data.get("e", 0) < time.time():
        return None
    return data


def set_session_cookie(response: Response, user: UserRec) -> None:
    response.set_cookie(
        SESSION_COOKIE, make_token(user),
        max_age=settings.session_days * 86400,
        httponly=True, secure=settings.cookie_secure, samesite="lax", path="/",
    )


def clear_session_cookie(response: Response) -> None:
    response.delete_cookie(SESSION_COOKIE, path="/", secure=settings.cookie_secure, httponly=True, samesite="lax")


def revoke_all_sessions(repo: Repo, user: UserRec) -> UserRec:
    """Invalidate every token for this account (they carry the old version)."""
    user.session_version += 1
    repo.update_user(user.id, session_version=user.session_version)
    return user


def current_user_optional(request: Request, repo: Repo = Depends(get_repo)) -> UserRec | None:
    token = request.cookies.get(SESSION_COOKIE)
    if not token or len(token) > 512:
        return None
    data = read_token(token)
    if data is None:
        return None
    user = repo.get_user(str(data.get("u", "")))
    if user is None or user.session_version != data.get("v"):
        return None
    return user


def current_user(user: UserRec | None = Depends(current_user_optional)) -> UserRec:
    if user is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Please log in.")
    return user


# ─── CSRF ────────────────────────────────────────────────────────────────────

SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}


def csrf_ok(request: Request) -> bool:
    if request.method in SAFE_METHODS or not request.url.path.startswith("/api/"):
        return True
    return request.headers.get(CSRF_HEADER, "").lower() == CSRF_VALUE


# ─── Rate limiting (shared across instances) ─────────────────────────────────


def client_ip(request: Request) -> str:
    # Cloud Run puts the caller first in X-Forwarded-For
    fwd = request.headers.get("x-forwarded-for")
    if fwd and settings.trust_proxy:
        return fwd.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def enforce_rate(key: str, limit: int, window_s: int, message: str = "Too many attempts. Try again in a few minutes.") -> None:
    if not get_repo().hit(key, limit, window_s):
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, message)


def reset_rate(key: str) -> None:
    get_repo().reset_counter(key)
