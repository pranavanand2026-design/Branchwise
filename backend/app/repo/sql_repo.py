"""SQL implementation (SQLite by default, any SQLAlchemy URL via DATABASE_URL).
Same shape as the Firestore layout: one row per user with the brand as JSON."""

from __future__ import annotations

import json
import os
import time
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import (
    JSON, Boolean, DateTime, Float, ForeignKey, Integer, String, Text, create_engine, delete, event, func, select,
)
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, sessionmaker

from . import BrandRec, EmailTaken, SavedRec, UserRec, new_id, utcnow

ROOT = Path(__file__).resolve().parents[3]


class Base(DeclarativeBase):
    pass


class UserRow(Base):
    __tablename__ = "accounts"
    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    email: Mapped[str] = mapped_column(String(254), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    full_name: Mapped[str | None] = mapped_column(String(120))
    tour_done: Mapped[bool] = mapped_column(Boolean, default=False)
    session_version: Mapped[int] = mapped_column(Integer, default=1)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    brand: Mapped[dict | None] = mapped_column(JSON, nullable=True)


class SavedRow(Base):
    __tablename__ = "shortlist"
    user_id: Mapped[str] = mapped_column(ForeignKey("accounts.id", ondelete="CASCADE"), primary_key=True)
    h3_id: Mapped[str] = mapped_column(String(20), primary_key=True)
    lat: Mapped[float] = mapped_column(Float)
    lng: Mapped[float] = mapped_column(Float)
    score_at_save: Mapped[int] = mapped_column(Integer)
    locality: Mapped[str | None] = mapped_column(String(120))
    note: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class CounterRow(Base):
    __tablename__ = "counters"
    key: Mapped[str] = mapped_column(String(200), primary_key=True)
    window: Mapped[int] = mapped_column(Integer)
    count: Mapped[int] = mapped_column(Integer)


def _aware(dt: datetime) -> datetime:
    return dt if dt is None or dt.tzinfo else dt.replace(tzinfo=timezone.utc)


class SqlRepo:
    def __init__(self, url: str | None = None):
        url = url or os.environ.get("DATABASE_URL") or f"sqlite:///{ROOT / 'data' / 'app_v2.db'}"
        sqlite = url.startswith("sqlite")
        if sqlite and ":memory:" not in url:
            Path(url.removeprefix("sqlite:///")).parent.mkdir(parents=True, exist_ok=True)
        self.engine = create_engine(url, connect_args={"check_same_thread": False} if sqlite else {}, pool_pre_ping=True)
        if sqlite:
            @event.listens_for(self.engine, "connect")
            def _pragmas(conn, _):  # pragma: no cover
                cur = conn.cursor()
                cur.execute("PRAGMA foreign_keys=ON")
                cur.execute("PRAGMA journal_mode=WAL")
                cur.close()
        Base.metadata.create_all(self.engine)
        if sqlite and ":memory:" not in url:
            try:
                os.chmod(url.removeprefix("sqlite:///"), 0o600)
            except OSError:
                pass
        self.Session = sessionmaker(bind=self.engine, expire_on_commit=False)

    # ── users ──────────────────────────────────────────────────────────────
    @staticmethod
    def _user(row: UserRow | None) -> UserRec | None:
        if row is None:
            return None
        return UserRec(id=row.id, email=row.email, password_hash=row.password_hash, full_name=row.full_name,
                       tour_done=row.tour_done, session_version=row.session_version,
                       created_at=_aware(row.created_at), brand=BrandRec.from_dict(row.brand, row.id))

    def get_user(self, uid: str) -> UserRec | None:
        with self.Session() as s:
            return self._user(s.get(UserRow, uid))

    def get_user_by_email(self, email: str) -> UserRec | None:
        with self.Session() as s:
            return self._user(s.scalar(select(UserRow).where(UserRow.email == email)))

    def create_user(self, email: str, password_hash: str, full_name: str | None) -> UserRec:
        row = UserRow(id=new_id(), email=email, password_hash=password_hash, full_name=full_name,
                      tour_done=False, session_version=1, created_at=utcnow(), brand=None)
        with self.Session() as s:
            s.add(row)
            try:
                s.commit()
            except IntegrityError as e:
                raise EmailTaken() from e
            return self._user(row)

    def update_user(self, uid: str, **fields) -> None:
        with self.Session() as s:
            row = s.get(UserRow, uid)
            if row is None:
                return
            for k, v in fields.items():
                setattr(row, k, v)
            s.commit()

    def delete_user(self, uid: str) -> None:
        with self.Session() as s:
            s.execute(delete(SavedRow).where(SavedRow.user_id == uid))
            s.execute(delete(UserRow).where(UserRow.id == uid))
            s.commit()

    def save_brand(self, uid: str, brand: BrandRec) -> BrandRec:
        brand.id = uid
        d = json.loads(json.dumps(brand.to_dict(), default=str))
        d.pop("id", None)
        self.update_user(uid, brand=d)
        return brand

    # ── shortlist ──────────────────────────────────────────────────────────
    @staticmethod
    def _saved(r: SavedRow) -> SavedRec:
        return SavedRec(h3_id=r.h3_id, lat=r.lat, lng=r.lng, score_at_save=r.score_at_save,
                        locality=r.locality, note=r.note, created_at=_aware(r.created_at))

    def list_saved(self, uid: str) -> list[SavedRec]:
        with self.Session() as s:
            rows = s.scalars(select(SavedRow).where(SavedRow.user_id == uid).order_by(SavedRow.created_at)).all()
            return [self._saved(r) for r in rows]

    def get_saved(self, uid: str, h3_id: str) -> SavedRec | None:
        with self.Session() as s:
            r = s.get(SavedRow, (uid, h3_id))
            return self._saved(r) if r else None

    def add_saved(self, uid: str, rec: SavedRec) -> SavedRec:
        with self.Session() as s:
            if s.get(SavedRow, (uid, rec.h3_id)) is None:
                s.add(SavedRow(user_id=uid, h3_id=rec.h3_id, lat=rec.lat, lng=rec.lng, score_at_save=rec.score_at_save,
                               locality=rec.locality, note=rec.note, created_at=rec.created_at))
                s.commit()
        return self.get_saved(uid, rec.h3_id)  # type: ignore[return-value]

    def update_saved_note(self, uid: str, h3_id: str, note: str | None) -> SavedRec | None:
        with self.Session() as s:
            r = s.get(SavedRow, (uid, h3_id))
            if r is None:
                return None
            r.note = note
            s.commit()
            return self._saved(r)

    def delete_saved(self, uid: str, h3_id: str) -> bool:
        with self.Session() as s:
            n = s.execute(delete(SavedRow).where(SavedRow.user_id == uid, SavedRow.h3_id == h3_id)).rowcount
            s.commit()
            return bool(n)

    def count_saved(self, uid: str) -> int:
        with self.Session() as s:
            return s.scalar(select(func.count()).select_from(SavedRow).where(SavedRow.user_id == uid)) or 0

    # ── shared rate limits (fixed window) ──────────────────────────────────
    def hit(self, key: str, limit: int, window_s: int) -> bool:
        window = int(time.time() // window_s)
        with self.Session() as s:
            row = s.get(CounterRow, key[:200])
            if row is None:
                s.add(CounterRow(key=key[:200], window=window, count=1))
                s.commit()
                return True
            if row.window != window:
                row.window, row.count = window, 0
            if row.count >= limit:
                return False
            row.count += 1
            s.commit()
            return True

    def reset_counter(self, key: str) -> None:
        with self.Session() as s:
            s.execute(delete(CounterRow).where(CounterRow.key == key[:200]))
            s.commit()
