"""Runtime configuration, read once from the environment (.env in repo root)."""

from __future__ import annotations

import os
import secrets
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent.parent
load_dotenv(ROOT / ".env")


def _bool(name: str, default: bool) -> bool:
    v = os.environ.get(name)
    if v is None:
        return default
    return v.strip().lower() in {"1", "true", "yes", "on"}


def _secret_key(prod: bool) -> str:
    """Signs session cookies. Production must set SECRET_KEY (e.g. from Secret Manager);
    development keeps a generated one in data/.secret_key so restarts don't log everyone out."""
    key = os.environ.get("SECRET_KEY", "").strip()
    if key:
        return key
    if prod:
        raise RuntimeError("SECRET_KEY must be set in production.")
    path = ROOT / "data" / ".secret_key"
    if path.exists():
        return path.read_text().strip()
    path.parent.mkdir(parents=True, exist_ok=True)
    key = secrets.token_urlsafe(48)
    path.write_text(key)
    path.chmod(0o600)
    return key


@dataclass(frozen=True)
class Settings:
    env: str
    storage: str
    allowed_origins: tuple[str, ...]
    cookie_secure: bool
    session_days: int
    serve_frontend: bool
    secret_key: str
    trust_proxy: bool

    @property
    def is_production(self) -> bool:
        return self.env == "production"


def load_settings() -> Settings:
    env = os.environ.get("APP_ENV", "development").strip().lower()
    prod = env == "production"
    origins = os.environ.get(
        "ALLOWED_ORIGINS",
        "" if prod else "http://localhost:5173,http://localhost:5174,http://127.0.0.1:5173",
    )
    return Settings(
        env=env,
        storage=os.environ.get("STORAGE", "sqlite").strip().lower(),
        allowed_origins=tuple(o.strip() for o in origins.split(",") if o.strip()),
        cookie_secure=_bool("COOKIE_SECURE", prod),
        session_days=int(os.environ.get("SESSION_DAYS", "7")),
        serve_frontend=_bool("SERVE_FRONTEND", prod),
        secret_key=_secret_key(prod),
        trust_proxy=_bool("TRUST_PROXY", prod),
    )


settings = load_settings()
