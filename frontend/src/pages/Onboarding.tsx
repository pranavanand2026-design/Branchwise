import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { api, SIGNAL_KEYS, type BrandInput, type SignalKey, type StoreLoc } from "../lib/api";
import { useSession } from "../lib/session";
import { useWorkspace } from "../lib/store";
import { AreaPicker, BrandBasics, prioritiesFromTop, StorePicker, topFromPriorities, TopPriorities } from "../components/profile";
import { Logo, Spinner } from "../components/ui";

const STEPS = [
  { key: "brand", short: "Your brand", title: "Tell us about your brand", lead: "Three quick answers. They decide who your competitors are and which places bring your customers." },
  { key: "stores", short: "Your stores", title: "Where are your stores today?", lead: "So we don't send you somewhere that takes customers off your own shops. Opening your first one? Skip this." },
  { key: "priorities", short: "What matters", title: "What matters most for a new store?", lead: "Pick up to three. We'll weigh every area of Sydney with these in mind." },
  { key: "areas", short: "Where", title: "Where would you open?", lead: "Choose the parts of Sydney you'd consider, or keep it open to all of Sydney." },
] as const;

const DEFAULT_TOP: Record<string, SignalKey[]> = {
  kiosk: ["demographic_match", "transit_accessibility", "surrounding_amenities"],
  takeaway: ["demographic_match", "surrounding_amenities", "market_saturation"],
  cafe: ["demographic_match", "market_saturation", "surrounding_amenities"],
  restaurant: ["market_saturation", "demographic_match", "surrounding_amenities"],
};

export function Onboarding() {
  const nav = useNavigate();
  const { brand, setBrand, user, logout } = useSession();
  const resetWorkspace = useWorkspace((s) => s.reset);
  const [step, setStep] = useState(brand ? 1 : 0);
  const [draft, setDraft] = useState<BrandInput>(() => ({
    name: brand?.name ?? "",
    vertical: brand?.vertical ?? "",
    description: brand?.description ?? "",
    store_format: brand?.store_format ?? null,
    store_count_band: brand?.store_count_band ?? null,
    priorities: brand?.priorities ?? (Object.fromEntries(SIGNAL_KEYS.map((k) => [k, 2])) as Record<SignalKey, number>),
    regions: brand?.regions ?? [],
    onboarded: false,
  }));
  const [stores, setStores] = useState<StoreLoc[]>(brand?.stores ?? []);
  const [top, setTop] = useState<SignalKey[]>(() => (brand ? topFromPriorities(brand.priorities) : []));
  const [touchedTop, setTouchedTop] = useState(Boolean(brand));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    headingRef.current?.focus();
    window.scrollTo(0, 0);
  }, [step]);

  // suggest a starting three from the store format until the user picks their own
  useEffect(() => {
    if (!touchedTop && draft.store_format) setTop(DEFAULT_TOP[draft.store_format]);
  }, [draft.store_format, touchedTop]);

  async function next(skip = false) {
    setErrors({});
    setBusy(true);
    try {
      if (step === 0) {
        const e: Record<string, string> = {};
        if (!draft.name.trim()) e.name = "Write your brand's name.";
        if (!draft.vertical) e.vertical = "Pick what you sell.";
        if (Object.keys(e).length) return setErrors(e);
        setBrand(await api.saveBrand({ ...draft, onboarded: false }));
      } else if (step === 1) {
        setBrand(await api.saveStores(skip ? [] : stores));
        if (skip) setStores([]);
      } else if (step === 2) {
        if (top.length === 0) return setErrors({ top: "Pick at least one." });
        const priorities = prioritiesFromTop(top);
        setDraft((d) => ({ ...d, priorities }));
        setBrand(await api.saveBrand({ ...draft, priorities, onboarded: false }));
      } else {
        const b = await api.saveBrand({ ...draft, priorities: prioritiesFromTop(top), onboarded: true });
        resetWorkspace();
        setBrand(b);
        nav("/", { replace: true });
        return;
      }
      setStep((s) => s + 1);
    } catch (e) {
      setErrors({ form: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  const s = STEPS[step];
  const last = step === STEPS.length - 1;

  return (
    <div className="min-h-full flex flex-col">
      <header className="h-16 shrink-0 border-b border-bg-border bg-white">
        <div className="h-full max-w-[1040px] mx-auto px-6 flex items-center justify-between gap-4">
          <Logo href="/" />
          <div className="flex items-center gap-3">
            <span className="hidden sm:inline text-sm text-fg-tertiary truncate max-w-[220px]">{user?.email}</span>
            <button className="btn-quiet btn-sm" onClick={() => void logout().then(() => nav("/login"))}>Log out</button>
          </div>
        </div>
      </header>

      <main className="flex-1">
        <div className="max-w-[1040px] mx-auto px-6 pt-10 pb-36">
          <p className="text-sm font-medium text-fg-tertiary tabular">Step {step + 1} of {STEPS.length} · {s.short}</p>
          <div className="mt-3 flex gap-1.5" aria-hidden="true">
            {STEPS.map((x, i) => (
              <div key={x.key} className={`h-1.5 flex-1 rounded-full transition-colors duration-300 ${i <= step ? "bg-accent-blue" : "bg-bg-elevated"}`} />
            ))}
          </div>

          <h1 ref={headingRef} tabIndex={-1} className="mt-10 text-[34px] sm:text-[44px] leading-[1.08] outline-none">
            {s.title}
          </h1>
          <p className="mt-3 text-base sm:text-lg text-fg-secondary max-w-[58ch] leading-relaxed">{s.lead}</p>

          <div className="mt-10">
            {step === 0 && <div className="max-w-[720px]"><BrandBasics draft={draft} onChange={setDraft} errors={errors} simple /></div>}
            {step === 1 && <StorePicker brandName={draft.name} stores={stores} onChange={setStores} />}
            {step === 2 && (
              <>
                <TopPriorities
                  value={top}
                  hasStores={stores.length > 0}
                  onChange={(v) => {
                    setTouchedTop(true);
                    setTop(v);
                  }}
                />
                {errors.top && <p className="field-error">{errors.top}</p>}
              </>
            )}
            {step === 3 && <AreaPicker regions={draft.regions} onChange={(r) => setDraft({ ...draft, regions: r })} />}
          </div>
          {errors.form && <p role="alert" className="mt-6 text-danger">{errors.form}</p>}
        </div>
      </main>

      <footer className="fixed bottom-0 inset-x-0 border-t border-bg-border bg-white">
        <div className="max-w-[1040px] mx-auto px-6 h-[76px] flex items-center justify-between gap-3">
          <button className="btn-quiet" onClick={() => setStep((x) => Math.max(0, x - 1))} disabled={step === 0 || busy}>
            <ArrowLeft size={18} aria-hidden="true" /> Back
          </button>
          <div className="flex items-center gap-2">
            {step === 1 && (
              <button className="btn-quiet" onClick={() => void next(true)} disabled={busy}>
                I don't have stores yet
              </button>
            )}
            <button className="btn-primary min-w-[168px]" onClick={() => void next()} disabled={busy}>
              {busy && <Spinner />}
              {last ? "Show my best areas" : "Continue"}
              {!busy && !last && <ArrowRight size={18} aria-hidden="true" />}
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
}
