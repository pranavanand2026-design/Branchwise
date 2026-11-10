import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { api, SIGNAL_KEYS, type BrandInput, type SignalKey, type StoreLoc } from "../lib/api";
import { useSession, verticalLabel } from "../lib/session";
import { useWorkspace } from "../lib/store";
import { AreaPicker, BrandBasics, FORMAT_PRIORITIES, FORMATS, IMPORTANCE, PriorityEditor, StorePicker } from "../components/profile";
import { DataBadge, Logo, Spinner } from "../components/ui";

const STEPS = [
  { key: "brand", title: "Tell us about your brand", lead: "This sets who counts as a competitor and which places pull your customers in." },
  { key: "stores", title: "Add the stores you already run", lead: "So new sites don't take customers off your own shops." },
  { key: "priorities", title: "Say what matters for a new site", lead: "We turn your answers into the weights behind every score. We've suggested a start from your store format." },
  { key: "areas", title: "Choose where you'd open", lead: "Pick the parts of Sydney you'd consider, or leave it at all of Sydney." },
  { key: "review", title: "Check your profile", lead: "You can change any of this later in Settings, and your rankings update straight away." },
] as const;

const defaultPriorities = (): Record<SignalKey, number> =>
  Object.fromEntries(SIGNAL_KEYS.map((k) => [k, 2])) as Record<SignalKey, number>;

export function Onboarding() {
  const nav = useNavigate();
  const { brand, meta, setBrand, user, logout } = useSession();
  const resetWorkspace = useWorkspace((s) => s.reset);
  const [step, setStep] = useState(brand ? 1 : 0);
  const [draft, setDraft] = useState<BrandInput>(() => ({
    name: brand?.name ?? "",
    vertical: brand?.vertical ?? "",
    description: brand?.description ?? "",
    store_format: brand?.store_format ?? null,
    store_count_band: brand?.store_count_band ?? null,
    priorities: brand?.priorities ?? defaultPriorities(),
    regions: brand?.regions ?? [],
    onboarded: false,
  }));
  const [stores, setStores] = useState<StoreLoc[]>(brand?.stores ?? []);
  const [touchedPriorities, setTouchedPriorities] = useState(Boolean(brand));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);

  // Move focus to the step heading so keyboard and screen-reader users land in the right place
  useEffect(() => {
    headingRef.current?.focus();
  }, [step]);

  // Suggest priorities from the format until the user edits them
  useEffect(() => {
    if (!touchedPriorities && draft.store_format) {
      setDraft((d) => ({ ...d, priorities: { ...FORMAT_PRIORITIES[draft.store_format!] } }));
    }
  }, [draft.store_format, touchedPriorities]);

  async function next() {
    setErrors({});
    setBusy(true);
    try {
      if (step === 0) {
        const e: Record<string, string> = {};
        if (!draft.name.trim()) e.name = "Write your brand's name.";
        if (!draft.vertical) e.vertical = "Pick what you sell.";
        if (Object.keys(e).length) {
          setErrors(e);
          return;
        }
        setBrand(await api.saveBrand({ ...draft, onboarded: false }));
      } else if (step === 1) {
        setBrand(await api.saveStores(stores));
      } else if (step === 2 || step === 3) {
        setBrand(await api.saveBrand({ ...draft, onboarded: false }));
      } else if (step === 4) {
        const b = await api.saveBrand({ ...draft, onboarded: true });
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
  const fmt = FORMATS.find((f) => f.value === draft.store_format);
  const regionLabels = draft.regions.map((r) => meta?.regions.find((x) => x.key === r)?.label ?? r);

  return (
    <div className="min-h-full flex flex-col">
      <header className="h-16 shrink-0 border-b border-bg-border bg-white">
        <div className="h-full max-w-[1120px] mx-auto px-6 flex items-center justify-between gap-4">
          <Logo href="/" />
          <div className="flex items-center gap-3">
            <DataBadge />
            <span className="hidden sm:inline text-sm text-fg-tertiary truncate max-w-[220px]">{user?.email}</span>
            <button className="btn-quiet btn-sm" onClick={() => void logout().then(() => nav("/login"))}>Log out</button>
          </div>
        </div>
      </header>

      <main className="flex-1">
        <div className="max-w-[1120px] mx-auto px-6 pt-10 pb-32">
          <ol className="flex gap-1.5" aria-label={`Step ${step + 1} of ${STEPS.length}`}>
            {STEPS.map((x, i) => (
              <li key={x.key} className="flex-1">
                <div className={`h-1 rounded-full transition-colors ${i <= step ? "bg-accent" : "bg-bg-elevated"}`} />
                <span className={`hidden md:block mt-2 text-[13px] font-medium ${i === step ? "text-fg-primary" : "text-fg-tertiary"}`}>
                  {i + 1}. {["Brand", "Stores", "Priorities", "Areas", "Review"][i]}
                </span>
              </li>
            ))}
          </ol>

          <h1 ref={headingRef} tabIndex={-1} className="mt-10 text-[32px] sm:text-[40px] leading-[1.1] font-medium tracking-display outline-none">
            {s.title}
          </h1>
          <p className="mt-3 text-base sm:text-lg text-fg-secondary max-w-[62ch] leading-relaxed">{s.lead}</p>

          <div className="mt-10">
            {step === 0 && <div className="max-w-[720px]"><BrandBasics draft={draft} onChange={setDraft} errors={errors} /></div>}
            {step === 1 && <StorePicker brandName={draft.name} stores={stores} onChange={setStores} />}
            {step === 2 && (
              <PriorityEditor
                priorities={draft.priorities}
                hasStores={stores.length > 0}
                onChange={(p) => {
                  setTouchedPriorities(true);
                  setDraft({ ...draft, priorities: p });
                }}
              />
            )}
            {step === 3 && <AreaPicker regions={draft.regions} onChange={(r) => setDraft({ ...draft, regions: r })} />}
            {step === 4 && (
              <dl className="card divide-y divide-bg-border max-w-[720px]">
                <Row label="Brand" value={draft.name} onEdit={() => setStep(0)} />
                <Row label="Sells" value={verticalLabel(meta, draft.vertical)} onEdit={() => setStep(0)} />
                <Row label="Format" value={[fmt?.label, draft.store_count_band && `${draft.store_count_band} stores`].filter(Boolean).join(", ") || "Not set"} onEdit={() => setStep(0)} />
                <Row label="Your stores" value={stores.length ? `${stores.length} on the map` : "None yet"} onEdit={() => setStep(1)} />
                <Row
                  label="Priorities"
                  value={meta?.signals
                    .filter((x) => draft.priorities[x.key] >= 3)
                    .map((x) => `${x.label} (${IMPORTANCE[draft.priorities[x.key]].toLowerCase()})`)
                    .join(", ") || "Evenly weighted"}
                  onEdit={() => setStep(2)}
                />
                <Row label="Areas" value={regionLabels.length ? regionLabels.join(", ") : "All of Sydney"} onEdit={() => setStep(3)} />
              </dl>
            )}
          </div>
          {errors.form && <p role="alert" className="mt-6 text-danger">{errors.form}</p>}
        </div>
      </main>

      <footer className="fixed bottom-0 inset-x-0 border-t border-bg-border bg-white/95 backdrop-blur">
        <div className="max-w-[1120px] mx-auto px-6 h-[72px] flex items-center justify-between gap-3">
          <button className="btn-quiet" onClick={() => setStep((x) => Math.max(0, x - 1))} disabled={step === 0 || busy}>
            <ArrowLeft size={18} aria-hidden="true" /> Back
          </button>
          <div className="flex items-center gap-3">
            {step === 1 && stores.length === 0 && (
              <span className="hidden sm:inline text-sm text-fg-tertiary">No stores yet? Continue without.</span>
            )}
            <button className="btn-primary min-w-[160px]" onClick={() => void next()} disabled={busy}>
              {busy && <Spinner />}
              {step === STEPS.length - 1 ? "See my ranked sites" : "Continue"}
              {!busy && step < STEPS.length - 1 && <ArrowRight size={18} aria-hidden="true" />}
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
}

function Row({ label, value, onEdit }: { label: string; value: string; onEdit: () => void }) {
  return (
    <div className="flex items-start gap-4 px-5 py-4">
      <dt className="w-32 shrink-0 text-sm text-fg-tertiary pt-0.5">{label}</dt>
      <dd className="flex-1 text-[15px] text-fg-primary">{value}</dd>
      <button type="button" className="text-sm font-medium link shrink-0" onClick={onEdit} aria-label={`Edit ${label.toLowerCase()}`}>
        Edit
      </button>
    </div>
  );
}
