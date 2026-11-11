"""Writes a test profile + the Python results, then runs the JS scorer on the same input."""
import json, subprocess, sys, tempfile
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from fastapi.testclient import TestClient
from backend.app.main import app
from backend.app import scoring as s
from backend.app.db import get_config

pri = {"demographic_match": 4, "transit_accessibility": 4, "surrounding_amenities": 1, "market_saturation": 3, "cannibalisation": 1}
stores = [{"lat": st.lat, "lng": st.lng, "fsq_place_id": st.fsq_place_id} for st in s.stores_from_brand_slug("chatime")[:25]]
regions = ["inner_west", "cbd"]
prof = s.Profile("bubble_tea", weights=s.weights_from_priorities(pri),
                 stores=tuple(s.Store(x["lat"], x["lng"], x["fsq_place_id"]) for x in stores), regions=tuple(regions))
scores = s.score_profile(prof)
top = s.rank_sites(prof, 10)
d = Path(tempfile.mkdtemp())
with TestClient(app) as c:
    (d / "signals.json").write_text(c.get("/api/signals/bubble_tea").text)
cfg = get_config()
(d / "input.json").write_text(json.dumps({"priorities": pri, "stores": stores, "regions": regions,
    "region_defs": [{"key": k, **v} for k, v in cfg["regions"].items()]}))
(d / "expected.json").write_text(json.dumps({"weights": prof.weights, "scores": {h.h3_id: h.score for h in scores},
    "top": [[t["h3_id"], t["score"], t["reasons"]] for t in top]}))
print(f"profile: {len(stores)} own stores, regions {regions}")
sys.exit(subprocess.call(["node", "--experimental-strip-types", "--no-warnings", "scripts/check_scoring_parity.mjs", str(d)]))
