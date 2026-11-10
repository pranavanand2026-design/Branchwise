"""Runtime configuration, read once from the environment (.env in repo root)."""

from __future__ import annotations

import os
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


@dataclass(frozen=True)
class Settings:
    env: str
    database_url: str
    allowed_origins: tuple[str, ...]
    cookie_secure: bool
    session_days: int
    serve_frontend: bool

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
        database_url=os.environ.get("DATABASE_URL", f"sqlite:///{ROOT / 'data' / 'app.db'}"),
        allowed_origins=tuple(o.strip() for o in origins.split(",") if o.strip()),
        cookie_secure=_bool("COOKIE_SECURE", prod),
        session_days=int(os.environ.get("SESSION_DAYS", "14")),
        serve_frontend=_bool("SERVE_FRONTEND", prod),
    )


settings = load_settings()
