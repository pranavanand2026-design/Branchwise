// Brand-profile editors, shared by onboarding and settings.
import { useEffect, useMemo, useState } from "react";
import { Check, MapPin, Search, X } from "lucide-react";
import {
  api, SIGNAL_KEYS,
  type BrandInput, type Place, type SignalKey, type StoreCountBand, type StoreFormat, type StoreLoc,
} from "../lib/api";
import { useSession } from "../lib/session";
import { Spinner, TextField } from "./ui";

export const FORMATS: { value: StoreFormat; label: string; detail: string }[] = [
  { value: "kiosk", label: "Kiosk", detail: "A counter in a centre or station" },
  { value: "takeaway", label: "Takeaway shopfront", detail: "Small shop, mostly grab-and-go" },
  { value: "cafe", label: "Café", detail: "Seating, people stay a while" },
  { value: "restaurant", label: "Restaurant", detail: "Table service, longer visits" },
];

export const COUNT_BANDS: StoreCountBand[] = ["1", "2-5", "6-20", "21-50", "50+"];

export const IMPORTANCE = ["Not important", "A little", "Somewhat", "Very", "Critical"];

/** Suggested starting priorities per store format (the operator can change every one). */
export const FORMAT_PRIORITIES: Record<StoreFormat, Record<SignalKey, number>> = {
  kiosk: { demographic_match: 4, surrounding_amenities: 3, transit_accessibility: 4, market_saturation: 2, cannibalisation: 2 },
  takeaway: { demographic_match: 3, surrounding_amenities: 3, transit_accessibility: 3, market_saturation: 3, cannibalisation: 2 },
  cafe: { demographic_match: 3, surrounding_amenities: 2, transit_accessibility: 2, market_saturation: 3, cannibalisation: 2 },
  restaurant: { demographic_match: 2, surrounding_amenities: 2, transit_accessibility: 1, market_saturation: 3, cannibalisation: 3 },
};

const MULT = [0, 1, 2, 3.5, 5];
export function previewWeights(p: Record<SignalKey, number>): Record<SignalKey, number> {
  const raw = SIGNAL_KEYS.map((k) => MULT[p[k] ?? 2]);
  const total = raw.reduce((a, b) => a + b, 0) || 1;
  return Object.fromEntries(SIGNAL_KEYS.map((k, i) => [k, Math.round((raw[i] / total) * 100)])) as Record<SignalKey, number>;
}

// ─── Brand basics ───────────────────────────────────────────────────────────

export function BrandBasics({
  draft, onChange, errors, simple = false,
}: {
  draft: BrandInput;
  onChange: (d: BrandInput) => void;
  errors: Partial<Record<string, string>>;
  /** onboarding: name, what you sell and format only */
  simple?: boolean;
}) {
  const meta = useSession((s) => s.meta);
  return (
    <div className="space-y-8">
      <TextField
        label="Brand name"
        value={draft.name}
        onChange={(e) => onChange({ ...draft, name: e.target.value })}
        error={errors.name}
        maxLength={120}
        autoComplete="organization"
        hint="As it appears on your shopfronts. We use it to find your existing stores."
      />

      <fieldset>
        <legend className="field-label">What you sell</legend>
        {errors.vertical && <p className="field-error mb-2">{errors.vertical}</p>}
        <div className="grid sm:grid-cols-2 gap-3 mt-1">
          {meta?.verticals.map((v) => (
            <ChoiceCard
              key={v.key}
              name="vertical"
              checked={draft.vertical === v.key}
              onSelect={() => onChange({ ...draft, vertical: v.key })}
              title={v.label}
              detail={v.blurb}
            />
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend className="field-label">Store format</legend>
        <div className="grid sm:grid-cols-2 gap-3 mt-1">
          {FORMATS.map((f) => (
            <ChoiceCard
              key={f.value}
              name="format"
              checked={draft.store_format === f.value}
              onSelect={() => onChange({ ...draft, store_format: f.value })}
              title={f.label}
              detail={f.detail}
            />
          ))}
        </div>
      </fieldset>

      {!simple && <>
      <fieldset>
        <legend className="field-label">Stores open today</legend>
        <div className="flex flex-wrap gap-2 mt-1">
          {COUNT_BANDS.map((b) => (
            <button
              type="button"
              key={b}
              aria-pressed={draft.store_count_band === b}
              onClick={() => onChange({ ...draft, store_count_band: b })}
              className={`h-10 min-w-[64px] px-4 rounded-sm border text-[15px] font-medium tabular transition-colors ${
                draft.store_count_band === b
                  ? "border-accent-blue bg-accent-soft text-accent-link"
                  : "border-bg-border bg-white text-fg-secondary hover:border-[rgba(36,60,76,0.32)]"
              }`}
            >
              {b}
            </button>
          ))}
        </div>
      </fieldset>

      <div>
        <label htmlFor="desc" className="field-label">Describe your business</label>
        <textarea
          id="desc"
          rows={3}
          maxLength={1000}
          value={draft.description ?? ""}
          onChange={(e) => onChange({ ...draft, description: e.target.value })}
          className="field-input h-auto py-3 leading-relaxed resize-y"
        />
        <p className="field-hint">Optional. Who comes in, when, and what they order. Saved to your profile for future features.</p>
      </div>
      </>}
    </div>
  );
}

function ChoiceCard({
  name, checked, onSelect, title, detail,
}: { name: string; checked: boolean; onSelect: () => void; title: string; detail: string }) {
  return (
    <label
      className={`relative flex items-start gap-3 p-4 rounded-sm border cursor-pointer transition-[border-color,background-color,transform] hover:-translate-y-px ${
        checked ? "border-accent bg-accent-soft" : "border-bg-border bg-white hover:border-[rgba(36,60,76,0.32)]"
      }`}
    >
      <input type="radio" name={name} value={title} checked={checked} onChange={onSelect} className="sr-only" aria-label={`${title}: ${detail}`} />
      <span
        className={`mt-0.5 w-5 h-5 shrink-0 rounded-full border grid place-items-center ${
          checked ? "border-accent bg-accent" : "border-[rgba(36,60,76,0.32)]"
        }`}
        aria-hidden="true"
      >
        {checked && <Check size={12} className="text-white" strokeWidth={3} />}
      </span>
      <span>
        <span className="block text-[15px] font-medium text-fg-primary">{title}</span>
        <span className="block text-sm text-fg-tertiary mt-0.5">{detail}</span>
      </span>
    </label>
  );
}

// ─── Existing stores ────────────────────────────────────────────────────────

export function StorePicker({
  brandName, stores, onChange,
}: { brandName: string; stores: StoreLoc[]; onChange: (s: StoreLoc[]) => void }) {
  const [q, setQ] = useState(brandName);
  const [results, setResults] = useState<Place[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const selectedIds = useMemo(() => new Set(stores.map((s) => s.fsq_place_id).filter(Boolean)), [stores]);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setResults([]);
      return;
    }
    let live = true;
    setBusy(true);
    const t = setTimeout(() => {
      api
        .searchPlaces(term)
        .then((r) => live && (setResults(r.places), setErr(null)))
        .catch((e) => live && setErr((e as Error).message))
        .finally(() => live && setBusy(false));
    }, 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [q]);

  const toggle = (p: Place) => {
    if (selectedIds.has(p.fsq_place_id)) onChange(stores.filter((s) => s.fsq_place_id !== p.fsq_place_id));
    else onChange([...stores, { name: p.name, lat: p.lat, lng: p.lng, locality: p.locality, fsq_place_id: p.fsq_place_id }]);
  };
  const unselected = results.filter((p) => !selectedIds.has(p.fsq_place_id));

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div>
        <label htmlFor="store-q" className="field-label">Search Sydney places by name</label>
        <div className="relative">
          <Search size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-fg-tertiary" aria-hidden="true" />
          <input
            id="store-q"
            className="field-input pl-10"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            autoComplete="off"
            maxLength={60}
          />
          {busy && <Spinner className="absolute right-3.5 top-1/2 -translate-y-1/2 text-fg-tertiary" />}
        </div>
        {err && <p className="field-error">{err}</p>}
        <div className="mt-3 flex items-center justify-between">
          <span className="label" aria-live="polite">
            {q.trim().length < 2 ? "Type at least two letters" : `${results.length} place${results.length === 1 ? "" : "s"} found`}
          </span>
          {unselected.length > 1 && (
            <button type="button" className="text-sm font-medium link" onClick={() => onChange([
              ...stores,
              ...unselected.map((p) => ({ name: p.name, lat: p.lat, lng: p.lng, locality: p.locality, fsq_place_id: p.fsq_place_id })),
            ])}>
              Add all {unselected.length}
            </button>
          )}
        </div>
        <ul className="mt-2 max-h-[340px] overflow-y-auto rounded-sm border border-bg-border bg-white divide-y divide-bg-border">
          {results.length === 0 && q.trim().length >= 2 && !busy && (
            <li className="p-4 text-sm text-fg-tertiary">No places with that name. Try a shorter spelling.</li>
          )}
          {results.map((p) => {
            const on = selectedIds.has(p.fsq_place_id);
            return (
              <li key={p.fsq_place_id}>
                <button
                  type="button"
                  onClick={() => toggle(p)}
                  aria-pressed={on}
                  className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-bg-base transition-colors"
                >
                  <span className={`w-5 h-5 shrink-0 rounded-[5px] border grid place-items-center ${on ? "bg-accent border-accent" : "border-[rgba(36,60,76,0.32)]"}`} aria-hidden="true">
                    {on && <Check size={12} className="text-white" strokeWidth={3} />}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[15px] text-fg-primary truncate">{p.name}</span>
                    <span className="block text-sm text-fg-tertiary truncate">
                      {[p.locality, p.primary_category].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      <div>
        <div className="flex items-baseline justify-between">
          <span className="field-label">Your stores</span>
          <span className="label tabular">{stores.length} added</span>
        </div>
        {stores.length === 0 ? (
          <div className="rounded-sm border border-dashed border-[rgba(10,10,10,0.2)] p-6 text-sm text-fg-tertiary leading-relaxed">
            Pick your stores from the search results. Branchwise uses them to keep new sites from taking
            customers off your own shops. Opening your first store? Leave this empty.
          </div>
        ) : (
          <ul className="rounded-sm border border-bg-border bg-white divide-y divide-bg-border max-h-[396px] overflow-y-auto">
            {stores.map((s, i) => (
              <li key={s.fsq_place_id ?? `${s.lat},${s.lng},${i}`} className="flex items-center gap-3 px-4 py-3">
                <MapPin size={16} className="text-accent shrink-0" aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] truncate">{s.name}</span>
                  <span className="block text-sm text-fg-tertiary truncate">{s.locality ?? "Sydney"}</span>
                </span>
                <button
                  type="button"
                  onClick={() => onChange(stores.filter((_, j) => j !== i))}
                  className="w-9 h-9 grid place-items-center rounded-sm text-fg-tertiary hover:text-fg-primary hover:bg-bg-elevated"
                  aria-label={`Remove ${s.name}`}
                >
                  <X size={16} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// ─── Priorities ─────────────────────────────────────────────────────────────

export function PriorityEditor({
  priorities, onChange, hasStores,
}: { priorities: Record<SignalKey, number>; onChange: (p: Record<SignalKey, number>) => void; hasStores: boolean }) {
  const meta = useSession((s) => s.meta);
  const weights = previewWeights(priorities);
  return (
    <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_280px]">
      <div className="space-y-7">
        {meta?.signals.map((s) => (
          <fieldset key={s.key}>
            <legend className="text-base font-medium text-fg-primary">{s.question}</legend>
            <p className="text-sm text-fg-tertiary mt-1">
              {s.detail}
              {s.key === "cannibalisation" && !hasStores && " You haven't added stores, so this has no effect yet."}
            </p>
            <div className="mt-3 grid grid-cols-5 gap-1.5" role="radiogroup" aria-label={s.label}>
              {IMPORTANCE.map((label, i) => {
                const on = priorities[s.key] === i;
                return (
                  <button
                    type="button"
                    role="radio"
                    aria-checked={on}
                    key={i}
                    onClick={() => onChange({ ...priorities, [s.key]: i })}
                    className={`h-11 px-1 rounded-sm border text-[13px] font-medium leading-tight transition-colors ${
                      on ? "border-accent bg-accent text-white" : "border-bg-border bg-white text-fg-secondary hover:border-[rgba(36,60,76,0.32)]"
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </fieldset>
        ))}
      </div>
      <aside className="lg:sticky lg:top-6 self-start card p-5">
        <h3 className="text-base font-medium">How your score adds up</h3>
        <p className="text-sm text-fg-tertiary mt-1">Each site's score out of 100 uses these weights.</p>
        <ul className="mt-5 space-y-3.5">
          {meta?.signals.map((s) => (
            <li key={s.key}>
              <div className="flex justify-between text-sm">
                <span className="text-fg-secondary">{s.label}</span>
                <span className="tabular font-medium">{weights[s.key]}%</span>
              </div>
              <div className="mt-1.5 h-1.5 rounded-full bg-bg-elevated overflow-hidden">
                <div className="h-full rounded-full bg-accent transition-[width] duration-300" style={{ width: `${weights[s.key]}%` }} />
              </div>
            </li>
          ))}
        </ul>
      </aside>
    </div>
  );
}

// ─── Areas ──────────────────────────────────────────────────────────────────

export function AreaPicker({ regions, onChange }: { regions: string[]; onChange: (r: string[]) => void }) {
  const meta = useSession((s) => s.meta);
  const all = regions.length === 0;
  return (
    <div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          aria-pressed={all}
          onClick={() => onChange([])}
          className={`h-11 px-4 rounded-full border text-[15px] font-medium transition-colors ${
            all ? "border-accent bg-accent text-white" : "border-bg-border bg-white text-fg-secondary hover:border-[rgba(36,60,76,0.32)]"
          }`}
        >
          All of Sydney
        </button>
        {meta?.regions.map((r) => {
          const on = regions.includes(r.key);
          return (
            <button
              type="button"
              key={r.key}
              aria-pressed={on}
              onClick={() => onChange(on ? regions.filter((x) => x !== r.key) : [...regions, r.key])}
              className={`h-11 px-4 rounded-full border text-[15px] font-medium transition-colors inline-flex items-center gap-2 ${
                on ? "border-accent-blue bg-accent-soft text-accent-link" : "border-bg-border bg-white text-fg-secondary hover:border-[rgba(36,60,76,0.32)]"
              }`}
            >
              {on && <Check size={15} strokeWidth={2.5} aria-hidden="true" />}
              {r.label}
            </button>
          );
        })}
      </div>
      <p className="field-hint mt-4">
        Your ranked list sticks to these areas. The map still scores all of Sydney, so you can look anywhere.
      </p>
    </div>
  );
}

// ─── Top priorities (onboarding: pick up to three) ──────────────────────────

const SIGNAL_COPY: Record<SignalKey, { title: string; detail: string; icon: string }> = {
  demographic_match: { title: "Busy streets", detail: "Lots of shops and people walking past", icon: "M7 7a2.5 2.5 0 1 0 0-.01M17 8a2 2 0 1 0 0-.01M3 20c.8-3.6 3-5.5 5.5-5.5S13.2 16.4 14 20M14 19.5c.6-2.6 2-4 3.6-4s3 1.4 3.4 4" },
  surrounding_amenities: { title: "Near unis, malls and offices", detail: "Places that bring a crowd every day", icon: "M3 21h18M5 21V9l7-5 7 5v12M9 21v-6h6v6" },
  transit_accessibility: { title: "Close to a station", detail: "Customers arrive by train, metro or bus", icon: "M6 3h12a2 2 0 0 1 2 2v9a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V5a2 2 0 0 1 2-2zM4 10h16M8 21l2-4M16 21l-2-4" },
  market_saturation: { title: "Few competitors", detail: "Room to be the go-to spot nearby", icon: "M12 3l8 4v6c0 4.4-3.4 7.4-8 8-4.6-.6-8-3.6-8-8V7z" },
  cannibalisation: { title: "Away from my stores", detail: "Don't take customers off my own shops", icon: "M12 21s-6-5.6-6-10a6 6 0 0 1 12 0c0 4.4-6 10-6 10zM12 11.5a1.5 1.5 0 1 0 0-.01" },
};

/** Top three = "very important" (4), the rest = "a little" (1). */
export function prioritiesFromTop(top: SignalKey[]): Record<SignalKey, number> {
  return Object.fromEntries(SIGNAL_KEYS.map((k) => [k, top.includes(k) ? 4 : 1])) as Record<SignalKey, number>;
}

export function topFromPriorities(p: Record<SignalKey, number>): SignalKey[] {
  return SIGNAL_KEYS.filter((k) => (p[k] ?? 0) >= 3).sort((a, b) => p[b] - p[a]).slice(0, 3);
}

export function TopPriorities({
  value, onChange, hasStores,
}: { value: SignalKey[]; onChange: (v: SignalKey[]) => void; hasStores: boolean }) {
  const keys = SIGNAL_KEYS.filter((k) => hasStores || k !== "cannibalisation");
  const full = value.length >= 3;
  return (
    <div>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3" role="group" aria-label="What matters most">
        {keys.map((k) => {
          const on = value.includes(k);
          const c = SIGNAL_COPY[k];
          const disabled = !on && full;
          return (
            <button
              type="button"
              key={k}
              aria-pressed={on}
              disabled={disabled}
              onClick={() => onChange(on ? value.filter((x) => x !== k) : [...value, k])}
              className={`relative text-left p-5 rounded-md border transition-[border-color,background-color,transform,opacity] ${
                on ? "border-accent-blue bg-accent-soft" : "border-bg-border bg-white hover:-translate-y-px hover:border-[rgba(36,60,76,0.32)]"
              } ${disabled ? "opacity-45 cursor-not-allowed hover:translate-y-0" : ""}`}
            >
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke={on ? "#2E6A93" : "#243C4C"} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={c.icon} /></svg>
              <span className="block mt-3 font-display text-lg text-fg-primary">{c.title}</span>
              <span className="block mt-1 text-sm text-fg-tertiary">{c.detail}</span>
              {on && (
                <span className="absolute top-4 right-4 w-6 h-6 rounded-full bg-accent text-white grid place-items-center text-[13px] font-medium tabular" aria-hidden="true">
                  {value.indexOf(k) + 1}
                </span>
              )}
            </button>
          );
        })}
      </div>
      <p className="mt-4 text-sm text-fg-tertiary" aria-live="polite">
        {value.length === 0 ? "Pick up to three." : full ? "That's three. Tap one to swap it." : `${3 - value.length} more if you like.`}
      </p>
    </div>
  );
}
