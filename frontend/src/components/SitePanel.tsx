import { useEffect, useState } from "react";
import { Bookmark, ChevronDown, Trash2 } from "lucide-react";
import { api, type RankedSite, type SavedSite } from "../lib/api";
import { scoreHex, scoreLabel } from "../lib/colors";
import { useSession } from "../lib/session";
import { useWorkspace } from "../lib/store";
import { Segmented, Spinner } from "./ui";

export function SitePanel({ onOpenSite }: { onOpenSite: (h3: string, lat: number, lng: number) => void }) {
  const brand = useSession((s) => s.brand)!;
  const meta = useSession((s) => s.meta);
  const { panelTab, ranked, loadingRanked, rankedRegions, shortlist, set } = useWorkspace();
  const [err, setErr] = useState<string | null>(null);
  const [areasOpen, setAreasOpen] = useState(false);

  const activeRegions = rankedRegions ?? brand.regions;
  const regionKey = activeRegions.join(",");
  const profileKey = JSON.stringify([brand.vertical, brand.priorities, brand.stores.length]);

  useEffect(() => {
    set({ loadingRanked: true });
    setErr(null);
    api
      .rankings(10, activeRegions)
      .then((d) => set({ ranked: d.sites }))
      .catch((e) => setErr((e as Error).message))
      .finally(() => set({ loadingRanked: false }));
  }, [regionKey, profileKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    api.shortlist().then((d) => set({ shortlist: d.sites })).catch(() => undefined);
  }, [profileKey, set]);

  const regionNames = activeRegions.map((r) => meta?.regions.find((x) => x.key === r)?.label ?? r);

  return (
    <div className="h-full flex flex-col">
      <div className="p-4 pb-3 border-b border-bg-border">
        <Segmented
          label="Site lists"
          value={panelTab}
          onChange={(v) => set({ panelTab: v })}
          options={[
            { value: "ranked", label: "Best areas" },
            { value: "shortlist", label: `Shortlist${shortlist.length ? ` (${shortlist.length})` : ""}` },
          ]}
        />
        {panelTab === "ranked" && (
          <div className="mt-3">
            <button
              className="w-full flex items-center justify-between gap-2 text-left text-sm rounded-sm px-1 py-1 hover:bg-bg-base"
              onClick={() => setAreasOpen((o) => !o)}
              aria-expanded={areasOpen}
            >
              <span className="min-w-0 truncate">
                <span className="text-fg-tertiary">Areas: </span>
                <span className="font-medium">{regionNames.length ? regionNames.join(", ") : "All of Sydney"}</span>
              </span>
              <ChevronDown size={16} className={`shrink-0 transition-transform ${areasOpen ? "rotate-180" : ""}`} aria-hidden="true" />
            </button>
            {areasOpen && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                <Chip on={activeRegions.length === 0} onClick={() => set({ rankedRegions: [] })}>All of Sydney</Chip>
                {meta?.regions.map((r) => {
                  const on = activeRegions.includes(r.key);
                  return (
                    <Chip key={r.key} on={on} onClick={() => set({ rankedRegions: on ? activeRegions.filter((x) => x !== r.key) : [...activeRegions, r.key] })}>
                      {r.label}
                    </Chip>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        {panelTab === "ranked" ? (
          loadingRanked && ranked.length === 0 ? (
            <div className="grid place-items-center h-40 text-accent"><Spinner className="w-5 h-5" /></div>
          ) : err ? (
            <p className="p-4 text-danger text-sm">{err}</p>
          ) : ranked.length === 0 ? (
            <p className="p-4 text-[15px] text-fg-tertiary">No scored zones in these areas. Add another area above.</p>
          ) : (
            <ol className={`divide-y divide-bg-border ${loadingRanked ? "opacity-60" : ""}`} data-tour="ranked">
              {ranked.map((s) => <RankedRow key={s.h3_id} s={s} onOpen={onOpenSite} />)}
            </ol>
          )
        ) : (
          <ShortlistView onOpen={onOpenSite} />
        )}
      </div>
    </div>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={on}
      className={`h-8 px-3 rounded-full border text-[13px] font-medium transition-colors ${
        on ? "border-accent bg-accent-soft text-accent" : "border-bg-border text-fg-secondary hover:border-[rgba(10,10,10,0.3)]"
      }`}
    >
      {children}
    </button>
  );
}

function FitChip({ score }: { score: number }) {
  return (
    <span className="inline-flex items-center gap-1.5 h-6 px-2.5 rounded-full text-[13px] font-medium whitespace-nowrap"
      style={{ color: scoreHex(score), background: `${scoreHex(score)}14` }}>
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: scoreHex(score) }} aria-hidden="true" />
      {scoreLabel(score)}
    </span>
  );
}

function RankedRow({ s, onOpen }: { s: RankedSite; onOpen: (h3: string, lat: number, lng: number) => void }) {
  const { selectedHex, hoveredHex, shortlist, set } = useWorkspace();
  const active = selectedHex?.h3_id === s.h3_id;
  const hovered = hoveredHex === s.h3_id;
  const saved = shortlist.some((x) => x.h3_id === s.h3_id);
  const why = s.reasons[0];
  return (
    <li
      className={`transition-colors ${active ? "bg-accent-soft" : hovered ? "bg-bg-base" : ""}`}
      onMouseEnter={() => set({ hoveredHex: s.h3_id })}
      onMouseLeave={() => set({ hoveredHex: null })}
    >
      <button className="w-full text-left px-4 py-3.5 flex items-start gap-3" onClick={() => onOpen(s.h3_id, s.lat, s.lng)} aria-current={active ? "true" : undefined}>
        <span className="w-7 h-7 shrink-0 grid place-items-center rounded-full bg-brand-navy text-white text-[13px] font-medium tabular mt-0.5">{s.rank}</span>
        <span className="flex-1 min-w-0">
          <span className="flex items-center gap-2">
            <span className="font-display text-[17px] truncate">{s.locality ?? "Sydney"}</span>
            {saved && <Bookmark size={13} className="shrink-0 text-accent-link fill-accent-link" aria-label="Saved" />}
          </span>
          {why && <span className="block mt-0.5 text-sm text-fg-secondary leading-snug line-clamp-2">{why}</span>}
        </span>
        <FitChip score={s.score} />
      </button>
    </li>
  );
}

function ShortlistView({ onOpen }: { onOpen: (h3: string, lat: number, lng: number) => void }) {
  const { shortlist, set, compareIds, toggleCompare } = useWorkspace();
  const [editing, setEditing] = useState<string | null>(null);
  const [note, setNote] = useState("");

  if (shortlist.length === 0)
    return (
      <div className="p-6 text-[15px] text-fg-tertiary leading-relaxed" data-tour="shortlist">
        Sites you save show up here, with their score today and a note for your team. Open a site and press
        <span className="text-fg-primary"> Save to shortlist</span>.
      </div>
    );

  async function saveNote(s: SavedSite) {
    const updated = await api.updateSite(s.id, note.trim() || null);
    set({ shortlist: shortlist.map((x) => (x.id === s.id ? { ...x, note: updated.note } : x)) });
    setEditing(null);
  }

  return (
    <ul className="divide-y divide-bg-border" data-tour="shortlist">
      {shortlist.map((s) => {
        const score = s.score ?? s.score_at_save;
        const drift = score - s.score_at_save;
        return (
          <li key={s.id} className="p-4">
            <div className="flex items-center gap-3">
              <button className="flex-1 min-w-0 text-left" onClick={() => onOpen(s.h3_id, s.lat, s.lng)}>
                <span className="block text-[15px] font-medium truncate hover:underline">{s.locality ?? "Sydney"}</span>
                <span className="block text-[13px] text-fg-tertiary">
                  Saved {new Date(s.created_at).toLocaleDateString("en-AU", { day: "numeric", month: "short" })}
                  {drift !== 0 && ` · fit has changed`}
                </span>
              </button>
              <FitChip score={score} />
              <input
                type="checkbox"
                className="w-4 h-4 accent-[#243C4C]"
                checked={compareIds.includes(s.h3_id)}
                onChange={() => toggleCompare(s.h3_id)}
                aria-label={`Compare ${s.locality ?? "site"}`}
              />
            </div>
            {editing === s.id ? (
              <div className="mt-2">
                <label htmlFor={`note-${s.id}`} className="sr-only">Note</label>
                <textarea id={`note-${s.id}`} className="field-input h-auto py-2 text-sm" rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} autoFocus />
                <div className="mt-2 flex gap-2">
                  <button className="btn-primary btn-sm" onClick={() => void saveNote(s)}>Save note</button>
                  <button className="btn-quiet btn-sm" onClick={() => setEditing(null)}>Cancel</button>
                </div>
              </div>
            ) : (
              <div className="mt-1.5 flex items-start justify-between gap-2">
                <button className="text-sm text-left text-fg-secondary hover:text-fg-primary" onClick={() => { setEditing(s.id); setNote(s.note ?? ""); }}>
                  {s.note ? s.note : <span className="text-fg-tertiary">Add a note</span>}
                </button>
                <button
                  className="w-8 h-8 grid place-items-center rounded-sm text-fg-tertiary hover:text-danger hover:bg-danger-soft shrink-0"
                  aria-label={`Remove ${s.locality ?? "site"} from shortlist`}
                  onClick={async () => {
                    await api.removeSite(s.id);
                    set({ shortlist: shortlist.filter((x) => x.id !== s.id) });
                  }}
                >
                  <Trash2 size={15} />
                </button>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
