// In-browser scoring: a port of backend/app/scoring.py (layer 2).
// The server ships each category's raw signals once (GET /api/signals/:vertical, cached a day);
// the browser applies the brand's weights and store spacing, so the map and the top picks cost
// the server nothing per user, and AI what-ifs redraw instantly.
// Keep in step with scoring.py: scripts/check_scoring_parity.mjs compares the two.

import type { Components, HexResult, RankedSite, SignalKey } from "./api";

export const SIGNALS: SignalKey[] = [
  "market_saturation", "cannibalisation", "surrounding_amenities", "transit_accessibility", "demographic_match",
];
const DEFAULT_WEIGHTS: Record<SignalKey, number> = {
  market_saturation: 5, cannibalisation: 5, surrounding_amenities: 40, transit_accessibility: 30, demographic_match: 20,
};
const IMPORTANCE_MULTIPLIER = [0, 1, 2, 3.5, 5];

export type SignalsFile = {
  vertical: string;
  params: { competitor_radius_m: number; cannibal_zero_m: number; cannibal_full_score_m: number; ranking_min_spacing_m: number };
  curves: { transit_m: number; anchor_m: number; retail_n: number; complementary_n: number; competitor_n: number };
  localities: string[];
  names: string[];
  h3: string[]; lat: number[]; lng: number[]; loc: number[];
  comp: number[]; compl: number[]; retail: number[];
  anchor_m: number[]; anchor: number[]; transit_m: number[]; transit: number[];
};

export type StoreLite = { lat: number; lng: number; fsq_place_id?: string | null };
export type RegionLite = { key: string; lat: number; lng: number; radius_km: number };

export type Scored = HexResult & {
  raw: {
    n_competitors: number; n_complementary: number; n_retail: number;
    d_anchor_m: number | null; d_transit_m: number | null; d_cannibal_m: number | null;
    anchor_name: string | null; transit_name: string | null;
  };
};

/** Python's round(): halves go to the even neighbour. */
export function pyRound(x: number): number {
  const f = Math.floor(x);
  const diff = x - f;
  if (diff === 0.5) return f % 2 === 0 ? f : f + 1;
  return Math.round(x);
}

export function weightsFromPriorities(p: Record<string, number> | null | undefined): Record<SignalKey, number> {
  if (!p || Object.keys(p).length === 0) return { ...DEFAULT_WEIGHTS };
  const raw = Object.fromEntries(SIGNALS.map((k) => [k, IMPORTANCE_MULTIPLIER[p[k] ?? 2] ?? 2])) as Record<SignalKey, number>;
  const total = SIGNALS.reduce((a, k) => a + raw[k], 0);
  if (total <= 0) return { ...DEFAULT_WEIGHTS };
  return Object.fromEntries(SIGNALS.map((k) => [k, Math.round((raw[k] / total) * 1000) / 10])) as Record<SignalKey, number>;
}

/** Python 3.12+ sum() over floats: Neumaier-compensated, so ties round the same way. */
function pySum(xs: number[]): number {
  let sum = 0, c = 0;
  for (const x of xs) {
    const t = sum + x;
    c += Math.abs(sum) >= Math.abs(x) ? sum - t + x : x - t + sum;
    sum = t;
  }
  return sum + c;
}

const R = 6371000;
const rad = (d: number) => (d * Math.PI) / 180;
export function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const p1 = rad(lat1), p2 = rad(lat2);
  const a = Math.sin((p2 - p1) / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(rad(lng2 - lng1) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

const CELL = 0.02;
class StoreGrid {
  cells = new Map<string, StoreLite[]>();
  constructor(stores: StoreLite[]) {
    for (const s of stores) {
      const k = this.key(s.lat, s.lng);
      (this.cells.get(k) ?? this.cells.set(k, []).get(k)!).push(s);
    }
  }
  private key(lat: number, lng: number) {
    return `${Math.floor(lat / CELL)}:${Math.floor(lng / CELL)}`;
  }
  private *near(lat: number, lng: number) {
    const ky = Math.floor(lat / CELL), kx = Math.floor(lng / CELL);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) yield* this.cells.get(`${ky + dy}:${kx + dx}`) ?? [];
  }
  nearest(lat: number, lng: number): number | null {
    if (!this.cells.size) return null;
    let best: number | null = null;
    for (const s of this.near(lat, lng)) {
      const d = haversine(lat, lng, s.lat, s.lng);
      if (best === null || d < best) best = d;
    }
    return best;
  }
  countPoiWithin(lat: number, lng: number, r: number): number {
    let n = 0;
    for (const s of this.near(lat, lng)) if (s.fsq_place_id && haversine(lat, lng, s.lat, s.lng) <= r) n++;
    return n;
  }
}

const lerpClamp = (v: number, atZero: number, atHundred: number) =>
  atZero === atHundred ? (v === atZero ? 100 : 0) : Math.max(0, Math.min(100, ((v - atZero) / (atHundred - atZero)) * 100));

/** Score every zone for one brand. ~10k zones in a few milliseconds. */
export function scoreAll(f: SignalsFile, weights: Record<SignalKey, number>, stores: StoreLite[]): Scored[] {
  const grid = new StoreGrid(stores);
  const c = f.curves, p = f.params;
  const wsum = pySum(SIGNALS.map((k) => weights[k] ?? 0)) || 1;
  const out: Scored[] = new Array(f.h3.length);
  for (let i = 0; i < f.h3.length; i++) {
    const lat = f.lat[i], lng = f.lng[i];
    const dCannibal = grid.nearest(lat, lng);
    const own = grid.countPoiWithin(lat, lng, p.competitor_radius_m);
    const nComp = Math.max(0, f.comp[i] - own);
    const dAnchor = f.anchor_m[i] < 0 ? null : f.anchor_m[i];
    const dTransit = f.transit_m[i] < 0 ? null : f.transit_m[i];
    const sAnchor = dAnchor === null ? 0 : 100 * Math.exp(-dAnchor / c.anchor_m);
    const sCompl = 100 * (1 - Math.exp(-f.compl[i] / c.complementary_n));
    const components: Components = {
      market_saturation: pyRound(100 * Math.exp(-nComp / c.competitor_n)),
      cannibalisation: dCannibal === null ? 100 : pyRound(lerpClamp(dCannibal, p.cannibal_zero_m, p.cannibal_full_score_m)),
      surrounding_amenities: pyRound(sAnchor * 0.6 + sCompl * 0.4),
      transit_accessibility: dTransit === null ? 0 : pyRound(100 * Math.exp(-dTransit / c.transit_m)),
      demographic_match: pyRound(100 * (1 - Math.exp(-f.retail[i] / c.retail_n))),
    };
    const score = pyRound(pySum(SIGNALS.map((k) => components[k] * (weights[k] ?? 0))) / wsum);
    out[i] = {
      h3_id: f.h3[i], lat, lng, locality: f.localities[f.loc[i]] || null, score, components,
      n_competitors: nComp, n_complementary: f.compl[i],
      raw: {
        n_competitors: nComp, n_complementary: f.compl[i], n_retail: f.retail[i],
        d_anchor_m: dAnchor, d_transit_m: dTransit, d_cannibal_m: dCannibal,
        anchor_name: f.anchor[i] >= 0 ? f.names[f.anchor[i]] : null,
        transit_name: f.transit[i] >= 0 ? f.names[f.transit[i]] : null,
      },
    };
  }
  return out;
}

const fmtM = (m: number | null) => (m === null ? "—" : m < 1000 ? `${pyRound(m)} m` : `${(m / 1000).toFixed(1)} km`);
function short(name: string | null, n = 36): string | null {
  if (!name) return name;
  if (/\d{5,}/.test(name)) return name.toLowerCase().includes("bus") ? "A bus stop" : null;
  return name.length <= n ? name : name.slice(0, n - 1).replace(/[ ,-]+$/, "") + "…";
}

export function explain(h: Scored, weights: Record<SignalKey, number>): { reasons: string[]; risks: string[] } {
  const order = [...SIGNALS].sort((a, b) => h.components[b] * (weights[b] ?? 0) - h.components[a] * (weights[a] ?? 0));
  const r = h.raw;
  const reasons: string[] = [];
  for (const k of order) {
    if (h.components[k] < 60 || (weights[k] ?? 0) <= 0) continue;
    if (k === "transit_accessibility" && r.d_transit_m !== null) reasons.push(`${short(r.transit_name) || "A train or bus stop"} is ${fmtM(r.d_transit_m)} away`);
    else if (k === "surrounding_amenities" && r.d_anchor_m !== null)
      reasons.push(r.anchor_name ? `Near ${short(r.anchor_name)}, ${fmtM(r.d_anchor_m)} away` : `A uni, mall, office or hospital ${fmtM(r.d_anchor_m)} away`);
    else if (k === "demographic_match") reasons.push(`Busy street: ${r.n_retail} shops and venues a short walk away`);
    else if (k === "market_saturation") {
      const n = r.n_competitors;
      reasons.push(n === 0 ? "No competitors within a 6-minute walk" : `Only ${n} competitor${n !== 1 ? "s" : ""} within a 6-minute walk`);
    } else if (k === "cannibalisation" && r.d_cannibal_m !== null) reasons.push(`Your nearest store is ${fmtM(r.d_cannibal_m)} away`);
    if (reasons.length === 3) break;
  }
  const risks: string[] = [];
  if (r.n_competitors >= 4) risks.push(`${r.n_competitors} competitors within a 6-minute walk`);
  if (r.d_cannibal_m !== null && r.d_cannibal_m < 800) risks.push(`Your own store is only ${fmtM(r.d_cannibal_m)} away`);
  if (r.d_transit_m === null || r.d_transit_m > 1200) risks.push("Hard to reach by train or bus");
  return { reasons, risks };
}

export function inRegions(lat: number, lng: number, keys: string[], regions: RegionLite[]): boolean {
  if (!keys.length) return true;
  return keys.some((k) => {
    const r = regions.find((x) => x.key === k);
    return r ? haversine(lat, lng, r.lat, r.lng) <= r.radius_km * 1000 : false;
  });
}

/** Best areas, best first, at least `spacing` metres apart. */
export function rankSites(scored: Scored[], weights: Record<SignalKey, number>, regionKeys: string[],
  regions: RegionLite[], limit: number, spacing: number): RankedSite[] {
  const pool = scored
    .filter((h) => inRegions(h.lat, h.lng, regionKeys, regions))
    .sort((a, b) => b.score - a.score || b.components.market_saturation - a.components.market_saturation);
  const picked: Scored[] = [];
  for (const h of pool) {
    if (picked.every((p) => haversine(h.lat, h.lng, p.lat, p.lng) >= spacing)) {
      picked.push(h);
      if (picked.length >= limit) break;
    }
  }
  return picked.map((h, i) => {
    const { raw, ...hex } = h;
    void raw;
    return { ...hex, rank: i + 1, ...explain(h, weights) };
  });
}
