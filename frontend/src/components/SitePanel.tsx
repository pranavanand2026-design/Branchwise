import { useEffect, useRef, useState } from "react";
import { Bookmark, Check, ChevronDown } from "lucide-react";
import { api, priParam, type RankedSite } from "../lib/api";
import { scoreFill, scoreHex, scoreLabel } from "../lib/colors";
import { useSession } from "../lib/session";
import { useWorkspace } from "../lib/store";
import { Spinner } from "./ui";

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

/** Compact areas filter: one button, a short checklist in a popover. */
export function AreasDropdown({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const meta = useSession((s) => s.meta);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const regions = meta?.regions ?? [];
  const label =
    value.length === 0 ? "All of Sydney"
      : value.length === 1 ? regions.find((r) => r.key === value[0])?.label ?? "1 area"
        : `${value.length} areas`;

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", esc); };
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="listbox"
        className="inline-flex items-center gap-1.5 h-8 pl-3 pr-2 rounded-full border border-bg-border bg-white text-sm font-medium hover:border-[rgba(36,60,76,0.32)]"
      >
        {label} <ChevronDown size={15} className={`transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true" />
      </button>
      {open && (
        <div className="absolute left-0 top-10 z-30 w-64 bg-white rounded-md border border-bg-border shadow-pop py-1.5" role="listbox" aria-multiselectable="true">
          <button
            role="option"
            aria-selected={value.length === 0}
            onClick={() => onChange([])}
            className="w-full flex items-center justify-between px-3.5 h-10 text-[15px] hover:bg-bg-base"
          >
            All of Sydney {value.length === 0 && <Check size={16} className="text-accent-link" aria-hidden="true" />}
          </button>
          <div className="my-1 border-t border-bg-border" />
          <div className="max-h-64 overflow-y-auto">
            {regions.map((r) => {
              const on = value.includes(r.key);
              return (
                <button
                  key={r.key}
                  role="option"
                  aria-selected={on}
                  onClick={() => onChange(on ? value.filter((x) => x !== r.key) : [...value, r.key])}
                  className="w-full flex items-center justify-between px-3.5 h-10 text-[15px] text-left hover:bg-bg-base"
                >
                  {r.label} {on && <Check size={16} className="text-accent-link" aria-hidden="true" />}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export function SitePanel({ onOpenSite }: { onOpenSite: (h3: string, lat: number, lng: number) => void }) {
  const brand = useSession((s) => s.brand)!;
  const { ranked, loadingRanked, rankedRegions, scenario, set } = useWorkspace();
  const [err, setErr] = useState<string | null>(null);

  const activeRegions = scenario?.regions ?? rankedRegions ?? brand.regions;
  const pri = priParam(scenario?.priorities);
  const key = JSON.stringify([activeRegions, pri, brand.vertical, brand.priorities, brand.stores.length]);

  useEffect(() => {
    set({ loadingRanked: true });
    setErr(null);
    api
      .rankings(10, activeRegions, pri)
      .then((d) => set({ ranked: d.sites }))
      .catch((e) => setErr((e as Error).message))
      .finally(() => set({ loadingRanked: false }));
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    api.shortlist().then((d) => set({ shortlist: d.sites })).catch(() => undefined);
  }, [set]);

  return (
    <div className="h-full flex flex-col">
      <div className="px-5 pt-5 pb-4 border-b border-bg-border">
        <h2 className="text-[22px] leading-tight">Best areas</h2>
        <div className="mt-3 flex items-center gap-2">
          <AreasDropdown
            value={activeRegions}
            onChange={(r) => set(scenario ? { scenario: { ...scenario, regions: r } } : { rankedRegions: r })}
          />
          <span className="text-sm text-fg-tertiary truncate">Top 10 for {brand.name}</span>
        </div>
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
