"""Run every API test against both storage backends."""

import os

import pytest

BACKENDS = os.environ.get("STORAGE_BACKENDS", "sqlite,firestore").split(",")


@pytest.fixture(autouse=True, params=BACKENDS)
def storage_backend(request, monkeypatch):
    from backend.app import repo as repo_mod

    original = repo_mod.get_repo
    original.cache_clear()
    if request.param == "firestore":
        from backend.app.repo.firestore_repo import FirestoreRepo
        from backend.tests.fake_firestore import FakeClient

        fake = FirestoreRepo(client=FakeClient())
        monkeypatch.setattr(repo_mod, "get_repo", lambda: fake)
        # modules that imported get_repo by name
        import backend.app.auth as auth, backend.app.brand as brand, backend.app.security as sec, backend.app.main as main
        for mod in (auth, brand, sec, main):
            if hasattr(mod, "get_repo"):
                monkeypatch.setattr(mod, "get_repo", lambda: fake)
        main.app.dependency_overrides[original] = lambda: fake
        yield "firestore"
        main.app.dependency_overrides.clear()
    elif request.param == "emulator":
        from backend.app.repo.firestore_repo import FirestoreRepo

        monkeypatch.setenv("STORAGE", "firestore")
        yield "emulator"
    else:
        monkeypatch.setenv("STORAGE", "sqlite")
        yield "sqlite"
    original.cache_clear()
