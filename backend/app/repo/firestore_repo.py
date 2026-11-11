"""Firestore implementation. Uses the project's default credentials on Cloud Run
(or FIRESTORE_EMULATOR_HOST locally); no keys in code."""

from __future__ import annotations

import hashlib
import os
import time
from datetime import datetime, timezone
from dataclasses import asdict

from . import BrandRec, EmailTaken, SavedRec, UserRec, new_id, utcnow


class FirestoreRepo:
    def __init__(self, client=None):
        if client is None:
            from google.cloud import firestore

            client = firestore.Client(project=os.environ.get("GOOGLE_CLOUD_PROJECT") or None)
        self.db = client

    # ── helpers ────────────────────────────────────────────────────────────
    def _users(self):
        return self.db.collection("users")

    def _saved(self, uid: str):
        return self._users().document(uid).collection("saved")

    @staticmethod
    def _user_from(snap) -> UserRec | None:
        if not snap.exists:
            return None
        d = snap.to_dict()
        return UserRec(
            id=snap.id, email=d["email"], password_hash=d["password_hash"], full_name=d.get("full_name"),
            tour_done=d.get("tour_done", False), session_version=d.get("session_version", 1),
            created_at=d.get("created_at") or utcnow(), brand=BrandRec.from_dict(d.get("brand"), snap.id),
        )

    @staticmethod
    def _saved_from(snap) -> SavedRec:
        d = snap.to_dict()
        return SavedRec(h3_id=snap.id, lat=d["lat"], lng=d["lng"], score_at_save=d.get("score_at_save", 0),
                        locality=d.get("locality"), note=d.get("note"), created_at=d.get("created_at") or utcnow())

    # ── users ──────────────────────────────────────────────────────────────
    def get_user(self, uid: str) -> UserRec | None:
        if not uid or len(uid) > 64:
            return None
        return self._user_from(self._users().document(uid).get())

    def get_user_by_email(self, email: str) -> UserRec | None:
        snap = self.db.collection("emails").document(email).get()
        if not snap.exists:
            return None
        return self.get_user(snap.to_dict()["uid"])

    def create_user(self, email: str, password_hash: str, full_name: str | None) -> UserRec:
        uid = new_id()
        user = UserRec(id=uid, email=email, password_hash=password_hash, full_name=full_name)
        batch = self.db.batch()
        # create() fails if the email doc already exists, so two sign-ups can't share an email
        email_ref = self.db.collection("emails").document(email)
        try:
            email_ref.create({"uid": uid, "created_at": utcnow()})
        except Exception as e:  # google.api_core.exceptions.AlreadyExists
            if "exist" in type(e).__name__.lower() or "exist" in str(e).lower():
                raise EmailTaken() from e
            raise
        batch.set(self._users().document(uid), {
            "email": email, "password_hash": password_hash, "full_name": full_name,
            "tour_done": False, "session_version": 1, "created_at": user.created_at, "brand": None,
        })
        batch.commit()
        return user

    def update_user(self, uid: str, **fields) -> None:
        self._users().document(uid).update(fields)

    def delete_user(self, uid: str) -> None:
        user = self.get_user(uid)
        for snap in self._saved(uid).stream():
            snap.reference.delete()
        if user:
            self.db.collection("emails").document(user.email).delete()
        self._users().document(uid).delete()

    def save_brand(self, uid: str, brand: BrandRec) -> BrandRec:
        brand.id = uid
        d = brand.to_dict()
        d.pop("id", None)
        self._users().document(uid).update({"brand": d})
        return brand

    # ── shortlist ──────────────────────────────────────────────────────────
    def list_saved(self, uid: str) -> list[SavedRec]:
        out = [self._saved_from(s) for s in self._saved(uid).stream()]
        return sorted(out, key=lambda s: s.created_at)

    def get_saved(self, uid: str, h3_id: str) -> SavedRec | None:
        snap = self._saved(uid).document(h3_id).get()
        return self._saved_from(snap) if snap.exists else None

    def add_saved(self, uid: str, rec: SavedRec) -> SavedRec:
        d = asdict(rec)
        d.pop("h3_id")
        self._saved(uid).document(rec.h3_id).set(d)
        return rec

    def update_saved_note(self, uid: str, h3_id: str, note: str | None) -> SavedRec | None:
        ref = self._saved(uid).document(h3_id)
        if not ref.get().exists:
            return None
        ref.update({"note": note})
        return self.get_saved(uid, h3_id)

    def delete_saved(self, uid: str, h3_id: str) -> bool:
        ref = self._saved(uid).document(h3_id)
        if not ref.get().exists:
            return False
        ref.delete()
        return True

    def count_saved(self, uid: str) -> int:
        return len(list(self._saved(uid).stream()))

    # ── shared rate limits (fixed window) ──────────────────────────────────
    def _counter(self, key: str):
        return self.db.collection("counters").document(hashlib.sha256(key.encode()).hexdigest()[:40])

    def hit(self, key: str, limit: int, window_s: int) -> bool:
        window = int(time.time() // window_s)
        ref = self._counter(key)
        snap = ref.get()
        d = snap.to_dict() if snap.exists else {}
        count = d.get("count", 0) if d.get("window") == window else 0
        if count >= limit:
            return False
        # not a transaction: a few extra requests can slip through under a race, which is fine for limits
        # `expires` is a timestamp so a Firestore TTL policy on counters.expires deletes stale counters
        ref.set({"window": window, "count": count + 1,
                 "expires": datetime.fromtimestamp(time.time() + window_s * 2, tz=timezone.utc)})
        return True

    def reset_counter(self, key: str) -> None:
        self._counter(key).delete()
