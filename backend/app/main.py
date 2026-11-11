"""FastAPI entrypoint for Branchwise."""

from __future__ import annotations

import json
import logging
import threading
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, Field

from . import auth, brand
from .db import DATA_PARQUET, get_con
from .scoring import warm_cache
from .security import csrf_ok, current_user
from .settings import ROOT, settings
from .storage import User, init_db

log = logging.getLogger("branchwise")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    init_db()
    if DATA_PARQUET.exists():
        # Precompute per-category signals in the background so the first map load is fast
        threading.Thread(target=warm_cache, daemon=True).start()
    else:
        log.warning("Missing %s. Run: python scripts/prepare_sydney.py", DATA_PARQUET)
    yield


app = FastAPI(
    title="Branchwise API",
    version="0.2.0",
    lifespan=lifespan,
    docs_url=None if settings.is_production else "/api/docs",
    redoc_url=None,
    openapi_url=None if settings.is_production else "/api/openapi.json",
)

app.add_middleware(GZipMiddleware, minimum_size=1024)
app.add_middleware(
    CORSMiddleware,
    allow_origins=list(settings.allowed_origins),
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
    allow_headers=["Content-Type", "X-Requested-With"],
)

SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "geolocation=(), camera=(), microphone=()",
}


@app.middleware("http")
async def guard(request: Request, call_next):
    if not csrf_ok(request):
        return JSONResponse({"detail": "Missing request header."}, status_code=403)
    response = await call_next(request)
    for k, v in SECURITY_HEADERS.items():
        response.headers.setdefault(k, v)
    if settings.cookie_secure:
        response.headers.setdefault("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
    if request.url.path.startswith("/api/"):
        response.headers.setdefault("Cache-Control", "no-store")
    return response


app.include_router(auth.router)
app.include_router(brand.router)


# ─── Health ──────────────────────────────────────────────────────────────────


@app.get("/api/health")
def health() -> dict:
    n = get_con().execute("SELECT COUNT(*) FROM pois").fetchone()[0]
    meta_path = ROOT / "data" / "dataset.json"
    dataset = json.loads(meta_path.read_text()) if meta_path.exists() else {"source": "unknown"}
    return {"ok": True, "poi_count": int(n), "dataset": dataset,
            "assistant_enabled": settings.assistant_enabled}


# ─── Optional assistant (paused by default) ──────────────────────────────────


class ChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=1000)


@app.post("/api/chat")
def api_chat(req: ChatRequest, user: User = Depends(current_user)) -> dict:
    if not settings.assistant_enabled:
        raise HTTPException(503, "The assistant is turned off.")
    from .claude_chat import chat as claude_chat

    slug = None
    if user.brand:
        slug = "".join(ch for ch in user.brand.name.lower() if ch.isalpha())[:18] or None
    return claude_chat(req.message, brand_slug=slug)


# ─── Production: serve the built frontend from the same origin ───────────────

DIST = ROOT / "frontend" / "dist"

if settings.serve_frontend and DIST.exists():
    @app.get("/{full_path:path}", include_in_schema=False)
    def spa(full_path: str):
        if full_path.startswith("api/"):
            raise HTTPException(404)
        target = (DIST / full_path).resolve()
        if full_path and target.is_file() and DIST.resolve() in target.parents:
            return FileResponse(target)
        # /app/* is the React app; everything else is the static landing page
        if full_path == "app" or full_path.startswith("app/"):
            return FileResponse(DIST / "app.html")
        return FileResponse(DIST / "index.html")
