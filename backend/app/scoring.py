"""Scoring engine. 5 signals, all from Foursquare data.

Two layers, so per-brand personalisation stays cheap:

1. ``vertical_signals(vertical)`` — the expensive spatial pass. For every H3
   res-9 cell it counts competitors / complementary venues / retail nearby and
   measures distance to the nearest anchor and transit stop. Depends only on
   the vertical, so it is computed once per vertical and cached.

2. ``score_profile(profile)`` — applies one brand's weights and its own store
   locations (cannibalisation) in Python. Milliseconds, cached in a small LRU.

Signal keys (stable API names) and what they mean to an operator:
  - surrounding_amenities  near unis, malls, offices, hospitals + complementary venues
  - transit_accessibility  close to train / metro / bus
  - demographic_match      busy streets (retail + F&B density as a foot-traffic proxy)
  - market_saturation      few direct competitors within 500 m
  - cannibalisation        far from the brand's own stores
"""

from __future__ import annotations

import math
import threading
from collections import OrderedDict
from dataclasses import dataclass, field, replace

import h3

from .db import get_con, get_config, get_vertical

WEIGHTS: dict[str, float] = {
    "market_saturation":      5,
    "cannibalisation":        5,
    "surrounding_amenities": 40,
    "transit_accessibility": 30,
    "demographic_match":     20,
}
SIGNALS = tuple(WEIGHTS)

# Scoring tuning parameters — tunable without code changes elsewhere
PARAMS = {
    "competitor_radius_m":    500,
    "complementary_radius_m": 300,
    "foot_traffic_radius_m":  300,
    # Normalization: at these values a signal hits score 0 or 100
    "competitor_saturation":   8,      # 8+ competitors -> score 0
    "anchor_full_score_m":     400,    # <=400m to anchor -> score 100
    "anchor_zero_m":          2500,    # >=2500m to anchor -> score 0
    "foot_traffic_saturation": 40,     # 40+ retail/F&B POIs nearby -> score 100
    "transit_full_score_m":    300,
    "transit_zero_m":         1500,
    "cannibal_full_score_m":  1500,    # >=1500m from own store -> score 100
    "cannibal_zero_m":         200,    # <=200m -> score 0
    "ranking_min_spacing_m":   900,    # ranked sites are at least this far apart
}

# Importance (0–4 from onboarding) -> relative weight multiplier
IMPORTANCE_MULTIPLIER = {0: 0.0, 1: 1.0, 2: 2.0, 3: 3.5, 4: 5.0}


# ─── Data types ──────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class HexSignals:
    h3_id: str
    lat: float
    lng: float
    locality: str | None
    region: str | None
    postcode: str | None
    n_competitors: int
    n_complementary: int
    n_retail: int
    d_anchor_m: float | None
    d_transit_m: float | None
    anchor_name: str | None = None
    transit_name: str | None = None


@dataclass
class HexScore:
    h3_id: str
    lat: float
    lng: float
    locality: str | None
    score: int
    components: dict[str, int]
    signals_raw: dict[str, float | int | None]
    region: str | None = None
    postcode: str | None = None


@dataclass(frozen=True)
class Store:
    lat: float
    lng: float
    fsq_place_id: str | None = None


@dataclass
class Profile:
    """Everything that personalises a score. Built from a brand row."""

    vertical: str
    weights: dict[str, float] = field(default_factory=lambda: dict(WEIGHTS))
    stores: tuple[Store, ...] = ()
    regions: tuple[str, ...] = ()

    def cache_key(self) -> tuple:
        return (
            self.vertical,
            tuple(round(self.weights.get(k, 0.0), 2) for k in SIGNALS),
            tuple(sorted((round(s.lat, 5), round(s.lng, 5)) for s in self.stores)),
        )


def weights_from_priorities(priorities: dict[str, int] | None) -> dict[str, float]:
    """Turn 0–4 importance ratings into weights that sum to 100."""
    if not priorities:
        return dict(WEIGHTS)
    raw = {
        k: IMPORTANCE_MULTIPLIER.get(int(priorities.get(k, 2)), 2.0) for k in SIGNALS
    }
    total = sum(raw.values())
    if total <= 0:
        return dict(WEIGHTS)
    return {k: round(v / total * 100, 1) for k, v in raw.items()}


# ─── Geometry helpers ────────────────────────────────────────────────────────


def haversine_m(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = p2 - p1
    dl = math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * 6371000 * math.asin(math.sqrt(a))


def _haversine_sql(a_lat: str, a_lng: str, b_lat: str, b_lng: str) -> str:
    return f"""
    (2 * 6371000 * ASIN(SQRT(
      POWER(SIN(RADIANS({b_lat} - {a_lat}) / 2), 2) +
      COS(RADIANS({a_lat})) * COS(RADIANS({b_lat})) *
      POWER(SIN(RADIANS({b_lng} - {a_lng}) / 2), 2)
    )))
    """


class _StoreGrid:
    """Bucket stores into ~2 km cells so nearest-store lookup is O(1)-ish."""

    CELL = 0.02  # degrees

    def __init__(self, stores: tuple[Store, ...]):
        self.cells: dict[tuple[int, int], list[Store]] = {}
        for s in stores:
            self.cells.setdefault(self._key(s.lat, s.lng), []).append(s)

    def _key(self, lat: float, lng: float) -> tuple[int, int]:
        return (math.floor(lat / self.CELL), math.floor(lng / self.CELL))

    def count_in_poi_data_within(self, lat: float, lng: float, radius_m: float) -> int:
        """Own stores that are also POIs (picked from the dataset) within radius."""
        if not self.cells:
            return 0
        ky, kx = self._key(lat, lng)
        n = 0
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                for s in self.cells.get((ky + dy, kx + dx), ()):
                    if s.fsq_place_id and haversine_m(lat, lng, s.lat, s.lng) <= radius_m:
                        n += 1
        return n

    def nearest_m(self, lat: float, lng: float) -> float | None:
        """Nearest store within ~2 km (beyond that cannibalisation is maxed anyway)."""
        if not self.cells:
            return None
        ky, kx = self._key(lat, lng)
        best: float | None = None
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                for s in self.cells.get((ky + dy, kx + dx), ()):
                    d = haversine_m(lat, lng, s.lat, s.lng)
                    if best is None or d < best:
                        best = d
        return best


# ─── SQL helpers ─────────────────────────────────────────────────────────────


def _match_any_clause(labels: list[str], alias: str = "primary_category") -> str:
    """SQL clause matching trimmed column against config labels (trusted input)."""
    if not labels:
        return "FALSE"
    quoted = ", ".join("'" + l.lower().replace("'", "''") + "'" for l in labels)
    return f"(LOWER(TRIM({alias})) IN ({quoted}))"


def _category_tag_cte(vertical_key: str) -> str:
    """CTE that tags every POI with booleans used by the scorer."""
    v = get_vertical(vertical_key)
    cfg = get_config()
    return f"""
    tagged AS (
      SELECT
        fsq_place_id, name, latitude, longitude, locality, region, postcode,
        primary_category, brand_slug, h3_9,
        {_match_any_clause(v["competitors"])}   AS is_competitor,
        {_match_any_clause(v["complementary"])} AS is_complementary,
        {_match_any_clause(v["anchors"])}       AS is_anchor,
        {_match_any_clause(cfg.get("transit_categories", []))}    AS is_transit,
        {_match_any_clause(cfg.get("retail_fnb_categories", []))} AS is_retail_fnb
      FROM pois
    )
    """


# ─── Layer 1: per-vertical spatial signals (expensive, cached) ───────────────

_signals_cache: dict[str, list[HexSignals]] = {}
_signals_lock = threading.Lock()


def vertical_signals(vertical_key: str) -> list[HexSignals]:
    get_vertical(vertical_key)  # raises KeyError for unknown verticals
    hit = _signals_cache.get(vertical_key)
    if hit is not None:
        return hit
    with _signals_lock:
        hit = _signals_cache.get(vertical_key)
        if hit is None:
            hit = _compute_vertical_signals(vertical_key)
            _signals_cache[vertical_key] = hit
    return hit


def _compute_vertical_signals(vertical_key: str) -> list[HexSignals]:
    con = get_con()
    tagged = _category_tag_cte(vertical_key)
    p = PARAMS
    d_sql = _haversine_sql("c.lat", "c.lng", "t.latitude", "t.longitude")
    # bbox half-widths in degrees (Sydney ~ -33.9°: 1° lat ≈ 111 km, 1° lng ≈ 92 km)
    near_lat, near_lng = 0.0055, 0.0065
    anc_lat, anc_lng = 0.025, 0.030
    tr_lat, tr_lng = 0.0145, 0.0175

    sql = f"""
    WITH {tagged},
    cells AS (
      SELECT
        h3_9,
        AVG(latitude)  AS lat,
        AVG(longitude) AS lng,
        MODE() WITHIN GROUP (ORDER BY locality) AS locality,
        MODE() WITHIN GROUP (ORDER BY region)   AS region,
        MODE() WITHIN GROUP (ORDER BY postcode) AS postcode
      FROM tagged
      WHERE h3_9 IS NOT NULL
      GROUP BY h3_9
    ),
    near_pts AS (
      SELECT latitude, longitude, is_competitor, is_complementary, is_retail_fnb
      FROM tagged WHERE is_competitor OR is_complementary OR is_retail_fnb
    ),
    near AS (
      SELECT h3_9,
        COUNT(*) FILTER (WHERE is_competitor    AND d <= {p["competitor_radius_m"]})    AS n_competitors,
        COUNT(*) FILTER (WHERE is_complementary AND d <= {p["complementary_radius_m"]}) AS n_complementary,
        COUNT(*) FILTER (WHERE is_retail_fnb    AND d <= {p["foot_traffic_radius_m"]})  AS n_retail
      FROM (
        SELECT c.h3_9, t.is_competitor, t.is_complementary, t.is_retail_fnb, {d_sql} AS d
        FROM cells c JOIN near_pts t
          ON t.latitude  BETWEEN c.lat - {near_lat} AND c.lat + {near_lat}
         AND t.longitude BETWEEN c.lng - {near_lng} AND c.lng + {near_lng}
      ) GROUP BY h3_9
    ),
    anchor AS (
      SELECT c.h3_9, MIN({d_sql}) AS d_anchor_m, ARG_MIN(t.name, {d_sql}) AS anchor_name
      FROM cells c JOIN (SELECT latitude, longitude, name FROM tagged WHERE is_anchor) t
        ON t.latitude  BETWEEN c.lat - {anc_lat} AND c.lat + {anc_lat}
       AND t.longitude BETWEEN c.lng - {anc_lng} AND c.lng + {anc_lng}
      GROUP BY c.h3_9
    ),
    transit AS (
      SELECT c.h3_9, MIN({d_sql}) AS d_transit_m, ARG_MIN(t.name, {d_sql}) AS transit_name
      FROM cells c JOIN (SELECT latitude, longitude, name FROM tagged WHERE is_transit) t
        ON t.latitude  BETWEEN c.lat - {tr_lat} AND c.lat + {tr_lat}
       AND t.longitude BETWEEN c.lng - {tr_lng} AND c.lng + {tr_lng}
      GROUP BY c.h3_9
    )
    SELECT c.h3_9, c.lat, c.lng, c.locality, c.region, c.postcode,
           COALESCE(n.n_competitors, 0), COALESCE(n.n_complementary, 0), COALESCE(n.n_retail, 0),
           a.d_anchor_m, tr.d_transit_m, a.anchor_name, tr.transit_name
    FROM cells c
    LEFT JOIN near n    USING (h3_9)
    LEFT JOIN anchor a  USING (h3_9)
    LEFT JOIN transit tr USING (h3_9)
    ORDER BY c.h3_9
    """
    rows = con.execute(sql).fetchall()
    return [
        HexSignals(
            h3_id=r[0], lat=float(r[1]), lng=float(r[2]),
            locality=r[3], region=r[4], postcode=r[5],
            n_competitors=int(r[6]), n_complementary=int(r[7]), n_retail=int(r[8]),
            d_anchor_m=float(r[9]) if r[9] is not None else None,
            d_transit_m=float(r[10]) if r[10] is not None else None,
            anchor_name=r[11], transit_name=r[12],
        )
        for r in rows
    ]


def warm_cache() -> None:
    """Precompute signals for every vertical (call at startup, off the request path)."""
    for key in get_config()["verticals"]:
        vertical_signals(key)


# ─── Normalizers ─────────────────────────────────────────────────────────────


def _lerp_clamp(value: float, at_zero: float, at_hundred: float) -> float:
    """Linear 0-100, clamped. Works both directions (at_zero can be > at_hundred)."""
    if at_zero == at_hundred:
        return 100.0 if value == at_zero else 0.0
    t = (value - at_zero) / (at_hundred - at_zero)
    return max(0.0, min(100.0, t * 100.0))


# Smooth curves, calibrated on the 2026-10-15 Sydney release: no signal hits 100
# until a zone is genuinely exceptional, so the best areas still separate.
#   transit  100*e^(-d/600):  90 m -> 86, 300 m -> 61, 700 m -> 31
#   anchor   100*e^(-d/700):  80 m -> 89, 360 m -> 60, 630 m -> 41
#   retail   100*(1-e^(-n/20)): 12 -> 45, 25 -> 71, 60 -> 95
#   complementary 100*(1-e^(-n/6)): 4 -> 49, 8 -> 74, 15 -> 92
#   competitors 100*e^(-n/2.5): 0 -> 100, 1 -> 67, 3 -> 30, 8 -> 4
CURVES = {"transit_m": 600.0, "anchor_m": 700.0, "retail_n": 20.0, "complementary_n": 6.0, "competitor_n": 2.5}


def _components(s: HexSignals, d_cannibal: float | None) -> dict[str, int]:
    p = PARAMS
    c = CURVES
    s_anchor = 0.0 if s.d_anchor_m is None else 100 * math.exp(-s.d_anchor_m / c["anchor_m"])
    s_comp = 100 * (1 - math.exp(-s.n_complementary / c["complementary_n"]))
    return {
        "market_saturation": round(100 * math.exp(-s.n_competitors / c["competitor_n"])),
        "cannibalisation": 100 if d_cannibal is None
        else round(_lerp_clamp(d_cannibal, p["cannibal_zero_m"], p["cannibal_full_score_m"])),
        "surrounding_amenities": round(s_anchor * 0.6 + s_comp * 0.4),
        "transit_accessibility": 0 if s.d_transit_m is None
        else round(100 * math.exp(-s.d_transit_m / c["transit_m"])),
        "demographic_match": round(100 * (1 - math.exp(-s.n_retail / c["retail_n"]))),
    }


# ─── Layer 2: per-profile scoring (cheap, LRU-cached) ────────────────────────

_SCORE_CACHE_SIZE = 64
_score_cache: "OrderedDict[tuple, list[HexScore]]" = OrderedDict()
_score_lock = threading.Lock()


def score_profile(profile: Profile) -> list[HexScore]:
    key = profile.cache_key()
    with _score_lock:
        if key in _score_cache:
            _score_cache.move_to_end(key)
            return _score_cache[key]
    result = _score_profile_impl(profile)
    with _score_lock:
        _score_cache[key] = result
        _score_cache.move_to_end(key)
        while len(_score_cache) > _SCORE_CACHE_SIZE:
            _score_cache.popitem(last=False)
    return result


def _score_profile_impl(profile: Profile) -> list[HexScore]:
    signals = vertical_signals(profile.vertical)
    grid = _StoreGrid(profile.stores)
    weights = profile.weights or WEIGHTS
    wsum = sum(weights.get(k, 0.0) for k in SIGNALS) or 1.0
    out: list[HexScore] = []
    radius = PARAMS["competitor_radius_m"]
    for s in signals:
        d_cannibal = grid.nearest_m(s.lat, s.lng)
        # The brand's own stores sit in the same category; they are handled by
        # cannibalisation, so don't also count them as competitors.
        own_nearby = grid.count_in_poi_data_within(s.lat, s.lng, radius)
        if own_nearby:
            s = replace(s, n_competitors=max(0, s.n_competitors - own_nearby))
        comps = _components(s, d_cannibal)
        total = round(sum(comps[k] * weights.get(k, 0.0) for k in SIGNALS) / wsum)
        out.append(HexScore(
            h3_id=s.h3_id, lat=s.lat, lng=s.lng, locality=s.locality,
            region=s.region, postcode=s.postcode, score=int(total), components=comps,
            signals_raw={
                "n_competitors": s.n_competitors,
                "n_complementary": s.n_complementary,
                "n_retail": s.n_retail,
                "d_anchor_m": s.d_anchor_m,
                "d_transit_m": s.d_transit_m,
                "anchor_name": s.anchor_name,
                "transit_name": s.transit_name,
                "d_cannibal_m": d_cannibal,
            },
        ))
    return out


# ─── Regions + rankings ──────────────────────────────────────────────────────


def regions() -> dict[str, dict]:
    return get_config().get("regions", {})


def in_regions(lat: float, lng: float, region_keys: tuple[str, ...] | list[str]) -> bool:
    if not region_keys:
        return True
    regs = regions()
    for k in region_keys:
        r = regs.get(k)
        if r and haversine_m(lat, lng, r["lat"], r["lng"]) <= r["radius_km"] * 1000:
            return True
    return False


SIGNAL_PHRASES = {
    "surrounding_amenities": "close to the places your customers already go",
    "transit_accessibility": "an easy walk from public transport",
    "demographic_match": "a busy, walkable retail strip",
    "market_saturation": "few direct competitors nearby",
    "cannibalisation": "well clear of your own stores",
}


def _fmt_m(m: float | None) -> str:
    if m is None:
        return "—"
    return f"{round(m)} m" if m < 1000 else f"{m / 1000:.1f} km"


def _short(name: str | None, n: int = 36) -> str | None:
    if not name:
        return name
    import re
    if re.search(r"\d{5,}", name):  # stop codes like "Bus Stop 201063" mean nothing to a reader
        return "A bus stop" if "bus" in name.lower() else None
    return name if len(name) <= n else name[: n - 1].rstrip(" ,-") + "…"


def explain(h: HexScore, weights: dict[str, float]) -> dict:
    """Plain-English reasons + risks for one site, ordered by weighted impact."""
    contrib = sorted(SIGNALS, key=lambda k: h.components[k] * weights.get(k, 0), reverse=True)
    raw = h.signals_raw
    reasons: list[str] = []
    for k in contrib:
        if h.components[k] < 60 or weights.get(k, 0) <= 0:
            continue
        if k == "transit_accessibility" and raw["d_transit_m"] is not None:
            reasons.append(f"{_short(raw.get('transit_name')) or 'A train or bus stop'} is {_fmt_m(raw['d_transit_m'])} away")
        elif k == "surrounding_amenities" and raw["d_anchor_m"] is not None:
            reasons.append(f"Near {_short(raw['anchor_name'])}, {_fmt_m(raw['d_anchor_m'])} away" if raw.get("anchor_name") else f"A uni, mall, office or hospital {_fmt_m(raw['d_anchor_m'])} away")
        elif k == "demographic_match":
            reasons.append(f"Busy street: {raw['n_retail']} shops and venues a short walk away")
        elif k == "market_saturation":
            n = raw["n_competitors"]
            reasons.append("No competitors within a 6-minute walk" if n == 0 else f"Only {n} competitor{'s' if n != 1 else ''} within a 6-minute walk")
        elif k == "cannibalisation":
            d = raw["d_cannibal_m"]
            if d is not None:
                reasons.append(f"Your nearest store is {_fmt_m(d)} away")
        if len(reasons) == 3:
            break
    risks: list[str] = []
    if raw["n_competitors"] >= 4:
        risks.append(f"{raw['n_competitors']} competitors within a 6-minute walk")
    if raw["d_cannibal_m"] is not None and raw["d_cannibal_m"] < 800:
        risks.append(f"Your own store is only {_fmt_m(raw['d_cannibal_m'])} away")
    if raw["d_transit_m"] is None or raw["d_transit_m"] > 1200:
        risks.append("Hard to reach by train or bus")
    return {"reasons": reasons, "risks": risks}


def rank_sites(profile: Profile, limit: int = 20, region_keys: tuple[str, ...] | None = None) -> list[dict]:
    """Top sites for a profile: best-first, de-duplicated so picks are spread out."""
    scores = score_profile(profile)
    region_keys = profile.regions if region_keys is None else region_keys
    pool = sorted(
        (h for h in scores if in_regions(h.lat, h.lng, region_keys)),
        key=lambda h: (h.score, h.components["market_saturation"]),
        reverse=True,
    )
    picked: list[HexScore] = []
    spacing = PARAMS["ranking_min_spacing_m"]
    for h in pool:
        if all(haversine_m(h.lat, h.lng, p.lat, p.lng) >= spacing for p in picked):
            picked.append(h)
            if len(picked) >= limit:
                break
    return [
        {**hex_to_dict(h), "rank": i + 1, **explain(h, profile.weights)}
        for i, h in enumerate(picked)
    ]


def hex_to_dict(h: HexScore) -> dict:
    return {
        "h3_id": h.h3_id,
        "lat": h.lat,
        "lng": h.lng,
        "locality": h.locality,
        "score": h.score,
        "components": h.components,
        "n_competitors": h.signals_raw["n_competitors"],
        "n_complementary": h.signals_raw["n_complementary"],
    }


# ─── Diversity index ─────────────────────────────────────────────────────────


def _compute_diversity(con, lat: float, lng: float, radius_m: int = 300) -> float:
    """Normalised Shannon diversity (0–1) of POI categories within radius."""
    # lat/lng are server-side floats (never user text) so inlining them is safe
    dist_sql = _haversine_sql(repr(float(lat)), repr(float(lng)), "latitude", "longitude")
    rows = con.execute(
        f"""
        SELECT primary_category, COUNT(*) FROM pois
        WHERE primary_category IS NOT NULL
          AND latitude BETWEEN ? AND ? AND longitude BETWEEN ? AND ?
          AND {dist_sql} <= ?
        GROUP BY primary_category
        """,
        [lat - 0.005, lat + 0.005, lng - 0.006, lng + 0.006, radius_m],
    ).fetchall()
    total = sum(r[1] for r in rows)
    if total <= 1:
        return 0.0
    h_prime = -sum((c / total) * math.log(c / total) for _, c in rows if c)
    h_max = math.log(len(rows)) if len(rows) > 1 else 1.0
    return round(min(h_prime / h_max, 1.0), 2)


# ─── Site summary (deterministic, no LLM) ────────────────────────────────────


def _site_summary(h: HexScore, competitors: list[dict], anchors: list[dict],
                  complementary: list[dict], transit: list[dict], diversity: float) -> str:
    area = h.locality or "This area"
    raw = h.signals_raw
    if h.score >= 80:
        lead = f"**{area} is a strong fit at {h.score}/100.**"
    elif h.score >= 65:
        lead = f"**{area} is a good fit at {h.score}/100**, with a trade-off or two to check on the ground."
    elif h.score >= 50:
        lead = f"**{area} scores {h.score}/100.** Workable, but it needs a reason beyond the numbers."
    else:
        lead = f"**{area} scores {h.score}/100.** The basics are against it for your brand."
    parts = [lead]

    n = raw["n_competitors"]
    if n == 0:
        parts.append("- **Competition:** none of your direct competitors within 500 m.")
    else:
        near = f", the closest is {competitors[0]['name']} at {_fmt_m(competitors[0]['dist_m'])}" if competitors else ""
        parts.append(f"- **Competition:** {n} within 500 m{near}.")

    d = raw["d_cannibal_m"]
    if d is None:
        parts.append("- **Your network:** none of your stores close by.")
    else:
        parts.append(f"- **Your network:** your nearest store is {_fmt_m(d)} away.")

    if anchors:
        a = anchors[0]
        parts.append(f"- **Draw:** {a['name']} is {_fmt_m(a['dist_m'])} away; {len(complementary)} complementary venues close by, category mix {diversity:.2f}/1.")
    else:
        parts.append(f"- **Draw:** no major anchor within 3 km; category mix {diversity:.2f}/1.")

    if transit:
        parts.append(f"- **Transit:** {transit[0]['name']} is {_fmt_m(transit[0]['dist_m'])} away.")
    else:
        parts.append("- **Transit:** no station or stop within 2 km, so expect mostly local and car trade.")
    return "\n".join(parts)


# ─── Per-hex report ──────────────────────────────────────────────────────────


def hex_report(profile: Profile, h3_id: str) -> dict:
    """Full report for one cell under one brand's profile."""
    if not h3.is_valid_cell(h3_id):
        raise KeyError(f"Invalid h3 cell: {h3_id}")
    con = get_con()
    tagged = _category_tag_cte(profile.vertical)
    all_scores = score_profile(profile)
    hit = next((s for s in all_scores if s.h3_id == h3_id), None)
    if hit is None:
        lat, lng = h3.cell_to_latlng(h3_id)
        hit = HexScore(
            h3_id=h3_id, lat=lat, lng=lng, locality=None, score=0,
            components={k: 0 for k in SIGNALS},
            signals_raw={"n_competitors": 0, "n_complementary": 0, "n_retail": 0,
                         "d_anchor_m": None, "d_transit_m": None, "d_cannibal_m": None},
        )
    lat, lng = hit.lat, hit.lng

    total = len(all_scores)
    higher = sum(1 for s in all_scores if s.score > hit.score)

    dist_sql = _haversine_sql(repr(float(lat)), repr(float(lng)), "latitude", "longitude")

    def nearest(flag_col: str, k: int, max_m: int = 2000) -> list[dict]:
        box = max_m / 111_000 * 1.25
        rows = con.execute(
            f"""
            WITH {tagged}
            SELECT name, primary_category, latitude, longitude, locality, dist_m, fsq_place_id FROM (
              SELECT *, {dist_sql} AS dist_m FROM tagged
              WHERE {flag_col}
                AND latitude BETWEEN ? AND ? AND longitude BETWEEN ? AND ?
            ) WHERE dist_m <= ? ORDER BY dist_m LIMIT ?
            """,
            [lat - box, lat + box, lng - box * 1.2, lng + box * 1.2, max_m, k],
        ).fetchall()
        return [
            {"name": r[0], "primary_category": r[1], "latitude": r[2], "longitude": r[3],
             "locality": r[4], "dist_m": round(float(r[5])), "fsq_place_id": r[6]}
            for r in rows if r[5] is not None
        ]

    own_ids = {st.fsq_place_id for st in profile.stores if st.fsq_place_id}
    if own_ids:
        competitors = [c for c in nearest("is_competitor", 5 + len(own_ids))
                       if c["fsq_place_id"] not in own_ids][:5]
    else:
        competitors = nearest("is_competitor", 5)
    complementary = nearest("is_complementary", 5)
    anchors = nearest("is_anchor", 3, max_m=3000)
    transit = nearest("is_transit", 2, max_m=2000)
    diversity = _compute_diversity(con, lat, lng)

    return {
        "h3_id": hit.h3_id,
        "lat": hit.lat,
        "lng": hit.lng,
        "locality": hit.locality,
        "region": hit.region,
        "postcode": hit.postcode,
        "score": hit.score,
        "rank": higher + 1 if total else None,
        "rank_total": total,
        "rank_pct": round(higher / total * 100) if total else None,
        "components": hit.components,
        "signals_raw": hit.signals_raw,
        "weights": profile.weights,
        "nearest_competitors": competitors,
        "nearest_complementary": complementary,
        "nearest_anchors": anchors,
        "nearest_transit": transit,
        "diversity_index": diversity,
        "summary": _site_summary(hit, competitors, anchors, complementary, transit, diversity),
        **explain(hit, profile.weights),
    }


# ─── Legacy helpers (used by the optional chat assistant) ────────────────────


def apply_scenario_weights(boost: list[str], suppress: list[str]) -> dict[str, float]:
    weights = {k: float(v) for k, v in WEIGHTS.items()}
    for k in boost:
        if k in weights:
            weights[k] *= 2.5
    for k in suppress:
        if k in weights:
            weights[k] *= 0.3
    total = sum(weights.values())
    return {k: round(v / total * 100, 1) for k, v in weights.items()}


def stores_from_brand_slug(brand_slug: str | None) -> tuple[Store, ...]:
    if not brand_slug:
        return ()
    rows = get_con().execute(
        "SELECT latitude, longitude, fsq_place_id FROM pois WHERE brand_slug LIKE ? || '%' LIMIT 500",
        [brand_slug.lower()],
    ).fetchall()
    return tuple(Store(float(r[0]), float(r[1]), r[2]) for r in rows)


def score_hexes(vertical_key: str, brand_slug: str | None = None,
                locality_filter: str | None = None,
                weight_overrides: dict[str, float] | None = None) -> list[HexScore]:
    prof = Profile(vertical=vertical_key, weights=weight_overrides or dict(WEIGHTS),
                   stores=stores_from_brand_slug(brand_slug))
    out = score_profile(prof)
    if locality_filter:
        q = locality_filter.lower()
        out = [h for h in out if h.locality and q in h.locality.lower()]
    return out
