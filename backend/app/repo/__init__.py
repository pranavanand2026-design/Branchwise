"""Storage behind one small interface, so the app runs on SQLite locally and Firestore in production.

Pick with STORAGE=sqlite (default) or STORAGE=firestore. Routes only see the plain records
below, never a database object.

Firestore layout (read-light: loading the app costs one document read):
  users/{uid}                 account + brand + stores (stores capped at 300, well under 1 MiB)
  users/{uid}/saved/{h3_id}   shortlist entries
  emails/{email}              {uid}; created in a transaction so emails stay unique
  counters/{key}              fixed-window rate-limit counters shared by every instance
"""

from __future__ import annotations

import os
import uuid
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from functools import lru_cache
from typing import Protocol


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def new_id() -> str:
    return uuid.uuid4().hex


class EmailTaken(Exception):
    pass


@dataclass
class StoreRec:
    name: str
    lat: float
    lng: float
    locality: str | None = None
    fsq_place_id: str | None = None
    id: str = field(default_factory=new_id)


@dataclass
class BrandRec:
    name: str
    vertical: str
    description: str | None = None
    store_format: str | None = None
    store_count_band: str | None = None
    priorities: dict = field(default_factory=dict)
    regions: list = field(default_factory=list)
    onboarded: bool = False
    stores: list[StoreRec] = field(default_factory=list)
    id: str = ""  # = owner's user id

    def to_dict(self) -> dict:
        d = asdict(self)
        d["stores"] = [asdict(s) for s in self.stores]
        return d

    @staticmethod
    def from_dict(d: dict | None, uid: str) -> "BrandRec | None":
        if not d:
            return None
        d = dict(d)
        d["stores"] = [StoreRec(**s) for s in d.get("stores", [])]
        d["id"] = uid
        return BrandRec(**{k: v for k, v in d.items() if k in BrandRec.__dataclass_fields__})


@dataclass
class UserRec:
    id: str
    email: str
    password_hash: str
    full_name: str | None = None
    tour_done: bool = False
    session_version: int = 1
    created_at: datetime = field(default_factory=utcnow)
    brand: BrandRec | None = None


@dataclass
class SavedRec:
    h3_id: str
    lat: float
    lng: float
    score_at_save: int
    locality: str | None = None
    note: str | None = None
    created_at: datetime = field(default_factory=utcnow)

    @property
    def id(self) -> str:
        return self.h3_id


class Repo(Protocol):
    def get_user(self, uid: str) -> UserRec | None: ...
    def get_user_by_email(self, email: str) -> UserRec | None: ...
    def create_user(self, email: str, password_hash: str, full_name: str | None) -> UserRec: ...
    def update_user(self, uid: str, **fields) -> None: ...
    def delete_user(self, uid: str) -> None: ...
    def save_brand(self, uid: str, brand: BrandRec) -> BrandRec: ...
    def list_saved(self, uid: str) -> list[SavedRec]: ...
    def get_saved(self, uid: str, h3_id: str) -> SavedRec | None: ...
    def add_saved(self, uid: str, rec: SavedRec) -> SavedRec: ...
    def update_saved_note(self, uid: str, h3_id: str, note: str | None) -> SavedRec | None: ...
    def delete_saved(self, uid: str, h3_id: str) -> bool: ...
    def count_saved(self, uid: str) -> int: ...
    def hit(self, key: str, limit: int, window_s: int) -> bool: ...
    def reset_counter(self, key: str) -> None: ...


@lru_cache(maxsize=1)
def get_repo() -> Repo:
    kind = os.environ.get("STORAGE", "sqlite").strip().lower()
    if kind == "firestore":
        from .firestore_repo import FirestoreRepo

        return FirestoreRepo()
    from .sql_repo import SqlRepo

    return SqlRepo()
