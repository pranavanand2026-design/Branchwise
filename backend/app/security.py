"""Password hashing, opaque server-side sessions, CSRF guard, rate limiting.

Design:
- Passwords: Argon2id (argon2-cffi defaults), rehashed when parameters change.
- Sessions: 32-byte random token in an httpOnly, SameSite=Lax cookie; the DB
  stores only its SHA-256, so a leaked database cannot be replayed as cookies.
  Sessions are revocable (logout, password change, account delete).
- CSRF: every state-changing /api request must carry `X-Requested-With:
  branchwise`. Browsers will not send a custom header cross-site without a
  CORS preflight, and CORS only allows configured origins.
- Rate limiting: in-process sliding window. Fine for one instance; swap for
  Redis when running more than one.
"""

from __future__ import annotations

import hashlib
import secrets
import threading
import time
from collections import defaultdict, deque
from datetime import datetime, timedelta, timezone

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError
from fastapi import Depends, HTTPException, Request, Response, status
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from .settings import settings
from .storage import AuthSession, User, get_db, utcnow

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


# ─── Sessions ────────────────────────────────────────────────────────────────


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _aware(dt: datetime) -> datetime:
    # SQLite returns naive datetimes; treat them as UTC
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def create_session(db: Session, user: User, response: Response, user_agent: str | None) -> None:
    token = secrets.token_urlsafe(32)
    expires = utcnow() + timedelta(days=settings.session_days)
    db.add(AuthSession(
        user_id=user.id, token_hash=_token_hash(token), expires_at=expires,
        user_agent=(user_agent or "")[:255],
    ))
    db.commit()
    response.set_cookie(
        SESSION_COOKIE, token,
        max_age=settings.session_days * 86400,
        httponly=True, secure=settings.cookie_secure, samesite="lax", path="/",
    )


def clear_session_cookie(response: Response) -> None:
    response.delete_cookie(SESSION_COOKIE, path="/", secure=settings.cookie_secure,
                           httponly=True, samesite="lax")


def revoke_session(db: Session, token: str | None) -> None:
    if token:
        db.execute(delete(AuthSession).where(AuthSession.token_hash == _token_hash(token)))
        db.commit()


def revoke_all_sessions(db: Session, user_id: str, keep_token: str | None = None) -> None:
    q = delete(AuthSession).where(AuthSession.user_id == user_id)
    if keep_token:
        q = q.where(AuthSession.token_hash != _token_hash(keep_token))
    db.execute(q)
    db.commit()


def current_user_optional(request: Request, db: Session = Depends(get_db)) -> User | None:
    token = request.cookies.get(SESSION_COOKIE)
    if not token or len(token) > 128:
        return None
    sess = db.scalar(select(AuthSession).where(AuthSession.token_hash == _token_hash(token)))
    if sess is None:
        return None
    now = utcnow()
    if _aware(sess.expires_at) <= now:
        db.delete(sess)
        db.commit()
        return None
    # Touch at most once an hour to avoid a write per request
    if now - _aware(sess.last_seen_at) > timedelta(hours=1):
        sess.last_seen_at = now
        db.commit()
    return sess.user


def current_user(user: User | None = Depends(current_user_optional)) -> User:
    if user is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Please log in.")
    return user


# ─── CSRF ────────────────────────────────────────────────────────────────────

SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}


def csrf_ok(request: Request) -> bool:
    if request.method in SAFE_METHODS or not request.url.path.startswith("/api/"):
        return True
    return request.headers.get(CSRF_HEADER, "").lower() == CSRF_VALUE


# ─── Rate limiting ───────────────────────────────────────────────────────────


class RateLimiter:
    def __init__(self) -> None:
        self._hits: dict[str, deque[float]] = defaultdict(deque)
        self._lock = threading.Lock()

    def hit(self, key: str, limit: int, window_s: int) -> bool:
        """Record a hit; return False if the key is over its limit."""
        now = time.monotonic()
        with self._lock:
            q = self._hits[key]
            while q and now - q[0] > window_s:
                q.popleft()
            if len(q) >= limit:
                return False
            q.append(now)
            if len(self._hits) > 50_000:  # crude memory guard
                self._hits.clear()
            return True

    def reset(self, key: str) -> None:
        with self._lock:
            self._hits.pop(key, None)


limiter = RateLimiter()


def client_ip(request: Request) -> str:
    # Behind a proxy, configure it to set X-Forwarded-For and run uvicorn with --proxy-headers
    return request.client.host if request.client else "unknown"


def enforce_rate(key: str, limit: int, window_s: int) -> None:
    if not limiter.hit(key, limit, window_s):
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Too many attempts. Try again in a few minutes.")
