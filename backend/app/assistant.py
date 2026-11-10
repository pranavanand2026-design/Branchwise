"""Branchwise assistant: Groq-hosted LLM with tools, plus a no-AI fallback.

The model never writes SQL or scores anything itself. It calls tools that run the
same scoring engine as the map, scoped to the signed-in user's brand:

  set_priorities     re-weight the scoring by intent (a what-if, not saved)
  set_areas          narrow the search to parts of Sydney (a what-if, not saved)
  find_best_areas    ranked areas under the current what-if
  search_places      look up places in the Foursquare data by name or category
  area_report        why one suburb fits or not
  save_to_shortlist  save an area to the user's shortlist

Every tool result is also returned to the browser as an "action", so the map can
follow along (fly to an area, show places as pins, show the what-if banner).

Provider: Groq's OpenAI-compatible API (GROQ_API_KEY). Without a key, or when Groq
is rate-limited or fails, a keyword-based fallback answers with the same tools.
"""

from __future__ import annotations

import json
import logging
import math
import os
import re
import threading
import time
from dataclasses import dataclass, field
from typing import Any

import h3
from sqlalchemy.orm import Session

from .db import get_con, get_config
from .scoring import (
    SIGNALS, Profile, hex_report, rank_sites, score_profile, weights_from_priorities,
)
from .storage import Brand, SavedSite

log = logging.getLogger("branchwise.assistant")

GROQ_BASE_URL = "https://api.groq.com/openai/v1"
# Tried in order; the first one this key can use wins. GROQ_MODEL overrides.
PREFERRED_MODELS = [
    "llama-3.3-70b-versatile",
    "openai/gpt-oss-120b",
    "moonshotai/kimi-k2-instruct",
    "meta-llama/llama-4-maverick-17b-128e-instruct",
    "meta-llama/llama-4-scout-17b-16e-instruct",
    "openai/gpt-oss-20b",
    "llama-3.1-8b-instant",
]
MAX_TOOL_ROUNDS = 5
MAX_HISTORY = 12

SIGNAL_TEXT = {
    "demographic_match": "busy streets (shops and venues nearby, a stand-in for foot traffic)",
    "surrounding_amenities": "being near unis, malls, offices and hospitals",
    "transit_accessibility": "being close to a train, metro or bus stop",
    "market_saturation": "few direct competitors within a 6-minute walk",
    "cannibalisation": "distance from the brand's own stores",
}
SIGNAL_SHORT = {
    "demographic_match": "Busy streets",
    "surrounding_amenities": "Near unis, malls and offices",
    "transit_accessibility": "Close to a station",
    "market_saturation": "Few competitors",
    "cannibalisation": "Away from my stores",
}


# ─── Provider ────────────────────────────────────────────────────────────────

_model_lock = threading.Lock()
_model_cache: dict[str, Any] = {"model": None, "checked": 0.0}


def groq_key() -> str | None:
    k = os.environ.get("GROQ_API_KEY", "").strip()
    return k or None


def _client():
    from openai import OpenAI

    return OpenAI(api_key=groq_key(), base_url=GROQ_BASE_URL, timeout=30, max_retries=1)


def resolve_model() -> str | None:
    """Pick a model this key can use (cached for an hour)."""
    forced = os.environ.get("GROQ_MODEL", "").strip()
    if forced:
        return forced
    if not groq_key():
        return None
    with _model_lock:
        if _model_cache["model"] and time.time() - _model_cache["checked"] < 3600:
            return _model_cache["model"]
        try:
            available = {m.id for m in _client().models.list().data}
        except Exception as e:  # network, auth
            log.warning("Groq model list failed: %s", e)
            return _model_cache["model"] or PREFERRED_MODELS[0]
        model = next((m for m in PREFERRED_MODELS if m in available), None)
        _model_cache.update(model=model, checked=time.time())
        return model


def provider_status() -> dict:
    return {"provider": "groq" if groq_key() else "offline", "model": resolve_model() if groq_key() else None}


# ─── Conversation state ──────────────────────────────────────────────────────


@dataclass
class Turn:
    brand: Brand
    db: Session
    priorities: dict[str, int] | None   # what-if priorities (None = saved profile)
    regions: list[str] | None           # what-if areas (None = saved profile)
    actions: list[dict] = field(default_factory=list)

    def effective_priorities(self) -> dict[str, int]:
        return self.priorities or dict(self.brand.priorities or {k: 2 for k in SIGNALS})

    def effective_regions(self) -> list[str]:
        return self.regions if self.regions is not None else list(self.brand.regions or [])

    def profile(self) -> Profile:
        from .brand import profile_for

        return profile_for(self.brand, self.effective_priorities())


# ─── Tools ───────────────────────────────────────────────────────────────────


def _regions() -> dict[str, dict]:
    return get_config().get("regions", {})


def _tool_schema() -> list[dict]:
    region_keys = list(_regions())
    return [
        {"type": "function", "function": {
            "name": "set_priorities",
            "description": "Re-weight the scoring to match what the user cares about. Pick the 1-3 signals that matter most; "
                           "the rest count a little. Use whenever the user describes customers, format or goals "
                           "(e.g. students -> surrounding_amenities; commuters -> transit_accessibility; walk-in trade -> "
                           "demographic_match; 'avoid competition' -> market_saturation). This is a what-if shown on the map, not saved.",
            "parameters": {"type": "object", "properties": {
                "top": {"type": "array", "items": {"type": "string", "enum": list(SIGNALS)}, "minItems": 1, "maxItems": 3},
            }, "required": ["top"]},
        }},
        {"type": "function", "function": {
            "name": "set_areas",
            "description": "Limit the search to parts of Sydney. Empty list means all of Sydney.",
            "parameters": {"type": "object", "properties": {
                "regions": {"type": "array", "items": {"type": "string", "enum": region_keys}},
            }, "required": ["regions"]},
        }},
        {"type": "function", "function": {
            "name": "find_best_areas",
            "description": "Rank the best areas for the brand under the current priorities and areas. Returns suburb, score out of 100 and reasons.",
            "parameters": {"type": "object", "properties": {
                "limit": {"type": "integer", "minimum": 1, "maximum": 8},
            }},
        }},
        {"type": "function", "function": {
            "name": "search_places",
            "description": "Look up real places in the Foursquare data. `query` is a business name or a category only "
                           "(e.g. 'Chatime', 'bubble tea', 'university', 'gym'), never a suburb. Use `suburb` to look in one suburb "
                           "or `region` for a wider area.",
            "parameters": {"type": "object", "properties": {
                "query": {"type": "string", "minLength": 2, "maxLength": 60},
                "suburb": {"type": "string", "maxLength": 60},
                "region": {"type": "string", "enum": region_keys},
                "limit": {"type": "integer", "minimum": 1, "maximum": 15},
            }, "required": ["query"]},
        }},
        {"type": "function", "function": {
            "name": "area_report",
            "description": "Explain how well one suburb fits the brand: score, reasons, risks, nearest competitors, anchors and transit.",
            "parameters": {"type": "object", "properties": {
                "suburb": {"type": "string", "minLength": 2, "maxLength": 60},
            }, "required": ["suburb"]},
        }},
        {"type": "function", "function": {
            "name": "save_to_shortlist",
            "description": "Save an area to the user's shortlist. Only when the user asks to save or shortlist it. "
                           "Use the h3_id returned by find_best_areas or area_report.",
            "parameters": {"type": "object", "properties": {
                "h3_id": {"type": "string"},
                "note": {"type": "string", "maxLength": 300},
            }, "required": ["h3_id"]},
        }},
    ]


def _site_brief(s: dict) -> dict:
    return {"h3_id": s["h3_id"], "suburb": s["locality"], "score": s["score"],
            "lat": round(s["lat"], 5), "lng": round(s["lng"], 5),
            "reasons": s.get("reasons", [])[:2], "risks": s.get("risks", [])[:2]}


def t_set_priorities(turn: Turn, top: list[str]) -> dict:
    top = [t for t in dict.fromkeys(top) if t in SIGNALS][:3]
    if not top:
        return {"error": "No valid signals."}
    turn.priorities = {k: (4 if k in top else 1) for k in SIGNALS}
    weights = weights_from_priorities(turn.priorities)
    turn.actions.append({"type": "scenario", "priorities": turn.priorities, "regions": turn.regions,
                         "label": ", ".join(SIGNAL_SHORT[t] for t in top)})
    return {"ok": True, "now_weighting": {SIGNAL_SHORT[k]: f"{round(v)}%" for k, v in weights.items()}}


def t_set_areas(turn: Turn, regions: list[str]) -> dict:
    regs = _regions()
    turn.regions = [r for r in dict.fromkeys(regions) if r in regs]
    turn.actions.append({"type": "scenario", "priorities": turn.priorities, "regions": turn.regions,
                         "label": ", ".join(regs[r]["label"] for r in turn.regions) or "All of Sydney"})
    return {"ok": True, "areas": [regs[r]["label"] for r in turn.regions] or ["All of Sydney"]}


def t_find_best_areas(turn: Turn, limit: int = 5) -> dict:
    limit = max(1, min(int(limit or 5), 8))
    sites = rank_sites(turn.profile(), limit=limit, region_keys=tuple(turn.effective_regions()))
    briefs = [_site_brief(s) for s in sites]
    turn.actions.append({"type": "sites", "sites": briefs})
    return {"areas": briefs}


def t_search_places(turn: Turn, query: str, region: str | None = None, limit: int = 8, suburb: str | None = None) -> dict:
    q = (query or "").strip()[:60]
    if len(q) < 2:
        return {"error": "Query too short."}
    limit = max(1, min(int(limit or 8), 15))
    pattern = "%" + q.lower().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
    params: list[Any] = [pattern, pattern]
    where = ""
    if suburb and suburb.strip():
        where += " AND LOWER(locality) = ?"
        params.append(suburb.strip().lower())
    reg = _regions().get(region or "")
    if reg:
        dlat = reg["radius_km"] / 110.574
        dlng = reg["radius_km"] / (111.32 * math.cos(math.radians(reg["lat"])))
        where += " AND latitude BETWEEN ? AND ? AND longitude BETWEEN ? AND ?"
        params += [reg["lat"] - dlat, reg["lat"] + dlat, reg["lng"] - dlng, reg["lng"] + dlng]
    rows = get_con().execute(
        f"""
        SELECT fsq_place_id, name, primary_category, locality, latitude, longitude
        FROM pois
        WHERE (LOWER(name) LIKE ? ESCAPE '\\' OR LOWER(primary_category) LIKE ? ESCAPE '\\') {where}
        LIMIT 200
        """,
        params,
    ).fetchall()
    places = [{"id": r[0], "name": r[1], "category": r[2], "suburb": r[3], "lat": r[4], "lng": r[5]} for r in rows]
    total = len(places)
    places = places[:limit]
    turn.actions.append({"type": "places", "query": q, "total": total, "places": places})
    return {"total_found": total, "places": [{k: p[k] for k in ("name", "category", "suburb")} for p in places]}


def t_area_report(turn: Turn, suburb: str) -> dict:
    name = (suburb or "").strip().lower()
    prof = turn.profile()
    cands = [h for h in score_profile(prof) if h.locality and h.locality.lower() == name] or \
            [h for h in score_profile(prof) if h.locality and name in h.locality.lower()]
    if not cands:
        return {"error": f"No scored zones found for '{suburb}'. Try a nearby suburb name."}
    best = max(cands, key=lambda h: h.score)
    rep = hex_report(prof, best.h3_id)
    out = {
        "h3_id": rep["h3_id"], "suburb": rep["locality"], "score": rep["score"],
        "rank": f"{rep['rank']} of {rep['rank_total']}", "reasons": rep["reasons"], "risks": rep["risks"],
        "nearest_competitors": [f"{c['name']} ({c['dist_m']} m)" for c in rep["nearest_competitors"][:3]],
        "anchors": [f"{a['name']} ({a['dist_m']} m)" for a in rep["nearest_anchors"][:2]],
        "transit": [f"{t['name']} ({t['dist_m']} m)" for t in rep["nearest_transit"][:1]],
        "zones_in_suburb": len(cands),
    }
    turn.actions.append({"type": "focus", "h3_id": rep["h3_id"], "lat": rep["lat"], "lng": rep["lng"],
                         "suburb": rep["locality"], "score": rep["score"]})
    return out


def t_save_to_shortlist(turn: Turn, h3_id: str, note: str | None = None) -> dict:
    if not h3.is_valid_cell(h3_id):
        return {"error": "Unknown area id."}
    existing = next((s for s in turn.brand.saved_sites if s.h3_id == h3_id), None)
    if existing:
        return {"ok": True, "already_saved": True}
    hit = next((h for h in score_profile(turn.profile()) if h.h3_id == h3_id), None)
    lat, lng = (hit.lat, hit.lng) if hit else h3.cell_to_latlng(h3_id)
    site = SavedSite(brand_id=turn.brand.id, h3_id=h3_id, locality=hit.locality if hit else None,
                     lat=lat, lng=lng, score_at_save=hit.score if hit else 0, note=(note or "").strip()[:300] or None)
    turn.db.add(site)
    turn.db.commit()
    turn.actions.append({"type": "saved", "h3_id": h3_id, "suburb": site.locality})
    return {"ok": True, "saved": site.locality}


TOOLS = {
    "set_priorities": t_set_priorities,
    "set_areas": t_set_areas,
    "find_best_areas": t_find_best_areas,
    "search_places": t_search_places,
    "area_report": t_area_report,
    "save_to_shortlist": t_save_to_shortlist,
}


def _run_tool(turn: Turn, name: str, args: dict) -> dict:
    fn = TOOLS.get(name)
    if fn is None:
        return {"error": f"Unknown tool {name}"}
    try:
        return fn(turn, **{k: v for k, v in args.items() if k in fn.__code__.co_varnames})
    except Exception as e:  # never let a tool crash the chat
        log.exception("tool %s failed", name)
        return {"error": f"{name} failed: {type(e).__name__}"}


# ─── LLM loop ────────────────────────────────────────────────────────────────


def _system_prompt(turn: Turn) -> str:
    b = turn.brand
    cfg = get_config()
    vert = cfg["verticals"].get(b.vertical, {}).get("label", b.vertical)
    pri = turn.effective_priorities()
    top = [SIGNAL_SHORT[k] for k in sorted(SIGNALS, key=lambda k: -pri.get(k, 0)) if pri.get(k, 0) >= 3]
    regs = [_regions()[r]["label"] for r in turn.effective_regions() if r in _regions()] or ["All of Sydney"]
    return f"""You are the Branchwise assistant. You help {b.name}, a {vert} brand ({b.store_format or 'format not set'}, {len(b.stores)} existing stores in Sydney), decide where to open next.

Current what-if: top priorities = {', '.join(top) or 'evenly weighted'}; areas = {', '.join(regs)}.
Signals: {json.dumps(SIGNAL_TEXT)}.

How to work:
- When the user describes their customers, format or goals, call set_priorities (and set_areas if they name places), then find_best_areas.
- Use area_report to explain one suburb, search_places to look up competitors, anchors or any named place.
- Only save to the shortlist when the user asks.
- Words matter: "competitors" are other brands in the same category; "cannibalisation" only means taking customers from the brand's OWN stores.
- If a search finds nothing, say the data shows none rather than concluding there is no competition; area_report lists the nearest competitors.
- Every number you mention must come from a tool result. Never invent scores, distances or rents.
- You cannot see lease listings, rents, demographics or real foot traffic; say so if asked.

Answer style: plain Australian English, short. Lead with the recommendation. 2-5 sentences or a short list of up to 5 suburbs, each with one reason. Mention one trade-off or risk when there is one. No markdown headings."""


def _llm_chat(turn: Turn, history: list[dict]) -> str:
    client = _client()
    model = resolve_model()
    if not model:
        raise RuntimeError("No Groq model available for this key.")
    msgs: list[dict] = [{"role": "system", "content": _system_prompt(turn)}] + history
    tools = _tool_schema()
    for _ in range(MAX_TOOL_ROUNDS):
        resp = client.chat.completions.create(
            model=model, messages=msgs, tools=tools, tool_choice="auto", temperature=0.2, max_tokens=700,
        )
        msg = resp.choices[0].message
        calls = msg.tool_calls or []
        if not calls:
            return (msg.content or "").strip()
        msgs.append({"role": "assistant", "content": msg.content or "",
                     "tool_calls": [{"id": c.id, "type": "function",
                                     "function": {"name": c.function.name, "arguments": c.function.arguments}} for c in calls]})
        for c in calls:
            try:
                args = json.loads(c.function.arguments or "{}")
            except json.JSONDecodeError:
                args = {}
            result = _run_tool(turn, c.function.name, args)
            msgs.append({"role": "tool", "tool_call_id": c.id, "content": json.dumps(result)[:6000]})
    # out of rounds: ask for a final answer without tools
    resp = client.chat.completions.create(model=model, messages=msgs, temperature=0.2, max_tokens=500)
    return (resp.choices[0].message.content or "").strip()


# ─── No-AI fallback ──────────────────────────────────────────────────────────

INTENT_WORDS = {
    "surrounding_amenities": r"\b(uni|university|universities|student|students|campus|college|mall|shopping cent|office|offices|workers?|hospital)",
    "transit_accessibility": r"\b(station|train|metro|commut|bus|transport|transit|light rail)",
    "demographic_match": r"\b(busy|foot ?traffic|walk-?in|high street|pedestrian|crowd|vibrant|lively|nightlife|eat street)",
    "market_saturation": r"\b(competitor|competition|saturat|crowded market|gap|white ?space|no one else|untapped)",
    "cannibalisation": r"\b(my stores|own stores|cannibal|away from (our|my)|existing stores)",
}
REGION_WORDS = {
    "cbd": r"\b(cbd|city|inner city|haymarket|ultimo|surry hills)",
    "inner_west": r"\b(inner west|newtown|marrickville|leichhardt|glebe|ashfield|burwood)",
    "eastern_suburbs": r"\b(eastern suburbs|bondi|randwick|coogee|double bay|paddington)",
    "lower_north_shore": r"\b(north sydney|lower north shore|chatswood|crows nest|mosman)",
    "ryde_macquarie": r"\b(ryde|macquarie|eastwood|epping)",
    "canterbury_bankstown": r"\b(canterbury|bankstown|lakemba|campsie)",
    "st_george_south": r"\b(st george|hurstville|kogarah|rockdale|sutherland|cronulla)",
    "parramatta_west": r"\b(parramatta|western sydney|westmead|blacktown|auburn|granville)",
    "northern_beaches": r"\b(northern beaches|manly|dee why|brookvale)",
}


def _offline_chat(turn: Turn, text: str) -> str:
    t = text.lower()
    top = [k for k, pat in INTENT_WORDS.items() if re.search(pat, t)][:3]
    regions = [k for k, pat in REGION_WORDS.items() if re.search(pat, t)]
    parts: list[str] = []

    m = re.search(r"\b(?:find|show|where are|search for|look up)\s+(?:the\s+)?([a-z][a-z' &-]{2,40}?)(?:\s+(?:stores|shops|near|in|around)\b|[?.!]|$)", t)
    if m and not top:
        res = t_search_places(turn, m.group(1).strip(), regions[0] if regions else None, 8)
        names = ", ".join(f"{p['name']} ({p['suburb'] or 'Sydney'})" for p in res.get("places", [])[:5])
        return (f"I found {res.get('total_found', 0)} places matching “{m.group(1).strip()}”. "
                f"{('The first few: ' + names + '.') if names else ''} They're pinned on the map.")

    if top:
        t_set_priorities(turn, top)
        parts.append("I've re-weighted the map toward " + ", ".join(SIGNAL_SHORT[k].lower() for k in top) + ".")
    if regions:
        t_set_areas(turn, regions)
    res = t_find_best_areas(turn, 5)
    areas = res["areas"]
    if not areas:
        return "I couldn't find scored areas there. Try a wider area."
    lines = [f"{i + 1}. {a['suburb']} ({a['score']}/100): {a['reasons'][0] if a['reasons'] else 'strong all-round fit'}"
             for i, a in enumerate(areas)]
    parts.append("Your best areas right now:\n" + "\n".join(lines))
    if not top:
        parts.append("Tell me who your customers are (students, commuters, office workers, families) and I'll re-weight the scores.")
    return "\n\n".join(parts)


# ─── Entry point ─────────────────────────────────────────────────────────────


def chat(brand: Brand, db: Session, messages: list[dict], priorities: dict[str, int] | None,
         regions: list[str] | None) -> dict:
    turn = Turn(brand=brand, db=db, priorities=priorities, regions=regions)
    history = [{"role": m["role"], "content": m["content"][:1500]} for m in messages[-MAX_HISTORY:]
               if m.get("role") in ("user", "assistant") and m.get("content")]
    last_user = next((m["content"] for m in reversed(history) if m["role"] == "user"), "")
    mode = "offline"
    note = None
    reply = ""
    if groq_key():
        try:
            reply = _llm_chat(turn, history)
            mode = "groq"
        except Exception as e:
            status = getattr(e, "status_code", None)
            log.warning("Groq failed (%s): %s", status, e)
            note = ("The AI is busy (free quota reached), so this answer uses the built-in rules."
                    if status == 429 else "The AI didn't answer, so this answer uses the built-in rules.")
            turn.actions.clear()
            turn.priorities, turn.regions = priorities, regions
    if mode == "offline":
        reply = _offline_chat(turn, last_user)
    return {
        "reply": reply or "Sorry, I couldn't work that out. Try asking about a suburb or what your customers are like.",
        "actions": turn.actions,
        "scenario": {"priorities": turn.priorities, "regions": turn.regions},
        "mode": mode,
        "note": note,
    }
