import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, Bookmark, BookmarkCheck, Check, Columns3, X } from "lucide-react";
import { api, SIGNAL_KEYS, type HexReport, type NearPoi } from "../lib/api";
import { fmtDist, scoreFill, scoreHex, scoreLabel } from "../lib/colors";
import { useWorkspace } from "../lib/store";
import { ScoreBar } from "./ScoreBar";
import { Spinner } from "./ui";

export function ReportPanel() {
  const { selectedHex: r, loadingReport, set } = useWorkspace();

  useEffect(() => {
    if (!r) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && set({ selectedHex: null });
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [r, set]);

  return (
    <AnimatePresence>
      {(r || loadingReport) && (
        <motion.aside
          key="report"
          initial={{ x: 24, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: 24, opacity: 0 }}
          transition={{ type: "spring", stiffness: 380, damping: 34 }}
          className="absolute right-3 top-3 bottom-3 w-[min(400px,calc(100%-24px))] bg-white rounded-md shadow-pop border border-bg-border flex flex-col overflow-hidden z-20"
          aria-label="Site report"
          data-tour="report"
        >
          {loadingReport && <div className="absolute top-0 inset-x-0 h-0.5 bg-accent/20 overflow-hidden"><div className="h-full w-1/3 bg-accent animate-[slide_1s_linear_infinite]" /></div>}
          {r ? <ReportBody r={r} /> : <Skeleton />}
        </motion.aside>
      )}
    </AnimatePresence>
  );
}

function ReportBody({ r }: { r: HexReport }) {
  const { set, compareIds, toggleCompare, shortlist } = useWorkspace();
  const [saving, setSaving] = useState(false);
  const saved = shortlist.find((s) => s.h3_id === r.h3_id) ?? r.saved;
  const inCompare = compareIds.includes(r.h3_id);
  const sub = [r.postcode, r.region === "New South Wales" ? "NSW" : r.region].filter(Boolean).join(" · ");

  async function toggleSave() {
    setSaving(true);
    try {
      if (saved) {
        await api.removeSite(saved.id);
        set({ shortlist: shortlist.filter((s) => s.id !== saved.id), selectedHex: { ...r, saved: null } });
      } else {
        const s = await api.saveSite(r.h3_id);
        set({ shortlist: [...shortlist, { ...s, score: r.score }], selectedHex: { ...r, saved: s } });
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="flex items-start justify-between gap-3 px-5 pt-5">
        <div className="min-w-0">
          <h2 className="text-[26px] leading-tight truncate">{r.locality ?? "Sydney"}</h2>
          {sub && <p className="text-sm text-fg-tertiary mt-0.5">{sub}</p>}
        </div>
        <button className="w-9 h-9 grid place-items-center rounded-sm text-fg-tertiary hover:bg-bg-elevated hover:text-fg-primary shrink-0" onClick={() => set({ selectedHex: null })} aria-label="Close report">
          <X size={18} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-5 pb-5">
        <span
          className="mt-3 inline-flex items-center gap-2 h-8 px-3 rounded-full text-[15px] font-medium"
          style={{ color: scoreHex(r.score), background: `${scoreFill(r.score)}22` }}
        >
          <span className="w-2 h-2 rounded-full" style={{ background: scoreFill(r.score) }} aria-hidden="true" />
          <span><span className="font-display tabular">{r.score}</span>/100 · {scoreLabel(r.score)}</span>
        </span>

        {r.reasons.length > 0 && (
          <section className="mt-5">
            <h3 className="text-base font-medium font-sans">Why it fits</h3>
            <ul className="mt-2 space-y-2">
              {r.reasons.map((x) => (
                <li key={x} className="flex gap-2.5 text-[15px] leading-snug">
                  <Check size={18} className="text-score-strong shrink-0 mt-px" aria-hidden="true" />
                  {x}
                </li>
              ))}
            </ul>
          </section>
        )}

        {r.risks.length > 0 && (
          <section className="mt-5">
            <h3 className="text-base font-medium font-sans">Worth checking</h3>
            <ul className="mt-2 space-y-2">
              {r.risks.map((x) => (
                <li key={x} className="flex gap-2.5 text-[15px] leading-snug">
                  <AlertTriangle size={17} className="text-score-weak shrink-0 mt-px" aria-hidden="true" />
                  {x}
                </li>
              ))}
            </ul>
          </section>
        )}

        <NearList title="Competitors nearby" items={r.nearest_competitors} empty="None of your direct competitors within 2 km." />
        <NearList title="Unis, malls and offices nearby" items={r.nearest_anchors} empty="No unis, malls, offices or hospitals within 3 km." />
        <NearList title="Stations and stops" items={r.nearest_transit} empty="No station or stop within 2 km." />

        <details className="mt-6 rounded-sm border border-bg-border">
          <summary className="cursor-pointer select-none px-4 py-3 text-[15px] font-medium text-accent-link">Score details</summary>
          <div className="px-4 pb-4">
            <p className="text-sm text-fg-secondary tabular">
              {r.score} out of 100{r.rank != null && `, #${r.rank.toLocaleString()} of ${r.rank_total.toLocaleString()} areas in Sydney`}
            </p>
            <div className="mt-4 space-y-3">
              {SIGNAL_KEYS.map((k) => (
                <ScoreBar key={k} name={k} value={r.components[k]} weight={r.weights[k]} />
              ))}
            </div>
            <div className="mt-4 text-sm leading-relaxed text-fg-secondary">
              <ReactMarkdown
                components={{
                  p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
                  strong: ({ children }) => <strong className="font-medium text-fg-primary">{children}</strong>,
                  ul: ({ children }) => <ul className="space-y-1">{children}</ul>,
                  li: ({ children }) => <li>{children}</li>,
                }}
              >
                {r.summary}
              </ReactMarkdown>
            </div>
          </div>
        </details>
      </div>

      <div className="border-t border-bg-border p-4 grid grid-cols-2 gap-2">
        <button className={saved ? "btn-secondary" : "btn-primary"} onClick={() => void toggleSave()} disabled={saving} data-tour="save">
          {saving ? <Spinner /> : saved ? <BookmarkCheck size={18} aria-hidden="true" /> : <Bookmark size={18} aria-hidden="true" />}
          {saved ? "Saved" : "Save to shortlist"}
        </button>
        <button className="btn-secondary" onClick={() => toggleCompare(r.h3_id)} aria-pressed={inCompare}>
          <Columns3 size={18} aria-hidden="true" />
          {inCompare ? "In compare" : "Add to compare"}
        </button>
      </div>
    </>
  );
}

function NearList({ title, items, empty }: { title: string; items: NearPoi[]; empty: string }) {
  return (
    <section className="mt-6">
      <h3 className="label">{title}</h3>
      {items.length === 0 ? (
        <p className="mt-2 text-[15px] text-fg-tertiary">{empty}</p>
      ) : (
        <ul className="mt-2 divide-y divide-bg-border">
          {items.slice(0, 4).map((c, i) => (
            <li key={`${c.name}-${i}`} className="flex justify-between gap-3 py-2">
              <span className="min-w-0">
                <span className="block text-[15px] truncate">{c.name}</span>
                {c.primary_category && <span className="block text-[13px] text-fg-tertiary truncate">{c.primary_category}</span>}
              </span>
              <span className="text-sm text-fg-tertiary tabular shrink-0 pt-0.5">{fmtDist(c.dist_m)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Skeleton() {
  return (
    <div className="p-5 space-y-5 animate-pulse" aria-label="Loading report">
      <div className="h-6 w-40 bg-bg-elevated rounded" />
      <div className="h-14 w-32 bg-bg-elevated rounded" />
      {[...Array(5)].map((_, i) => (
        <div key={i}>
          <div className="h-3 w-32 bg-bg-elevated rounded mb-2" />
          <div className="h-1.5 bg-bg-elevated rounded-full" />
        </div>
      ))}
    </div>
  );
}
