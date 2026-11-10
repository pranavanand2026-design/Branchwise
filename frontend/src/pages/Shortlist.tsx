import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bookmark, Columns3, MapPin, Trash2 } from "lucide-react";
import { api, type SavedSite } from "../lib/api";
import { scoreLabel } from "../lib/colors";
import { useWorkspace } from "../lib/store";
import { ScoreBadge } from "../components/SitePanel";
import { CompareMode } from "../components/CompareMode";
import { Spinner } from "../components/ui";

export function ShortlistPage() {
  const nav = useNavigate();
  const { shortlist, compareIds, toggleCompare, set, flyToLocation } = useWorkspace();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.shortlist().then((d) => set({ shortlist: d.sites })).finally(() => setLoading(false));
  }, [set]);

  const openOnMap = (s: SavedSite) => {
    flyToLocation(s.lat, s.lng, 14.6);
    set({ pendingOpen: s.h3_id });
    nav("/");
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-[1040px] mx-auto px-6 py-10">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-[36px] leading-tight">Your shortlist</h1>
            <p className="mt-2 text-fg-secondary">
              Areas you've saved, with today's score and your notes. Tick two or three to compare them.
            </p>
          </div>
          {compareIds.length > 0 && (
            <button className="btn-primary" onClick={() => set({ compareOpen: true })} disabled={compareIds.length < 2}>
              <Columns3 size={18} aria-hidden="true" /> Compare {compareIds.length}
            </button>
          )}
        </div>

        {loading ? (
          <div className="mt-16 grid place-items-center text-accent-link"><Spinner className="w-6 h-6" /></div>
        ) : shortlist.length === 0 ? (
          <div className="mt-12 card p-10 text-center">
            <Bookmark size={28} className="mx-auto text-fg-tertiary" aria-hidden="true" />
            <h2 className="mt-4 text-xl">Nothing saved yet</h2>
            <p className="mt-2 text-fg-secondary max-w-md mx-auto">
              Open an area on the map and press Save to shortlist, or ask the assistant to save its picks.
            </p>
            <button className="btn-secondary mt-6" onClick={() => nav("/")}>Go to the map</button>
          </div>
        ) : (
          <ul className="mt-8 grid gap-4 sm:grid-cols-2">
            {shortlist.map((s) => (
              <SavedCard
                key={s.id}
                s={s}
                inCompare={compareIds.includes(s.h3_id)}
                onCompare={() => toggleCompare(s.h3_id)}
                onOpen={() => openOnMap(s)}
              />
            ))}
          </ul>
        )}
      </div>
      <CompareMode />
    </div>
  );
}

function SavedCard({ s, inCompare, onCompare, onOpen }: { s: SavedSite; inCompare: boolean; onCompare: () => void; onOpen: () => void }) {
  const { shortlist, set } = useWorkspace();
  const [editing, setEditing] = useState(false);
  const [note, setNote] = useState(s.note ?? "");
  const score = s.score ?? s.score_at_save;

  async function saveNote() {
    const updated = await api.updateSite(s.id, note.trim() || null);
    set({ shortlist: shortlist.map((x) => (x.id === s.id ? { ...x, note: updated.note } : x)) });
    setEditing(false);
  }

  return (
    <li className={`card p-5 flex flex-col gap-4 transition-shadow ${inCompare ? "ring-2 ring-accent-blue" : ""}`}>
      <div className="flex items-start gap-4">
        <ScoreBadge score={score} size="lg" />
        <div className="flex-1 min-w-0">
          <h2 className="text-[22px] leading-tight truncate">{s.locality ?? "Sydney"}</h2>
          <p className="mt-1 text-sm text-fg-tertiary">
            {scoreLabel(score)} · saved {new Date(s.created_at).toLocaleDateString("en-AU", { day: "numeric", month: "short" })}
            {score !== s.score_at_save && ` · was ${s.score_at_save}`}
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm text-fg-secondary cursor-pointer select-none">
          <input type="checkbox" className="w-4 h-4 accent-[#243C4C]" checked={inCompare} onChange={onCompare} />
          Compare
        </label>
      </div>

      {editing ? (
        <div>
          <label htmlFor={`note-${s.id}`} className="sr-only">Note</label>
          <textarea id={`note-${s.id}`} className="field-input h-auto py-2.5 text-[15px]" rows={3} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} autoFocus />
          <div className="mt-2 flex gap-2">
            <button className="btn-primary btn-sm" onClick={() => void saveNote()}>Save note</button>
            <button className="btn-quiet btn-sm" onClick={() => setEditing(false)}>Cancel</button>
          </div>
        </div>
      ) : (
        <button className="text-left text-[15px] text-fg-secondary rounded-sm hover:bg-bg-base -mx-2 px-2 py-1.5" onClick={() => setEditing(true)}>
          {s.note || <span className="text-fg-tertiary">Add a note for your team</span>}
        </button>
      )}

      <div className="mt-auto flex items-center justify-between pt-3 border-t border-bg-border">
        <button className="btn-quiet btn-sm -ml-3" onClick={onOpen}>
          <MapPin size={16} aria-hidden="true" /> View on map
        </button>
        <button
          className="w-9 h-9 grid place-items-center rounded-sm text-fg-tertiary hover:text-danger hover:bg-danger-soft"
          aria-label={`Remove ${s.locality ?? "area"} from shortlist`}
          onClick={async () => {
            await api.removeSite(s.id);
            set({ shortlist: shortlist.filter((x) => x.id !== s.id) });
          }}
        >
          <Trash2 size={16} />
        </button>
      </div>
    </li>
  );
}
