"""In-memory stand-in for the subset of google.cloud.firestore the app uses.

Behaves like the real client where it matters: snapshots copy data, create() fails
when the document exists, update() fails when it doesn't, subcollections live under
their document path, and a batch applies its writes on commit.
For a full check, run the suite against the real emulator:
  gcloud emulators firestore start --host-port=127.0.0.1:8085   (needs Java 21+)
  FIRESTORE_EMULATOR_HOST=127.0.0.1:8085 STORAGE_BACKENDS=emulator pytest backend/tests
"""

from __future__ import annotations

import copy


class AlreadyExists(Exception):
    pass


class NotFound(Exception):
    pass


class Snapshot:
    def __init__(self, ref: "DocRef", data: dict | None):
        self.reference = ref
        self.id = ref.id
        self._data = copy.deepcopy(data)
        self.exists = data is not None

    def to_dict(self) -> dict | None:
        return copy.deepcopy(self._data)


class DocRef:
    def __init__(self, store: dict, path: str):
        self._store = store
        self.path = path
        self.id = path.rsplit("/", 1)[-1]

    def get(self) -> Snapshot:
        return Snapshot(self, self._store.get(self.path))

    def set(self, data: dict) -> None:
        self._store[self.path] = copy.deepcopy(data)

    def create(self, data: dict) -> None:
        if self.path in self._store:
            raise AlreadyExists(f"Document already exists: {self.path}")
        self.set(data)

    def update(self, data: dict) -> None:
        if self.path not in self._store:
            raise NotFound(self.path)
        self._store[self.path].update(copy.deepcopy(data))

    def delete(self) -> None:
        self._store.pop(self.path, None)

    def collection(self, name: str) -> "CollRef":
        return CollRef(self._store, f"{self.path}/{name}")


class CollRef:
    def __init__(self, store: dict, path: str):
        self._store = store
        self.path = path

    def document(self, doc_id: str) -> DocRef:
        return DocRef(self._store, f"{self.path}/{doc_id}")

    def stream(self):
        prefix = self.path + "/"
        for p in list(self._store):
            rest = p[len(prefix):]
            if p.startswith(prefix) and "/" not in rest:
                yield Snapshot(DocRef(self._store, p), self._store[p])


class Batch:
    def __init__(self):
        self._ops: list = []

    def set(self, ref: DocRef, data: dict) -> None:
        self._ops.append((ref, data))

    def commit(self) -> None:
        for ref, data in self._ops:
            ref.set(data)


class FakeClient:
    def __init__(self):
        self.store: dict[str, dict] = {}

    def collection(self, name: str) -> CollRef:
        return CollRef(self.store, name)

    def batch(self) -> Batch:
        return Batch()
