import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { AlertTriangle, Check, X } from "lucide-react";
import { api, SIGNAL_KEYS, type HexReport } from "../lib/api";
import { fmtDist, scoreHex, scoreLabel } from "../lib/colors";
import { useWorkspace } from "../lib/store";
import { ScoreBar } from "./ScoreBar";
import { Spinner } from "./ui";

export function CompareMode() {
  const { compareOpen, compareIds, set, toggleCompare } = useWorkspace();
  const [reports, setReports] = useState<HexReport[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!compareOpen) return;
    closeRef.current?.focus();
    setReports(null);
    setErr(null);
    api.compare(compareIds).then((d) => setReports(d.reports)).catch((e) => setErr((e as Error).message));
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && set({ compareOpen: false });
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [compareOpen, compareIds.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!compareOpen) return null;
  const best = reports ? Math.max(...reports.map((r) => r.score)) : null;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="fixed inset-0 z-40 bg-[rgba(10,10,10,0.35)] flex"
      role="dialog"
      aria-modal="true"
      aria-labelledby="compare-title"
      onClick={(e) => e.target === e.currentTarget && set({ compareOpen: false })}
    >
      <div className="m-auto w-[min(1180px,calc(100%-24px))] max-h-[calc(100%-24px)] bg-bg-base rounded-md shadow-pop flex flex-col overflow-hidden">
        <div className="flex items-center justify-between gap-4 px-6 h-16 border-b border-bg-border bg-white shrink-0">
          <h2 id="compare-title" className="text-xl font-medium tracking-display">Compare {compareIds.length} sites</h2>
          <button ref={closeRef} className="w-10 h-10 grid place-items-center rounded-sm hover:bg-bg-elevated" onClick={() => set({ compareOpen: false })} aria-label="Close compare">
            <X size={20} />
          </button>
        </div>
        <div className="overflow-auto p-4 sm:p-6">
          {err && <p className="text-danger">{err}</p>}
          {!reports && !err && <div className="grid place-items-center h-64"><Spinner className="text-accent w-6 h-6" /></div>}
          {reports && (
            <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(auto-fit, minmax(280px, 1fr))` }}>
              {reports.map((r) => (
                <article key={r.h3_id} className="card p-5 flex flex-col">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h3 className="text-lg font-medium tracking-display">{r.locality ?? "Sydney"}</h3>
                      {r.score === best && reports.length > 1 && (
                        <span className="inline-block mt-1 text-[13px] font-medium text-accent bg-accent-soft rounded-full px-2 py-0.5">Highest score</span>
                      )}
                    </div>
                    <button className="text-sm link shrink-0" onClick={() => toggleCompare(r.h3_id)}>Remove</button>
                  </div>
                  <div className="mt-4 flex items-baseline gap-2">
                    <span className="text-[44px] leading-none font-medium tabular tracking-display" style={{ color: scoreHex(r.score) }}>{r.score}</span>
                    <span className="text-fg-tertiary">/100 · {scoreLabel(r.score)}</span>
                  </div>
                  <div className="mt-5 space-y-3">
                    {SIGNAL_KEYS.map((k) => <ScoreBar key={k} name={k} value={r.components[k]} />)}
                  </div>
                  <dl className="mt-5 pt-4 border-t border-bg-border grid grid-cols-2 gap-y-2 text-sm">
                    <dt className="text-fg-tertiary">Competitors, 500 m</dt><dd className="text-right tabular">{r.signals_raw.n_competitors}</dd>
                    <dt className="text-fg-tertiary">Nearest transit</dt><dd className="text-right tabular">{fmtDist(r.signals_raw.d_transit_m)}</dd>
                    <dt className="text-fg-tertiary">Nearest anchor</dt><dd className="text-right tabular">{fmtDist(r.signals_raw.d_anchor_m)}</dd>
                    <dt className="text-fg-tertiary">Your nearest store</dt><dd className="text-right tabular">{fmtDist(r.signals_raw.d_cannibal_m)}</dd>
                  </dl>
                  <ul className="mt-4 space-y-1.5 text-sm">
                    {r.reasons.slice(0, 2).map((x) => <li key={x} className="flex gap-2"><Check size={16} className="text-score-strong shrink-0 mt-0.5" aria-hidden="true" />{x}</li>)}
                    {r.risks.map((x) => <li key={x} className="flex gap-2"><AlertTriangle size={15} className="text-score-weak shrink-0 mt-0.5" aria-label="Risk" />{x}</li>)}
                  </ul>
                </article>
              ))}
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}
