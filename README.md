# Branchwise

Branchwise ranks every Sydney neighbourhood for a food and drink brand's next store and explains why, so you can choose before you sign a lease.

**Live:** https://branchwise-564404959706.australia-southeast1.run.app

## Architecture

```mermaid
flowchart LR
    subgraph web["Browser"]
        UI["React app<br/>map, top picks, shortlist"]
        Score["In-browser scoring<br/>10,765 zones in ~20 ms"]
    end

    subgraph run["Cloud Run"]
        API["FastAPI<br/>auth, brand, shortlist, signals"]
        AI["Branchwise AI<br/>tool-calling agent"]
    end

    subgraph data["Data"]
        POI[("Foursquare OS Places<br/>DuckDB + H3")]
        FS[("Firestore<br/>accounts, shortlists, rate limits")]
    end

    Groq["Groq LLM"]
    Tiles["OpenFreeMap tiles"]

    UI --> Score
    UI -- "signals, once a day" --> API
    UI -- chat --> AI
    UI --> Tiles
    API --> POI
    API --> FS
    AI --> API
    AI --> Groq
```

## Run locally

```bash
uv venv --python 3.12 .venv && uv pip install --python .venv/bin/python -r requirements.txt
cp .env.example .env
.venv/bin/python scripts/prepare_sydney.py && .venv/bin/python scripts/build_signals.py
.venv/bin/uvicorn backend.app.main:app --reload --port 8000
cd frontend && npm install && npm run dev        # http://localhost:5173
```

Tests: `.venv/bin/python -m pytest backend/tests -q`. Deploy: `deploy/cloudrun.sh`.
