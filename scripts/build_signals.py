"""Precompute every category's per-zone signals into data/signals/*.json.

Run after scripts/prepare_sydney.py (the Docker build does both), so a new server
loads signals from disk instead of spending seconds computing them.
    python scripts/build_signals.py
"""

import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from backend.app.db import get_config  # noqa: E402
from backend.app.scoring import save_prebuilt  # noqa: E402

t = time.time()
for key in get_config()["verticals"]:
    p = save_prebuilt(key)
    print(f"[signals] {key:12} -> {p.relative_to(p.parents[2])} ({p.stat().st_size / 1024:.0f} KB)")
print(f"[signals] done in {time.time() - t:.1f}s")
