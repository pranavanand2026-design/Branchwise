"""Brand profile, own stores, personalised map/rankings, shortlist.

Every route here is scoped to the signed-in user's brand — no endpoint takes a
brand id from the client, so one account can never read another's data.
"""

from __future__ import annotations

from typing import Literal

import h3
from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from pydantic import BaseModel, Field, field_validator

from .db import get_con, get_config
from .scoring import (
    SIGNALS, Profile, Store as ScoreStore, hex_report, hex_to_dict, rank_sites,
    score_profile, vertical_signals, weights_from_priorities, CURVES, PARAMS,
)
from .repo import BrandRec, Repo, SavedRec, StoreRec, UserRec, get_repo
from .security import current_user

router = APIRouter(prefix="/api")

# Sydney bbox — anything outside is rejected
LAT_MIN, LAT_MAX = -34.2, -33.5
LNG_MIN, LNG_MAX = 150.6, 151.4
MAX_STORES = 300
MAX_SAVED = 100

SIGNAL_INFO = {
    "demographic_match": {
        "label": "Busy streets",
        "question": "How much do you rely on walk-in foot traffic?",
        "detail": "Shops and venues within 300 m, a stand-in for foot traffic.",
    },
    "surrounding_amenities": {
        "label": "Near anchors",
        "question": "How important is being near unis, malls, offices or hospitals?",
        "detail": "Distance to the nearest anchor plus complementary venues nearby.",
    },
    "transit_accessibility": {
        "label": "Public transport",
        "question": "Do your customers arrive by train, metro or bus?",
        "detail": "Walking distance to the nearest station or stop.",
    },
    "market_saturation": {
        "label": "Low competition",
        "question": "How much do you want to avoid direct competitors?",
        "detail": "Direct competitors within 500 m.",
    },
    "cannibalisation": {
        "label": "Spacing from your stores",
        "question": "How far should a new site be from your existing stores?",
        "detail": "Distance to your nearest store; under 200 m scores zero.",
    },
}


# ─── Schemas ─────────────────────────────────────────────────────────────────


class BrandIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    vertical: str = Field(max_length=40)
    description: str | None = Field(default=None, max_length=1000)
    store_format: Literal["kiosk", "takeaway", "cafe", "restaurant"] | None = None
    store_count_band: Literal["1", "2-5", "6-20", "21-50", "50+"] | None = None
    priorities: dict[str, int] = Field(default_factory=dict)
    regions: list[str] = Field(default_factory=list, max_length=20)
    onboarded: bool | None = None

    @field_validator("vertical")
    @classmethod
    def _vertical(cls, v: str) -> str:
        if v not in get_config()["verticals"]:
            raise ValueError("Unknown category")
        return v

    @field_validator("priorities")
    @classmethod
    def _priorities(cls, v: dict[str, int]) -> dict[str, int]:
        out = {}
        for k, val in v.items():
            if k not in SIGNALS:
                raise ValueError(f"Unknown priority {k}")
            if not 0 <= int(val) <= 4:
                raise ValueError("Priorities are 0–4")
            out[k] = int(val)
        return out

    @field_validator("regions")
    @classmethod
    def _regions(cls, v: list[str]) -> list[str]:
        known = get_config().get("regions", {})
        bad = [r for r in v if r not in known]
        if bad:
            raise ValueError(f"Unknown regions: {', '.join(bad)}")
        return list(dict.fromkeys(v))


class StoreIn(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    lat: float = Field(ge=LAT_MIN, le=LAT_MAX)
    lng: float = Field(ge=LNG_MIN, le=LNG_MAX)
    locality: str | None = Field(default=None, max_length=120)
    fsq_place_id: str | None = Field(default=None, max_length=64)


class StoresIn(BaseModel):
    stores: list[StoreIn] = Field(max_length=MAX_STORES)


class SaveSiteIn(BaseModel):
    h3_id: str = Field(max_length=20)
    note: str | None = Field(default=None, max_length=500)


class NoteIn(BaseModel):
    note: str | None = Field(default=None, max_length=500)


class CompareIn(BaseModel):
    h3_ids: list[str] = Field(min_length=1, max_length=3)


# ─── Helpers ─────────────────────────────────────────────────────────────────


def brand_out(b: BrandRec) -> dict:
    return {
        "id": b.id,
        "name": b.name,
        "vertical": b.vertical,
        "description": b.description,
        "store_format": b.store_format,
        "store_count_band": b.store_count_band,
        "priorities": {k: int(b.priorities.get(k, 2)) for k in SIGNALS} if b.priorities else {k: 2 for k in SIGNALS},
        "weights": weights_from_priorities(b.priorities),
        "regions": b.regions or [],
        "onboarded": b.onboarded,
        "stores": [store_out(s) for s in b.stores],
    }


def store_out(s: StoreRec) -> dict:
    return {"id": s.id, "name": s.name, "lat": s.lat, "lng": s.lng,
            "locality": s.locality, "fsq_place_id": s.fsq_place_id}


def require_user_with_brand(user: UserRec = Depends(current_user)) -> UserRec:
    if user.brand is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Set up your brand first.")
    return user


def require_brand(user: UserRec = Depends(require_user_with_brand)) -> BrandRec:
    return user.brand  # type: ignore[return-value]


def parse_pri(pri: str | None) -> dict[str, int] | None:
    """A 'what if' set of priorities from the query string: 'demographic_match:4,transit_accessibility:1'."""
    if not pri:
        return None
    out: dict[str, int] = {}
    for part in pri.split(",")[:10]:
        k, _, v = part.partition(":")
        if k in SIGNALS and v.isdigit() and 0 <= int(v) <= 4:
            out[k] = int(v)
    return out or None


def profile_for(b: BrandRec, priorities: dict[str, int] | None = None) -> Profile:
    """The brand's scoring profile; `priorities` overrides the saved ones (an AI scenario)."""
    return Profile(
        vertical=b.vertical,
        weights=weights_from_priorities(priorities or b.priorities),
        stores=tuple(ScoreStore(s.lat, s.lng, s.fsq_place_id) for s in b.stores),
        regions=tuple(b.regions or ()),
    )


def _valid_cell(h3_id: str) -> str:
    if not h3.is_valid_cell(h3_id):
        raise HTTPException(422, "Invalid site id.")
    return h3_id


# ─── Reference data (public, cacheable) ──────────────────────────────────────


@router.get("/meta")
def meta() -> dict:
    cfg = get_config()
    return {
        "verticals": [
            {"key": k, "label": v["label"], "blurb": v.get("blurb", ""),
             "competitors": v["competitors"], "anchors": v["anchors"], "complementary": v["complementary"]}
            for k, v in cfg["verticals"].items()
        ],
        "regions": [{"key": k, **v} for k, v in cfg.get("regions", {}).items()],
        "signals": [{"key": k, **SIGNAL_INFO[k]} for k in SIGNALS],
    }


@router.get("/signals/{vertical}")
def signals(vertical: str, response: Response) -> dict:
    """Raw per-zone signals for one category, the same for every user. The browser applies
    each brand's weights and store spacing itself, so the map costs the server nothing per user.
    Columnar to keep it small; cached by browsers and Google's edge for a day."""
    if vertical not in get_config()["verticals"]:
        raise HTTPException(404, "Unknown category.")
    sig = vertical_signals(vertical)
    localities: dict[str, int] = {}
    loc_idx = [localities.setdefault(s.locality or "", len(localities)) for s in sig]
    names: dict[str, int] = {}
    nm = lambda v: -1 if not v else names.setdefault(v, len(names))  # noqa: E731
    rnd = lambda v: -1 if v is None else round(v, 1)  # noqa: E731
    anchor_idx = [nm(s.anchor_name) for s in sig]
    transit_idx = [nm(s.transit_name) for s in sig]  # fill `names` before it is listed below
    response.headers["Cache-Control"] = "public, max-age=86400"
    return {
        "vertical": vertical,
        "params": {k: PARAMS[k] for k in ("competitor_radius_m", "cannibal_zero_m", "cannibal_full_score_m", "ranking_min_spacing_m")},
        "curves": CURVES,
        "localities": list(localities),
        "names": list(names),
        "h3": [s.h3_id for s in sig],
        "lat": [round(s.lat, 6) for s in sig],
        "lng": [round(s.lng, 6) for s in sig],
        "loc": loc_idx,
        "comp": [s.n_competitors for s in sig],
        "compl": [s.n_complementary for s in sig],
        "retail": [s.n_retail for s in sig],
        "anchor_m": [rnd(s.d_anchor_m) for s in sig],
        "anchor": anchor_idx,
        "transit_m": [rnd(s.d_transit_m) for s in sig],
        "transit": transit_idx,
    }


# ─── Brand profile ───────────────────────────────────────────────────────────


@router.get("/brand")
def get_brand(brand: BrandRec = Depends(require_brand)) -> dict:
    return brand_out(brand)


@router.put("/brand")
def put_brand(body: BrandIn, user: UserRec = Depends(current_user), repo: Repo = Depends(get_repo)) -> dict:
    stores = user.brand.stores if user.brand else []
    b = BrandRec(
        name=body.name.strip(), vertical=body.vertical,
        description=(body.description or "").strip() or None,
        store_format=body.store_format, store_count_band=body.store_count_band,
        priorities={k: body.priorities.get(k, 2) for k in SIGNALS}, regions=body.regions,
        onboarded=body.onboarded if body.onboarded is not None else bool(user.brand and user.brand.onboarded),
        stores=stores,
    )
    return brand_out(repo.save_brand(user.id, b))


# ─── Own stores ──────────────────────────────────────────────────────────────


@router.get("/places/search")
def search_places(q: str = Query(min_length=2, max_length=60), _user: UserRec = Depends(current_user)) -> dict:
    """Find places by name, used to pick the brand's existing stores."""
    pattern = "%" + q.strip().lower().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
    rows = get_con().execute(
        """
        SELECT fsq_place_id, name, latitude, longitude, locality, primary_category, address
        FROM pois
        WHERE LOWER(name) LIKE ? ESCAPE '\\'
        ORDER BY name, locality
        LIMIT 60
        """,
        [pattern],
    ).fetchall()
    return {"places": [
        {"fsq_place_id": r[0], "name": r[1], "lat": r[2], "lng": r[3],
         "locality": r[4], "primary_category": r[5], "address": r[6]}
        for r in rows
    ]}


@router.put("/brand/stores")
def put_stores(body: StoresIn, user: UserRec = Depends(require_user_with_brand), repo: Repo = Depends(get_repo)) -> dict:
    b = user.brand
    b.stores = [StoreRec(name=s.name.strip(), lat=s.lat, lng=s.lng, locality=s.locality, fsq_place_id=s.fsq_place_id)
                for s in body.stores]
    return brand_out(repo.save_brand(user.id, b))


# ─── Personalised map + rankings (kept for the AI and older clients) ─────────


@router.get("/heatmap")
def heatmap(pri: str | None = Query(None, max_length=200), brand: BrandRec = Depends(require_brand)) -> dict:
    scores = score_profile(profile_for(brand, parse_pri(pri)))
    return {"vertical": brand.vertical, "count": len(scores), "hexes": [hex_to_dict(h) for h in scores]}


@router.get("/rankings")
def rankings(limit: int = Query(20, ge=1, le=50),
             region: list[str] | None = Query(None),
             pri: str | None = Query(None, max_length=200),
             brand: BrandRec = Depends(require_brand)) -> dict:
    known = get_config().get("regions", {})
    regions = tuple(r for r in (region or []) if r in known) if region is not None else None
    sites = rank_sites(profile_for(brand, parse_pri(pri)), limit=limit, region_keys=regions)
    return {"sites": sites, "regions": list(regions if regions is not None else brand.regions or [])}


@router.get("/report/{h3_id}")
def report(h3_id: str, pri: str | None = Query(None, max_length=200),
           user: UserRec = Depends(require_user_with_brand), repo: Repo = Depends(get_repo)) -> dict:
    rep = hex_report(profile_for(user.brand, parse_pri(pri)), _valid_cell(h3_id))
    saved = repo.get_saved(user.id, h3_id)
    rep["saved"] = saved_out(saved) if saved else None
    return rep


@router.post("/compare")
def compare(body: CompareIn, brand: BrandRec = Depends(require_brand)) -> dict:
    prof = profile_for(brand)
    return {"reports": [hex_report(prof, _valid_cell(h)) for h in dict.fromkeys(body.h3_ids)]}


@router.get("/pins")
def pins(min_lat: float = Query(ge=-90, le=90), max_lat: float = Query(ge=-90, le=90),
         min_lng: float = Query(ge=-180, le=180), max_lng: float = Query(ge=-180, le=180),
         limit: int = Query(400, ge=1, le=800),
         brand: BrandRec = Depends(require_brand)) -> dict:
    from .scoring import _category_tag_cte

    rows = get_con().execute(
        f"""
        WITH {_category_tag_cte(brand.vertical)}
        SELECT fsq_place_id, name, primary_category, latitude, longitude, locality,
               is_competitor, is_complementary, is_anchor, is_transit
        FROM tagged
        WHERE latitude BETWEEN ? AND ? AND longitude BETWEEN ? AND ?
          AND (is_competitor OR is_complementary OR is_anchor OR is_transit)
        LIMIT ?
        """,
        [min_lat, max_lat, min_lng, max_lng, limit],
    ).fetchall()
    own_ids = {s.fsq_place_id for s in brand.stores if s.fsq_place_id}
    cols = ["fsq_place_id", "name", "primary_category", "latitude", "longitude", "locality",
            "is_competitor", "is_complementary", "is_anchor", "is_transit"]
    return {"pins": [d for d in (dict(zip(cols, r)) for r in rows) if d["fsq_place_id"] not in own_ids]}


# ─── Shortlist ───────────────────────────────────────────────────────────────


def saved_out(s: SavedRec) -> dict:
    return {"id": s.h3_id, "h3_id": s.h3_id, "locality": s.locality, "lat": s.lat, "lng": s.lng,
            "score_at_save": s.score_at_save, "note": s.note, "created_at": s.created_at.isoformat()}


@router.get("/shortlist")
def list_saved(user: UserRec = Depends(require_user_with_brand), repo: Repo = Depends(get_repo)) -> dict:
    saved = repo.list_saved(user.id)
    if not saved:
        return {"sites": []}
    current = {h.h3_id: h.score for h in score_profile(profile_for(user.brand))}
    return {"sites": [{**saved_out(s), "score": current.get(s.h3_id, s.score_at_save)} for s in saved]}


def save_site_for(user: UserRec, repo: Repo, h3_id: str, note: str | None = None,
                  priorities: dict[str, int] | None = None) -> SavedRec:
    existing = repo.get_saved(user.id, h3_id)
    if existing:
        return existing
    if repo.count_saved(user.id) >= MAX_SAVED:
        raise HTTPException(status.HTTP_409_CONFLICT, f"Your shortlist is full ({MAX_SAVED} sites).")
    hit = next((h for h in score_profile(profile_for(user.brand, priorities)) if h.h3_id == h3_id), None)
    lat, lng = (hit.lat, hit.lng) if hit else h3.cell_to_latlng(h3_id)
    return repo.add_saved(user.id, SavedRec(h3_id=h3_id, lat=lat, lng=lng, score_at_save=hit.score if hit else 0,
                                            locality=hit.locality if hit else None, note=(note or "").strip() or None))


@router.post("/shortlist", status_code=201)
def save_site(body: SaveSiteIn, user: UserRec = Depends(require_user_with_brand), repo: Repo = Depends(get_repo)) -> dict:
    return saved_out(save_site_for(user, repo, _valid_cell(body.h3_id), body.note))


@router.patch("/shortlist/{site_id}")
def update_saved(site_id: str, body: NoteIn, user: UserRec = Depends(require_user_with_brand),
                 repo: Repo = Depends(get_repo)) -> dict:
    s = repo.update_saved_note(user.id, site_id, (body.note or "").strip() or None)
    if s is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not found.")
    return saved_out(s)


@router.delete("/shortlist/{site_id}", status_code=204)
def delete_saved(site_id: str, user: UserRec = Depends(require_user_with_brand), repo: Repo = Depends(get_repo)) -> None:
    if not repo.delete_saved(user.id, site_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not found.")
