"""Prepare Sydney POIs dataset.

- If HF_TOKEN is set, downloads FSQ OS Places, filters to Sydney bbox,
  computes H3 res-9 cell, brand_slug, and writes data/sydney_pois.parquet.
- If HF_TOKEN is missing, generates a realistic synthetic dataset so the
  app can be demoed without hitting the real dataset.

Run:
    python scripts/prepare_sydney.py
"""

from __future__ import annotations

import json
import math
import os
import random
import re
import sys
from pathlib import Path

import duckdb

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"
DATA_DIR.mkdir(exist_ok=True)
OUT_PARQUET = DATA_DIR / "sydney_pois.parquet"

# Sydney bbox (greater Sydney)
SYD_LAT_MIN, SYD_LAT_MAX = -34.10, -33.60
SYD_LNG_MIN, SYD_LNG_MAX = 150.80, 151.35

FSQ_PLACES_GLOB = (
    "hf://datasets/foursquare/fsq-os-places/release/dt=2026-01-12/"
    "places/parquet/places-*.zstd.parquet"
)


def install_h3_extension(con: duckdb.DuckDBPyConnection) -> bool:
    """Try to install/load DuckDB h3 community extension. Returns True on success."""
    try:
        con.execute("INSTALL h3 FROM community;")
        con.execute("LOAD h3;")
        print("[h3] extension loaded")
        return True
    except Exception as exc:  # pragma: no cover
        print(f"[h3] extension unavailable ({exc}); falling back to Python h3 lib")
        return False


def brand_slug_expr(col: str = "name") -> str:
    """SQL expression that normalizes a brand name for cannibalization match.

    Lowercases, strips non-alpha, collapses to single token up to 18 chars.
    "Gong Cha" -> "gongcha", "7-Eleven" -> "eleven", "McDonald's" -> "mcdonald".
    """
    return (
        f"LOWER(REGEXP_REPLACE(COALESCE({col}, ''), '[^A-Za-z]', '', 'g'))"
        "[1:18]"
    )


def download_real_data(hf_token: str) -> None:
    con = duckdb.connect()
    con.execute("INSTALL httpfs; LOAD httpfs;")
    safe_token = hf_token.replace("'", "''")
    con.execute(f"CREATE OR REPLACE SECRET (TYPE huggingface, TOKEN '{safe_token}')")
    has_h3 = install_h3_extension(con)

    print(f"[fsq] scanning parquet and filtering to Sydney bbox...")
    # Filter to Sydney bbox + open places only (date_closed IS NULL)
    h3_col = "h3_string_to_h3(h3_latlng_to_cell_string(latitude, longitude, 9))" if has_h3 else "NULL"
    con.execute(
        f"""
        CREATE TABLE syd AS
        SELECT
            fsq_place_id,
            name,
            latitude,
            longitude,
            address,
            locality,
            region,
            postcode,
            country,
            date_refreshed,
            date_closed,
            fsq_category_labels,
            fsq_category_ids,
            website,
            tel,
            {brand_slug_expr()} AS brand_slug
        FROM '{FSQ_PLACES_GLOB}'
        WHERE country = 'AU'
          AND latitude  BETWEEN {SYD_LAT_MIN} AND {SYD_LAT_MAX}
          AND longitude BETWEEN {SYD_LNG_MIN} AND {SYD_LNG_MAX}
          AND date_closed IS NULL
        """
    )

    n = con.execute("SELECT COUNT(*) FROM syd").fetchone()[0]
    print(f"[fsq] filtered to {n:,} open Sydney POIs")

    # Compute H3 cell in Python if DuckDB ext unavailable
    if not has_h3:
        import h3  # type: ignore
        df = con.execute("SELECT rowid, latitude, longitude FROM syd").fetchdf()
        df["h3_9"] = [
            h3.latlng_to_cell(lat, lng, 9)
            for lat, lng in zip(df["latitude"], df["longitude"])
        ]
        con.register("h3_map", df[["rowid", "h3_9"]])
        con.execute("ALTER TABLE syd ADD COLUMN h3_9 VARCHAR")
        con.execute("UPDATE syd SET h3_9 = m.h3_9 FROM h3_map m WHERE syd.rowid = m.rowid")
    else:
        con.execute(
            "ALTER TABLE syd ADD COLUMN h3_9 VARCHAR"
        )
        con.execute(
            "UPDATE syd SET h3_9 = h3_latlng_to_cell_string(latitude, longitude, 9)"
        )

    # Primary category = first non-null level2 label from the array
    con.execute(
        """
        ALTER TABLE syd ADD COLUMN primary_category VARCHAR;
        UPDATE syd SET primary_category =
            CASE WHEN length(fsq_category_labels) > 0
                 THEN list_transform(fsq_category_labels, x -> split_part(x, '>', -1))[1]
                 ELSE NULL END
        """
    )

    con.execute(f"COPY syd TO '{OUT_PARQUET}' (FORMAT PARQUET, COMPRESSION ZSTD)")
    print(f"[fsq] wrote {OUT_PARQUET}")


# ─── Synthetic data (fallback for demo when HF_TOKEN not set) ────────────────

SYNTHETIC_CATEGORIES = [
    # (label, weight, is_anchor_type)
    ("Bubble Tea Shop", 2, None),
    ("Coffee Shop", 15, None),
    ("Café", 20, None),
    ("Bakery", 6, None),
    ("Fast Food Restaurant", 10, None),
    ("Asian Restaurant", 8, None),
    ("Italian Restaurant", 5, None),
    ("Dessert Shop", 3, None),
    ("Ice Cream Parlor", 2, None),
    ("Bar", 7, None),
    ("Sandwich Spot", 4, None),
    ("Pharmacy", 3, None),
    ("Convenience Store", 6, None),
    ("Supermarket", 2, None),
    ("Shopping Mall", 1, "mall"),
    ("University", 1, "uni"),
    ("College and University", 1, "uni"),
    ("Hospital", 1, "hospital"),
    ("Rail Station", 2, "transit"),
    ("Metro Station", 1, "transit"),
    ("Bus Station", 3, "transit"),
    ("Clothing Store", 5, None),
    ("Bookstore", 1, None),
    ("Coworking Space", 1, None),
    ("Juice Bar", 2, None),
    ("Smoothie Shop", 1, None),
    ("Salad Restaurant", 2, None),
    ("Burger Joint", 3, None),
    ("Office", 4, None),
    ("High School", 2, "school"),
    ("Gym", 3, None),
    ("Restaurant", 10, None),
]

# Cluster centers (name, lat, lng, density_multiplier)
SYD_CLUSTERS = [
    ("Sydney CBD",       -33.8688, 151.2093, 3.0),
    ("Surry Hills",      -33.8847, 151.2100, 2.2),
    ("Newtown",          -33.8960, 151.1790, 1.8),
    ("Bondi Junction",   -33.8915, 151.2478, 1.6),
    ("Chatswood",        -33.7971, 151.1830, 1.8),
    ("Parramatta",       -33.8150, 151.0000, 1.9),
    ("Strathfield",      -33.8720, 151.0930, 1.2),
    ("Burwood",          -33.8780, 151.1040, 1.3),
    ("Stanmore",         -33.8930, 151.1600, 0.6),  # deliberately low for demo
    ("Marrickville",     -33.9100, 151.1540, 1.1),
    ("Glebe",            -33.8790, 151.1860, 1.1),
    ("Ultimo",           -33.8820, 151.1980, 1.4),
    ("Redfern",          -33.8940, 151.2030, 1.3),
    ("Camperdown",       -33.8880, 151.1780, 0.9),  # near USyd
    ("Kingsford",        -33.9230, 151.2280, 1.1),  # near UNSW
    ("Hurstville",       -33.9670, 151.1020, 1.4),
    ("North Sydney",     -33.8400, 151.2070, 1.6),
    ("Ashfield",         -33.8880, 151.1260, 1.1),
    ("Mascot",           -33.9260, 151.1920, 0.8),
    ("Randwick",         -33.9160, 151.2410, 1.0),
]

# Known real-ish brand names per category (for cannibalization demo)
BRANDS = {
    "Bubble Tea Shop":      ["Gong Cha", "Chatime", "Sharetea", "Koi Thé", "Coco Fresh", "Xing Fu Tang"],
    "Coffee Shop":          ["Toby's Estate", "Single O", "Campos", "Bluestone Lane", "Gloria Jean's"],
    "Café":                 ["Bills", "The Grounds", "Paramount Coffee", "Reuben Hills"],
    "Fast Food Restaurant": ["McDonald's", "KFC", "Hungry Jack's", "Oporto", "Red Rooster", "Guzman y Gomez"],
    "Asian Restaurant":     ["Mamak", "Din Tai Fung", "Ramen Zundo", "Ippudo"],
    "Sandwich Spot":        ["Subway", "Soul Origin", "Roll'd"],
    "Bakery":               ["Bakers Delight", "Brumby's", "Banh Mi Saigon"],
    "Supermarket":          ["Woolworths", "Coles", "IGA", "Aldi"],
    "Pharmacy":             ["Chemist Warehouse", "Priceline", "Terry White"],
    "Convenience Store":    ["7-Eleven", "Night Owl"],
    "Shopping Mall":        ["Westfield", "Chatswood Chase", "Broadway Sydney"],
    "University":           ["University of Sydney", "UNSW", "UTS", "Macquarie University"],
    "College and University": ["TAFE NSW", "SAE College"],
    "Hospital":             ["RPA Hospital", "St Vincent's", "Royal North Shore", "Westmead"],
    "Rail Station":         ["Central Station", "Town Hall", "Strathfield Station", "Redfern Station"],
    "Metro Station":        ["Metro"],
    "Bus Station":          ["Bus Interchange"],
    "Juice Bar":            ["Boost Juice", "Pressed"],
    "Smoothie Shop":        ["Boost Juice"],
    "Gym":                  ["Fitness First", "Anytime Fitness", "Plus Fitness"],
}


def synth_name(category: str, i: int) -> str:
    pool = BRANDS.get(category, [category])
    base = random.choice(pool)
    # Occasionally suffix with a neighborhood for realism
    if random.random() < 0.35:
        return f"{base} {random.choice([c[0] for c in SYD_CLUSTERS])}"
    return f"{base} #{i}" if random.random() < 0.1 else base


def slugify(s: str) -> str:
    return re.sub(r"[^a-z]", "", s.lower())[:18]


def gen_synthetic() -> None:
    import h3  # type: ignore

    random.seed(42)
    rows = []
    place_id = 100000
    per_cluster_total = 420  # roughly -> 20 clusters * 420 = ~8400 POIs after weighting

    weights = [w for _, w, _ in SYNTHETIC_CATEGORIES]
    total_w = sum(weights)

    for cname, clat, clng, mult in SYD_CLUSTERS:
        n = int(per_cluster_total * mult)
        for _ in range(n):
            # Pick category weighted
            r = random.random() * total_w
            acc = 0.0
            cat = SYNTHETIC_CATEGORIES[0][0]
            for label, w, _ in SYNTHETIC_CATEGORIES:
                acc += w
                if r <= acc:
                    cat = label
                    break
            # Jitter around cluster center (gaussian, ~500m)
            lat = clat + random.gauss(0, 0.006)
            lng = clng + random.gauss(0, 0.007)
            # Clamp to bbox
            lat = max(SYD_LAT_MIN, min(SYD_LAT_MAX, lat))
            lng = max(SYD_LNG_MIN, min(SYD_LNG_MAX, lng))
            name = synth_name(cat, place_id)
            rows.append({
                "fsq_place_id": f"syn_{place_id}",
                "name": name,
                "latitude": lat,
                "longitude": lng,
                "address": f"{random.randint(1, 999)} {cname} Rd",
                "locality": cname,
                "region": "New South Wales",
                "postcode": f"2{random.randint(0, 9):03d}",
                "country": "AU",
                "date_refreshed": "2026-01-10",
                "date_closed": None,
                "primary_category": cat,
                "fsq_category_labels": [f"Category > {cat}"],
                "website": None,
                "tel": None,
                "brand_slug": slugify(name),
                "h3_9": h3.latlng_to_cell(lat, lng, 9),
            })
            place_id += 1

    # Inject a few real anchors at correct coordinates so demos land on real places
    anchors = [
        ("University of Sydney", -33.8886, 151.1873, "University", "usyd"),
        ("UNSW Sydney",         -33.9173, 151.2313, "University", "unsw"),
        ("UTS",                 -33.8838, 151.2003, "University", "uts"),
        ("Macquarie University",-33.7750, 151.1123, "University", "macquarie"),
        ("Westfield Bondi Junction", -33.8923, 151.2494, "Shopping Mall", "westfield"),
        ("Westfield Chatswood",      -33.7966, 151.1830, "Shopping Mall", "westfield"),
        ("Chatswood Chase",          -33.7956, 151.1843, "Shopping Mall", "chatswoodchase"),
        ("Broadway Sydney",          -33.8828, 151.1950, "Shopping Mall", "broadway"),
        ("Central Station",          -33.8830, 151.2070, "Rail Station", "centralstation"),
        ("Town Hall Station",        -33.8730, 151.2070, "Rail Station", "townhall"),
        ("Redfern Station",          -33.8920, 151.1980, "Rail Station", "redfern"),
        ("Strathfield Station",      -33.8720, 151.0960, "Rail Station", "strathfield"),
        ("Parramatta Station",       -33.8180, 150.9995, "Rail Station", "parramatta"),
        ("RPA Hospital",             -33.8896, 151.1849, "Hospital", "rpahospital"),
        ("St Vincent's Hospital",    -33.8788, 151.2209, "Hospital", "stvincents"),
    ]
    for name, lat, lng, cat, slug in anchors:
        rows.append({
            "fsq_place_id": f"anchor_{slug}",
            "name": name,
            "latitude": lat,
            "longitude": lng,
            "address": f"1 {cat} Way",
            "locality": name.split()[-1],
            "region": "New South Wales",
            "postcode": "2000",
            "country": "AU",
            "date_refreshed": "2026-01-10",
            "date_closed": None,
            "primary_category": cat,
            "fsq_category_labels": [f"Category > {cat}"],
            "website": None,
            "tel": None,
            "brand_slug": slug,
            "h3_9": h3.latlng_to_cell(lat, lng, 9),
        })
        place_id += 1

    print(f"[synthetic] generated {len(rows):,} Sydney POIs")

    # Stage via JSONL (avoids a pandas/pyarrow dependency)
    tmp_jsonl = DATA_DIR / "_synthetic.jsonl"
    with tmp_jsonl.open("w") as f:
        for r in rows:
            f.write(json.dumps(r) + "\n")

    con = duckdb.connect()
    con.execute(
        f"""
        COPY (
          SELECT
            fsq_place_id::VARCHAR         AS fsq_place_id,
            name::VARCHAR                 AS name,
            latitude::DOUBLE              AS latitude,
            longitude::DOUBLE             AS longitude,
            address::VARCHAR              AS address,
            locality::VARCHAR             AS locality,
            region::VARCHAR               AS region,
            postcode::VARCHAR             AS postcode,
            country::VARCHAR              AS country,
            date_refreshed::VARCHAR       AS date_refreshed,
            date_closed::VARCHAR          AS date_closed,
            primary_category::VARCHAR     AS primary_category,
            fsq_category_labels::VARCHAR[] AS fsq_category_labels,
            website::VARCHAR              AS website,
            tel::VARCHAR                  AS tel,
            brand_slug::VARCHAR           AS brand_slug,
            h3_9::VARCHAR                 AS h3_9
          FROM read_json_auto('{tmp_jsonl}', format='newline_delimited')
        ) TO '{OUT_PARQUET}' (FORMAT PARQUET, COMPRESSION ZSTD)
        """
    )
    tmp_jsonl.unlink(missing_ok=True)
    print(f"[synthetic] wrote {OUT_PARQUET}")


def write_metadata(source: str) -> None:
    """Record where the dataset came from so the API/UI can say so honestly."""
    from datetime import datetime, timezone

    con = duckdb.connect()
    rows = con.execute(f"SELECT COUNT(*) FROM '{OUT_PARQUET}'").fetchone()[0]
    hexes = con.execute(f"SELECT COUNT(DISTINCT h3_9) FROM '{OUT_PARQUET}'").fetchone()[0]
    meta = {
        "source": source,  # "foursquare" | "synthetic"
        "release": FSQ_PLACES_GLOB.split("dt=")[1].split("/")[0] if source == "foursquare" else None,
        "poi_count": int(rows),
        "hex_count": int(hexes),
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }
    (DATA_DIR / "dataset.json").write_text(json.dumps(meta, indent=2))
    print(f"[meta] wrote {DATA_DIR / 'dataset.json'}")


def main() -> None:
    # Pick up HF_TOKEN from the repo-root .env as well as the shell.
    try:
        from dotenv import load_dotenv

        load_dotenv(ROOT / ".env")
    except ImportError:  # pragma: no cover
        pass

    force_synthetic = "--synthetic" in sys.argv
    hf_token = "" if force_synthetic else os.environ.get("HF_TOKEN", "").strip()
    if hf_token:
        print("[mode] HF_TOKEN found — downloading real FSQ Sydney subset")
        download_real_data(hf_token)
        source = "foursquare"
    else:
        print("[mode] No HF_TOKEN — generating synthetic demo dataset")
        print("       (set HF_TOKEN in .env and re-run for real FSQ data)")
        gen_synthetic()
        source = "synthetic"
    write_metadata(source)

    # Print summary
    con = duckdb.connect()
    rows = con.execute(f"SELECT COUNT(*) FROM '{OUT_PARQUET}'").fetchone()[0]
    hex_count = con.execute(f"SELECT COUNT(DISTINCT h3_9) FROM '{OUT_PARQUET}'").fetchone()[0]
    top_cats = con.execute(
        f"SELECT primary_category, COUNT(*) c FROM '{OUT_PARQUET}' "
        f"GROUP BY 1 ORDER BY 2 DESC LIMIT 8"
    ).fetchall()
    print(f"\n[summary] {rows:,} POIs across {hex_count:,} H3 cells (res 9)")
    print("[summary] top categories:")
    for cat, n in top_cats:
        print(f"            {(cat or 'Unknown'):<35} {n:>6,}")


if __name__ == "__main__":
    main()
