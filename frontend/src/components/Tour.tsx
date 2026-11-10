// First-run product tour: a spotlight on one part of the workspace at a time.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

export type TourStep = {
  target: string; // value of data-tour
  title: string;
  body: string;
  before?: () => void | Promise<void>; // e.g. open a report so its panel exists
};

type Rect = { top: number; left: number; width: number; height: number };

export function Tour({ steps, onDone }: { steps: TourStep[]; onDone: () => void }) {
  const [i, setI] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const step = steps[i];

  const measure = useCallback(() => {
    const el = document.querySelector<HTMLElement>(`[data-tour="${step.target}"]`);
    if (!el) return setRect(null);
    const r = el.getBoundingClientRect();
    setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
  }, [step.target]);

  useEffect(() => {
    let live = true;
    Promise.resolve(step.before?.()).then(() => {
      // let panels finish their entrance before measuring
      setTimeout(() => live && measure(), 350);
    });
    return () => {
      live = false;
    };
  }, [i]); // eslint-disable-line react-hooks/exhaustive-deps

  useLayoutEffect(() => {
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [measure]);

  useEffect(() => {
    cardRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onDone();
      if (e.key === "ArrowRight") setI((x) => Math.min(steps.length - 1, x + 1));
      if (e.key === "ArrowLeft") setI((x) => Math.max(0, x - 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [i, onDone, steps.length]);

  const pad = 6;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const cardW = Math.min(340, vw - 24);
  let cardStyle: React.CSSProperties = { left: (vw - cardW) / 2, top: vh / 2 - 100, width: cardW };
  if (rect) {
    const spaceRight = vw - (rect.left + rect.width);
    if (spaceRight > cardW + 32) cardStyle = { left: rect.left + rect.width + 16, top: Math.max(12, Math.min(rect.top, vh - 260)), width: cardW };
    else if (rect.left > cardW + 32) cardStyle = { left: rect.left - cardW - 16, top: Math.max(12, Math.min(rect.top, vh - 260)), width: cardW };
    else cardStyle = { left: (vw - cardW) / 2, top: Math.min(vh - 240, rect.top + rect.height + 16), width: cardW };
  }

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-labelledby="tour-title">
      {rect ? (
        <div
          className="absolute rounded-md pointer-events-none transition-all duration-300"
          style={{
            top: rect.top - pad, left: rect.left - pad, width: rect.width + pad * 2, height: rect.height + pad * 2,
            boxShadow: "0 0 0 9999px rgba(10,10,10,0.55)", outline: "2px solid #fff",
          }}
        />
      ) : (
        <div className="absolute inset-0 bg-[rgba(10,10,10,0.55)]" />
      )}
      <div ref={cardRef} tabIndex={-1} className="absolute bg-white rounded-md shadow-pop p-5 outline-none transition-all duration-300" style={cardStyle}>
        <p className="label tabular">{i + 1} of {steps.length}</p>
        <h2 id="tour-title" className="mt-1 text-lg font-medium tracking-display">{step.title}</h2>
        <p className="mt-2 text-[15px] text-fg-secondary leading-relaxed">{step.body}</p>
        <div className="mt-5 flex items-center justify-between">
          <button className="text-sm text-fg-tertiary hover:text-fg-primary" onClick={onDone}>Skip tour</button>
          <div className="flex gap-2">
            {i > 0 && <button className="btn-quiet btn-sm" onClick={() => setI(i - 1)}>Back</button>}
            <button className="btn-primary btn-sm" onClick={() => (i === steps.length - 1 ? onDone() : setI(i + 1))}>
              {i === steps.length - 1 ? "Start exploring" : "Next"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
