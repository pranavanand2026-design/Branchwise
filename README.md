# Branchwise

**AI-powered site selection for food and beverage operators.**

## Problem

Mid-size F&B brands (3–50 stores) make expansion decisions based on broker shortlists and gut feel. Enterprise location intelligence platforms exist but are priced and designed for analysts, not operators. There is no tool that gives a growing brand a fast, data-backed answer to: *where should we open next?*

## Solution

Branchwise scores every 300m zone across Sydney against five spatial signals derived from 233,000 real Foursquare place records. The result is a live heatmap of opportunity across 12,270 hex zones — ranked, explained, and queryable in plain English.

Ask a question. The AI adjusts the scoring weights to match your intent, rescores the entire city, and returns a specific location with a full breakdown.

## Architecture

```
Data Layer        233K Sydney POIs in a single Parquet file (Foursquare OS Places)
Scoring Engine    5 spatial signals per hex → normalised 0–100 → weighted opportunity score
API Layer         FastAPI — /heatmap · /report · /compare · /pins · /chat
AI Layer          Claude with tool-use — adjusts weights, searches, compares, explains
Frontend          React + deck.gl H3HexagonLayer + MapLibre
```

## Scoring Signals

| Signal | Weight | How computed |
|---|---|---|
| Surrounding activity | 40% | Anchor proximity + complementary venue density within 300m |
| Transit access | 30% | Haversine distance to nearest rail, bus, or ferry stop |
| Demographic match | 20% | Retail and F&B density within 300m as foot traffic proxy |
| Market saturation | 5% | Competitor count within 500m |
| Store overlap | 5% | Distance to nearest same-brand store |

## Stack

- **Backend:** FastAPI + DuckDB + Python
- **Frontend:** React + Vite + deck.gl + MapLibre + Zustand
- **AI:** Anthropic Claude with tool-use
- **Data:** Foursquare Open Source Places — 233K Sydney POIs

## Run locally

```bash
# 1. Python 3.12 env (DuckDB has no wheels for 3.15 yet)
uv venv --python 3.12 .venv && uv pip install --python .venv/bin/python -r requirements.txt

# 2. Data: real Foursquare data if HF_TOKEN is in .env, else synthetic demo data
cp .env.example .env
.venv/bin/python scripts/prepare_sydney.py

# 3. Backend (http://127.0.0.1:8000)
.venv/bin/uvicorn backend.app.main:app --reload --port 8000

# 4. Frontend (separate terminal): landing at /, app at /app
cd frontend && npm install && npm run dev
```

Tests: `.venv/bin/python -m pytest backend/tests -q`

## Accounts and security

- Argon2id password hashes; opaque server-side sessions in httpOnly, SameSite=Lax cookies (only a SHA-256 of each token is stored)
- CSRF guard (`X-Requested-With: branchwise` on every write), CORS limited to `ALLOWED_ORIGINS`, rate-limited login and sign-up
- Every brand, store and shortlist route is scoped to the signed-in user; account deletion removes everything
- SQLite by default (`data/app.db`); set `DATABASE_URL` to Postgres for production

## Assistant

The Assistant tab talks to a Groq-hosted model (`GROQ_API_KEY` in `.env`) that can only act through tools on the same scoring engine: re-weight priorities, limit areas, rank areas, look up places, report on a suburb and save to the shortlist. Re-weighting is a what-if shown on the map until you save it. Without a key, or when the free quota runs out, a keyword-based fallback answers instead. Scores, reasons and summaries are always computed by the engine, never written by the model.
