// Scores in the browser: fetch a category's signals once, then every map redraw, AI what-if
// and Top picks list is computed here (~20 ms for the whole city) instead of on the server.
// Falls back to the server endpoints if the signals file can't be loaded.
import { api, priParam, type Brand, type HexResult, type Region, type RankedSite, type SignalKey } from "./api";
import { rankSites, scoreAll, weightsFromPriorities, type Scored, type SignalsFile } from "./scoring";

const files = new Map<string, Promise<SignalsFile>>();
function signalsFor(vertical: string): Promise<SignalsFile> {
  let p = files.get(vertical);
  if (!p) {
    p = api.signals(vertical);
    p.catch(() => files.delete(vertical)); // let a later call retry
    files.set(vertical, p);
  }
  return p;
}

let last: { key: string; scored: Scored[] } | null = null;
async function scoredFor(brand: Brand, priorities: Record<SignalKey, number> | null | undefined) {
  // no what-if: use the weights the server derived for the saved brand
  const weights = priorities ? weightsFromPriorities(priorities) : brand.weights;
  const stores = brand.stores.map((s) => ({ lat: s.lat, lng: s.lng, fsq_place_id: s.fsq_place_id }));
  const key = JSON.stringify([brand.vertical, weights, stores]);
  const file = await signalsFor(brand.vertical);
  if (last?.key !== key) last = { key, scored: scoreAll(file, weights, stores) };
  return { file, weights, scored: last.scored };
}

export async function heatmap(brand: Brand, priorities?: Record<SignalKey, number> | null): Promise<HexResult[]> {
  try {
    return (await scoredFor(brand, priorities)).scored;
  } catch {
    return (await api.heatmap(priParam(priorities ?? undefined))).hexes;
  }
}

export async function topPicks(brand: Brand, priorities: Record<SignalKey, number> | null | undefined,
  regionKeys: string[], regions: Region[], limit = 10): Promise<RankedSite[]> {
  try {
    const { file, weights, scored } = await scoredFor(brand, priorities);
    return rankSites(scored, weights, regionKeys, regions, limit, file.params.ranking_min_spacing_m);
  } catch {
    return (await api.rankings(limit, regionKeys, priParam(priorities ?? undefined))).sites;
  }
}
