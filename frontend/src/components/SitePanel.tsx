import { useEffect, useState } from "react";
import { Bookmark } from "lucide-react";
import { api, priParam, type RankedSite } from "../lib/api";
import { scoreFill, scoreHex, scoreLabel } from "../lib/colors";
import { useSession } from "../lib/session";
import { useWorkspace } from "../lib/store";
import { Spinner } from "./ui";
import { topPicks } from "../lib/localScoring";

/** The score on a small hex, filled in the map's colour for that score. */
export function ScoreBadge({ score, size = "md" }: { score: number; size?: "md" | "lg" }) {
  const dims = size === "lg" ? "w-14 h-16 text-[22px]" : "w-11 h-12 text-[17px]";
  return (
    <span className={`relative shrink-0 grid place-items-center ${dims}`} title={`${score}/100 · ${scoreLabel(score)}`}>
      <svg viewBox="0 0 44 48" className="absolute inset-0 w-full h-full" aria-hidden="true">
        <path d="M22 1.5 41.5 12.75v22.5L22 46.5 2.5 35.25v-22.5z" fill={scoreFill(score)} fillOpacity="0.18" stroke={scoreFill(score)} strokeWidth="2" />
      </svg>
      <span className="relative font-display leading-none tabular" style={{ color: scoreHex(score) }}>
        {score}
        <span className="sr-only"> out of 100, {scoreLabel(score)}</span>
      </span>
    </span>
  );
}

export function SitePanel({ onOpenSite }: { onOpenSite: (h3: string, lat: number, lng: number) => void }) {
  const brand = useSession((s) => s.brand)!;
  const meta = useSession((s) => s.meta);
  const { ranked, loadingRanked, rankedRegions, scenario, set } = useWorkspace();
  const [err, setErr] = useState<string | null>(null);

  const activeRegions = scenario?.regions ?? rankedRegions ?? brand.regions;
  const pri = priParam(scenario?.priorities);
  const key = JSON.stringify([activeRegions, pri, brand.vertical, brand.priorities, brand.stores.length]);

  useEffect(() => {
    set({ loadingRanked: true });
    setErr(null);
    topPicks(brand, scenario?.priorities, activeRegions, meta?.regions ?? [], 10)
      .then((sites) => set({ ranked: sites }))
      .catch((e) => setErr((e as Error).message))
      .finally(() => set({ loadingRanked: false }));
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    api.shortlist().then((d) => set({ shortlist: d.sites })).catch(() => undefined);
  }, [set]);

  return (
    <div className="h-full flex flex-col">
      <div className="px-5 h-16 shrink-0 border-b border-bg-border flex flex-col justify-center pr-14">
        <h2 className="text-[17px] leading-tight">Top picks</h2>
        <p className="text-[13px] text-fg-tertiary leading-tight truncate">
          {scenario ? "Using the AI suggested filter" : `Best 10 areas for ${brand.name}`}
        </p>
      </div>

      <div className="flex-1 overflow-y-auto">
        {loadingRanked && ranked.length === 0 ? (
          <div className="grid place-items-center h-40 text-accent-link"><Spinner className="w-5 h-5" /></div>
        ) : err ? (
          <p className="p-5 text-danger text-sm">{err}</p>
        ) : ranked.length === 0 ? (
          <p className="p-5 text-[15px] text-fg-tertiary">No scored areas here. Try All of Sydney.</p>
        ) : (
          <ol className={`py-2 ${loadingRanked ? "opacity-60" : ""}`} data-tour="ranked">
            {ranked.map((s) => <RankedRow key={s.h3_id} s={s} onOpen={onOpenSite} />)}
          </ol>
        )}
      </div>
    </div>
  );
}

function RankedRow({ s, onOpen }: { s: RankedSite; onOpen: (h3: string, lat: number, lng: number) => void }) {
  const { selectedHex, hoveredHex, shortlist, set } = useWorkspace();
  const active = selectedHex?.h3_id === s.h3_id;
  const hovered = hoveredHex === s.h3_id;
  const saved = shortlist.some((x) => x.h3_id === s.h3_id);
  return (
    <li
      className="px-3"
      onMouseEnter={() => set({ hoveredHex: s.h3_id })}
      onMouseLeave={() => set({ hoveredHex: null })}
    >
      <button
        className={`w-full text-left px-3 py-3 rounded-md flex items-center gap-3 transition-colors ${active ? "bg-accent-soft" : hovered ? "bg-bg-base" : ""}`}
        onClick={() => onOpen(s.h3_id, s.lat, s.lng)}
        aria-current={active ? "true" : undefined}
      >
        <span className="w-5 shrink-0 text-[13px] font-medium text-fg-tertiary tabular text-right">{s.rank}</span>
        <span className="flex-1 min-w-0">
          <span className="flex items-center gap-2">
            <span className="font-display text-[17px] truncate">{s.locality ?? "Sydney"}</span>
            {saved && <Bookmark size={13} className="shrink-0 text-accent-link fill-accent-link" aria-label="Saved" />}
          </span>
          {s.reasons[0] && <span className="block mt-0.5 text-sm text-fg-secondary leading-snug line-clamp-2">{s.reasons[0]}</span>}
        </span>
        <ScoreBadge score={s.score} />
      </button>
    </li>
  );
}
