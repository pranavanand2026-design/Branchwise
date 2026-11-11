// Compares the browser scorer (frontend/src/lib/scoring.ts) with the Python engine.
// Run: .venv/bin/python scripts/check_scoring_parity.py  (it writes inputs, then calls this)
import { readFileSync } from "node:fs";
import { scoreAll, weightsFromPriorities, rankSites } from "../frontend/src/lib/scoring.ts";

const dir = process.argv[2];
const signals = JSON.parse(readFileSync(`${dir}/signals.json`, "utf8"));
const input = JSON.parse(readFileSync(`${dir}/input.json`, "utf8"));
const expected = JSON.parse(readFileSync(`${dir}/expected.json`, "utf8"));

const w = weightsFromPriorities(input.priorities);
const scored = scoreAll(signals, w, input.stores);
const byId = new Map(scored.map((s) => [s.h3_id, s]));
let diff = 0, worst = 0;
for (const [h3, score] of Object.entries(expected.scores)) {
  const d = Math.abs(byId.get(h3).score - score);
  if (d) diff++;
  worst = Math.max(worst, d);
}
const top = rankSites(scored, w, input.regions, input.region_defs, 10, signals.params.ranking_min_spacing_m);
const got = top.map((t) => [t.h3_id, t.score, t.reasons]);
const sameTop = JSON.stringify(got) === JSON.stringify(expected.top);
if (!sameTop) got.forEach((g, i) => { if (JSON.stringify(g) !== JSON.stringify(expected.top[i])) console.log("  top", i + 1, "js:", JSON.stringify(g), "\n         py:", JSON.stringify(expected.top[i])); });
for (const [h3, score] of Object.entries(expected.scores)) { const s = byId.get(h3); if (s.score !== score) console.log("  zone", h3, "js", s.score, "py", score, JSON.stringify(s.components)); }
console.log(`weights match: ${JSON.stringify(w) === JSON.stringify(expected.weights)}`);
console.log(`zones: ${scored.length}, scores differing: ${diff}, largest difference: ${worst}`);
console.log(`top 10 (ids, scores, reasons) identical: ${sameTop}`);
const t = performance.now(); for (let i = 0; i < 20; i++) scoreAll(signals, w, input.stores);
console.log(`browser scoring time: ${((performance.now() - t) / 20).toFixed(1)} ms per full city`);
if (diff || !sameTop) process.exit(1);
