"""LLM tool-use bridge for the chat bar.

User NL query -> LLM -> structured tool call -> deterministic DuckDB query ->
results -> LLM narrates with a short insight.

Provider is chosen at call time by the environment:
  - OPENAI_API_KEY    -> OpenAI function-calling (preferred for the live demo)
  - ANTHROPIC_API_KEY -> Claude tool-use
  - neither           -> offline keyword fallback (so the demo never breaks)

Tools:
  - filter_locations: applies vertical + locality + must_have_nearby filters,
    returns ranked hexes
  - generate_insight: formats a structured insight card for a chosen hex
"""

from __future__ import annotations

import json
import os
from typing import Any

try:
    from anthropic import Anthropic
except Exception:  # pragma: no cover
    Anthropic = None  # type: ignore

try:
    from openai import OpenAI
except Exception:  # pragma: no cover
    OpenAI = None  # type: ignore

from .db import get_config
from .scoring import WEIGHTS, Profile, apply_scenario_weights, hex_report, score_hexes, stores_from_brand_slug


def _legacy_report(vertical: str, h3_id: str, brand_slug: str | None = None) -> dict:
    rep = hex_report(Profile(vertical=vertical, stores=stores_from_brand_slug(brand_slug)), h3_id)
    rep.setdefault("ai_insight", rep.get("summary"))
    return rep

CLAUDE_MODEL = os.environ.get("CLAUDE_MODEL", "claude-sonnet-4-5")
OPENAI_MODEL = os.environ.get("OPENAI_MODEL", "gpt-4o-mini")

SYSTEM = """You are GapMap's AI site-selection assistant. You help franchise operators find the best spot to open their next store in Sydney, Australia.

You have three tools:
  - set_scenario: call this FIRST when the user expresses a spatial preference or requirement (near universities, avoid competition, transit hub, busy street, etc.). It reweights the scoring model to match their priority.
  - filter_locations: call this to fetch ranked candidate locations. Always call after set_scenario if one was triggered.
  - generate_insight: call this after filtering to narrate the top candidate with rich data-backed analysis.

The five scoring signals are:
  - market_saturation: fewer direct competitors nearby = higher score
  - cannibalisation: distance from own brand stores
  - surrounding_amenities: proximity to anchors (unis, malls, hospitals) + complementary venues
  - transit_accessibility: proximity to train/bus stops
  - demographic_match: density of retail/F&B foot traffic

Rules:
  1. If the user's message implies a spatial priority, call set_scenario first with the relevant boost/suppress signals.
  2. If their request has no spatial preference (just asking for "best location"), skip set_scenario and go straight to filter_locations.
  3. Keep narration concise but data-rich (2-4 sentences). Cite concrete numbers.
  4. Do not invent data. Only reference values present in the tool output.
  5. Always mention the opportunity score and the single strongest driver.
  6. If there's a cannibalization risk (same-brand store nearby), flag it as a warning.
  7. If part of the user's request can't be mapped to a signal, acknowledge it honestly.
"""


def _tools_schema() -> list[dict[str, Any]]:
    verticals = list(get_config()["verticals"].keys())
    signal_names = list(WEIGHTS.keys())
    return [
        {
            "name": "set_scenario",
            "description": (
                "Reweight the scoring model to reflect the user's stated priority. "
                "Call this when the user describes a spatial preference such as 'near universities', "
                "'avoid competition', 'busy street', 'transit hub', or 'away from our own stores'. "
                "Returns the adjusted weights and a short explanation."
            ),
            "input_schema": {
                "type": "object",
                "properties": {
                    "boost": {
                        "type": "array",
                        "items": {"type": "string", "enum": signal_names},
                        "description": "Signals to boost (2.5× weight). Pick signals that match the user's priority.",
                    },
                    "suppress": {
                        "type": "array",
                        "items": {"type": "string", "enum": signal_names},
                        "description": "Signals to down-weight (0.3× weight). Optional.",
                    },
                    "label": {
                        "type": "string",
                        "description": "Short human-readable label shown on the map, e.g. 'Near universities'.",
                    },
                    "unmapped": {
                        "type": "string",
                        "description": "Part of the user's request that couldn't be mapped to any signal. Null if everything mapped.",
                    },
                },
                "required": ["boost", "label"],
            },
        },
        {
            "name": "filter_locations",
            "description": (
                "Score and return top candidate hexes for a given F&B vertical in Sydney. "
                "Optionally filter by locality (e.g. 'inner west', 'Newtown') and a user "
                "brand_slug for cannibalization analysis."
            ),
            "input_schema": {
                "type": "object",
                "properties": {
                    "vertical": {
                        "type": "string",
                        "enum": verticals,
                        "description": "Franchise vertical the user is opening.",
                    },
                    "locality": {
                        "type": "string",
                        "description": (
                            "Optional. A suburb or area name to filter to (substring match "
                            "against locality). Examples: 'Newtown', 'Surry Hills', 'Parramatta'."
                        ),
                    },
                    "brand_slug": {
                        "type": "string",
                        "description": (
                            "Optional. The user's own brand (lowercase, no spaces) for "
                            "cannibalization distance. Examples: 'gongcha', 'chatime', 'rolld'."
                        ),
                    },
                    "limit": {
                        "type": "integer",
                        "description": "Max hexes to return. Default 5.",
                    },
                },
                "required": ["vertical"],
            },
        },
        {
            "name": "generate_insight",
            "description": (
                "Return a full report for a specific hex. Use this after filter_locations "
                "to narrate the top candidate with full data analysis."
            ),
            "input_schema": {
                "type": "object",
                "properties": {
                    "h3_id": {"type": "string"},
                    "vertical": {"type": "string", "enum": verticals},
                    "brand_slug": {"type": "string"},
                },
                "required": ["h3_id", "vertical"],
            },
        },
    ]


def _run_set_scenario(**kwargs) -> dict:
    boost = kwargs.get("boost") or []
    suppress = kwargs.get("suppress") or []
    label = kwargs["label"]
    unmapped = kwargs.get("unmapped")
    weights = apply_scenario_weights(boost, suppress)
    return {
        "boost": boost,
        "suppress": suppress,
        "label": label,
        "unmapped": unmapped,
        "weights": weights,
    }


def _run_filter_locations(**kwargs) -> dict:
    vertical = kwargs["vertical"]
    locality = kwargs.get("locality")
    brand_slug = kwargs.get("brand_slug")
    limit = int(kwargs.get("limit") or 5)
    weight_overrides = kwargs.get("weight_overrides")
    scores = score_hexes(vertical, brand_slug=brand_slug, locality_filter=locality, weight_overrides=weight_overrides)
    scores.sort(key=lambda s: -s.score)
    top = scores[:limit]
    return {
        "vertical": vertical,
        "locality": locality,
        "count": len(scores),
        "results": [
            {
                "h3_id": s.h3_id,
                "lat": s.lat,
                "lng": s.lng,
                "locality": s.locality,
                "score": s.score,
                "components": s.components,
                "n_competitors":  s.signals_raw["n_competitors"],
                "n_complementary": s.signals_raw["n_complementary"],
            }
            for s in top
        ],
    }


def _run_generate_insight(**kwargs) -> dict:
    return _legacy_report(kwargs["vertical"], kwargs["h3_id"], brand_slug=kwargs.get("brand_slug"))


TOOL_IMPLS = {
    "set_scenario": _run_set_scenario,
    "filter_locations": _run_filter_locations,
    "generate_insight": _run_generate_insight,
}


def chat(user_message: str, max_turns: int = 4, brand_slug: str | None = None) -> dict:
    """Run a user message through an LLM with tool use.

    Returns:
      {
        "reply": str,                       # final assistant text
        "tool_calls": list[{name, input, output}],
        "highlight": {...} | None,          # top hex to focus the map on
        "_offline"?: bool,                  # set when the heuristic fallback ran
        "_provider": "openai" | "anthropic" | "offline",
      }

    Provider selection (in priority order):
      1. OPENAI_API_KEY    → OpenAI function-calling
      2. ANTHROPIC_API_KEY → Claude tool-use
      3. neither           → offline keyword fallback
    """
    openai_key = os.environ.get("OPENAI_API_KEY")
    anthropic_key = os.environ.get("ANTHROPIC_API_KEY")

    if openai_key and OpenAI is not None:
        try:
            return _chat_openai(user_message, max_turns=max_turns, brand_slug=brand_slug)
        except Exception as exc:
            return _offline_fallback(user_message, error=f"OpenAI error: {exc}")

    if anthropic_key and Anthropic is not None:
        try:
            return _chat_anthropic(user_message, max_turns=max_turns, brand_slug=brand_slug)
        except Exception as exc:
            return _offline_fallback(user_message, error=f"Claude error: {exc}")

    return _offline_fallback(user_message)


def _chat_openai(user_message: str, max_turns: int, brand_slug: str | None = None) -> dict:
    """OpenAI Chat Completions with function-calling (tools)."""
    client = OpenAI(api_key=os.environ["OPENAI_API_KEY"])

    # Translate our Anthropic-style tool schemas into OpenAI's.
    tools = [
        {
            "type": "function",
            "function": {
                "name": t["name"],
                "description": t["description"],
                "parameters": t["input_schema"],
            },
        }
        for t in _tools_schema()
    ]

    messages: list[dict[str, Any]] = [
        {"role": "system", "content": SYSTEM},
        {"role": "user", "content": user_message},
    ]
    tool_calls_log: list[dict[str, Any]] = []
    highlight: dict | None = None
    scenario: dict | None = None

    for _ in range(max_turns):
        resp = client.chat.completions.create(
            model=OPENAI_MODEL,
            messages=messages,
            tools=tools,
            tool_choice="auto",
            temperature=0.3,
        )
        msg = resp.choices[0].message

        if not msg.tool_calls:
            return {
                "reply": (msg.content or "").strip() or "(no response)",
                "tool_calls": tool_calls_log,
                "highlight": highlight,
                "scenario": scenario,
                "_provider": "openai",
            }

        messages.append(
            {
                "role": "assistant",
                "content": msg.content or "",
                "tool_calls": [
                    {
                        "id": tc.id,
                        "type": "function",
                        "function": {"name": tc.function.name, "arguments": tc.function.arguments},
                    }
                    for tc in msg.tool_calls
                ],
            }
        )

        for tc in msg.tool_calls:
            name = tc.function.name
            try:
                args = json.loads(tc.function.arguments or "{}")
            except json.JSONDecodeError:
                args = {}
            try:
                if name == "filter_locations":
                    if scenario:
                        args["weight_overrides"] = scenario["weights"]
                    if brand_slug and not args.get("brand_slug"):
                        args["brand_slug"] = brand_slug
                output = TOOL_IMPLS[name](**args)
                if name == "set_scenario":
                    scenario = output
                if name == "filter_locations" and output.get("results"):
                    highlight = output["results"][0]
            except Exception as exc:
                output = {"error": str(exc)}
            tool_calls_log.append({"name": name, "input": args, "output": output})
            messages.append(
                {
                    "role": "tool",
                    "tool_call_id": tc.id,
                    "content": json.dumps(output, default=str)[:15000],
                }
            )

    return {
        "reply": "(Maxed out tool turns without a final answer.)",
        "tool_calls": tool_calls_log,
        "highlight": highlight,
        "scenario": scenario,
        "_provider": "openai",
    }


def _chat_anthropic(user_message: str, max_turns: int, brand_slug: str | None = None) -> dict:
    """Claude tool-use (kept for fallback / symmetry)."""
    client = Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
    tools = _tools_schema()
    messages: list[dict[str, Any]] = [{"role": "user", "content": user_message}]
    tool_calls_log: list[dict[str, Any]] = []
    highlight: dict | None = None
    scenario: dict | None = None

    for _ in range(max_turns):
        resp = client.messages.create(
            model=CLAUDE_MODEL,
            max_tokens=1024,
            system=SYSTEM,
            tools=tools,
            messages=messages,
        )
        tool_uses = [b for b in resp.content if b.type == "tool_use"]
        if not tool_uses:
            final_text = "\n".join(b.text for b in resp.content if b.type == "text").strip()
            return {
                "reply": final_text or "(no response)",
                "tool_calls": tool_calls_log,
                "highlight": highlight,
                "scenario": scenario,
                "_provider": "anthropic",
            }

        messages.append({"role": "assistant", "content": resp.content})
        tool_results: list[dict[str, Any]] = []
        for tu in tool_uses:
            name = tu.name
            args = dict(tu.input)
            try:
                if name == "filter_locations":
                    if scenario:
                        args["weight_overrides"] = scenario["weights"]
                    if brand_slug and not args.get("brand_slug"):
                        args["brand_slug"] = brand_slug
                output = TOOL_IMPLS[name](**args)
                if name == "set_scenario":
                    scenario = output
                if name == "filter_locations" and output.get("results"):
                    highlight = output["results"][0]
            except Exception as exc:
                output = {"error": str(exc)}
            tool_calls_log.append({"name": name, "input": args, "output": output})
            tool_results.append(
                {
                    "type": "tool_result",
                    "tool_use_id": tu.id,
                    "content": json.dumps(output, default=str)[:15000],
                }
            )
        messages.append({"role": "user", "content": tool_results})

    return {
        "reply": "(Maxed out tool turns without a final answer.)",
        "tool_calls": tool_calls_log,
        "highlight": highlight,
        "scenario": scenario,
        "_provider": "anthropic",
    }


# ─── Offline fallback (no API key) ───────────────────────────────────────────

# Comprehensive Sydney suburb list for better keyword matching
_SUBURBS = [
    "cbd", "sydney", "newtown", "surry hills", "bondi", "chatswood", "parramatta",
    "stanmore", "marrickville", "glebe", "ultimo", "redfern", "camperdown",
    "kingsford", "hurstville", "north sydney", "ashfield", "mascot",
    "randwick", "strathfield", "burwood", "inner west", "darlinghurst",
    "paddington", "chippendale", "haymarket", "broadway", "pyrmont",
    "manly", "mosman", "crows nest", "neutral bay", "lane cove",
    "ryde", "meadowbank", "eastwood", "epping", "macquarie park",
    "homebush", "auburn", "bankstown", "liverpool", "penrith",
    "blacktown", "castle hill", "hornsby", "dee why", "brookvale",
    "cronulla", "sutherland", "rockdale", "kogarah", "barangaroo",
    "waterloo", "zetland", "green square", "alexandria", "erskineville",
    "enmore", "leichhardt", "annandale", "petersham", "dulwich hill",
    "summer hill", "haberfield", "five dock", "drummoyne", "rozelle",
    "balmain", "hunters hill", "concord", "rhodes", "wentworth point",
    "wolli creek", "tempe", "sydenham", "st peters", "arncliffe",
]

# Anchor-type keywords the user might say
_ANCHOR_KEYWORDS = {
    "university": "is_anchor",
    "uni": "is_anchor",
    "universities": "is_anchor",
    "campus": "is_anchor",
    "college": "is_anchor",
    "school": "is_anchor",
    "mall": "is_anchor",
    "shopping": "is_anchor",
    "hospital": "is_anchor",
    "station": "is_transit",
    "train": "is_transit",
    "transit": "is_transit",
    "transport": "is_transit",
}


def _offline_fallback(user_message: str, error: str | None = None) -> dict:
    """Heuristic parsing so the demo works without an API key (or if one fails).

    Matches keywords to a vertical + optional locality, runs scoring,
    and returns a rich data-backed narration.
    """
    msg = user_message.lower()

    # Detect vertical
    vertical = "bubble_tea"
    for key, keywords in {
        "bubble_tea": ["bubble tea", "boba", "tea shop", "milk tea"],
        "coffee": ["coffee", "cafe", "café", "espresso", "latte"],
        "fast_casual": ["fast casual", "rolld", "roll'd", "soul origin", "fast food", "quick service", "qsr", "restaurant"],
    }.items():
        if any(k in msg for k in keywords):
            vertical = key
            break

    # Detect locality
    locality = None
    for hint in _SUBURBS:
        if hint in msg:
            # Map area aliases to actual suburbs
            if hint == "inner west":
                locality = None  # Don't filter, let scoring handle it naturally
            elif hint == "cbd":
                locality = "Sydney"
            else:
                locality = hint.title()
            break

    # Detect anchor preference (e.g. "near universities")
    anchor_preference = None
    for kw, col in _ANCHOR_KEYWORDS.items():
        if kw in msg:
            anchor_preference = col
            break

    # Score hexes
    out = _run_filter_locations(vertical=vertical, locality=locality, limit=10)

    # If user asked "near universities" etc., re-rank by anchor/transit distance
    results = out.get("results", [])
    if anchor_preference == "is_anchor" and results:
        # Weight surrounding_amenities (anchor + complementary) most heavily
        results.sort(key=lambda r: -r["components"].get("surrounding_amenities", 0))
        out["results"] = results[:5]
    elif anchor_preference == "is_transit" and results:
        results.sort(key=lambda r: -r["components"].get("transit_accessibility", 0))
        out["results"] = results[:5]

    top = out["results"][0] if out["results"] else None

    if top:
        report = _legacy_report(vertical, top["h3_id"])
        anchor = report["nearest_anchors"][0] if report["nearest_anchors"] else None
        transit = report["nearest_transit"][0] if report["nearest_transit"] else None
        competitors = report["signals_raw"]["n_competitors"]
        diversity = report.get("diversity_index", 0)
        
        # Build rich narration
        area_name = top["locality"] or "unnamed area"
        vertical_name = vertical.replace("_", " ")
        
        parts = []
        parts.append(f"🏆 **Top match: {area_name}** — opportunity score **{top['score']}/100** for {vertical_name}.")
        
        # Competition
        if competitors == 0:
            parts.append(f"✅ **Zero direct competitors** within 500m — a true gap in the market.")
        elif competitors <= 2:
            parts.append(f"Low competition: only {competitors} competitor{'s' if competitors > 1 else ''} within 500m.")
        else:
            parts.append(f"⚠️ {competitors} competitors within 500m — moderate saturation.")
        
        # Anchor
        if anchor:
            parts.append(f"📍 Key anchor: **{anchor['name']}** is just {anchor['dist_m']}m away, driving foot traffic.")
        
        # Transit
        if transit:
            parts.append(f"🚉 Transit: {transit['name']} ({transit['dist_m']}m) supports repeat visits.")
        
        # Complementary
        n_complementary = report["signals_raw"]["n_complementary"]
        if n_complementary >= 3:
            comp_names = [c["name"] for c in report["nearest_complementary"][:2]]
            parts.append(f"🏪 {n_complementary} complementary businesses nearby including {', '.join(comp_names)}.")
        
        # Diversity
        if diversity >= 0.6:
            parts.append(f"📊 Area diversity index: {diversity} — vibrant commercial precinct.")
        
        # Cannibalization warning
        d_cannibal = report["signals_raw"].get("d_cannibal_m")
        if d_cannibal is not None and d_cannibal < 500:
            parts.append(f"⚠️ **Cannibalization risk**: same-brand store only {round(d_cannibal)}m away.")
        
        reply = "\n".join(parts)
    else:
        reply = "No matching locations found. Try broadening your search area or adjusting the vertical."

    out_dict: dict = {
        "reply": reply,
        "tool_calls": [{"name": "filter_locations", "input": {"vertical": vertical, "locality": locality}, "output": out}],
        "highlight": top,
        "scenario": None,
        "_offline": True,
        "_provider": "offline",
    }
    if error:
        out_dict["_error"] = error
    return out_dict
