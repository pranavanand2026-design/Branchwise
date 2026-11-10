import { useState, type FormEvent, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { ApiError, api, type BrandInput, type StoreLoc } from "../lib/api";
import { useSession } from "../lib/session";
import { useWorkspace } from "../lib/store";
import { AreaPicker, BrandBasics, PriorityEditor, StorePicker } from "../components/profile";
import { DataBadge, Logo, Spinner, TextField } from "../components/ui";

const SECTIONS = [
  { id: "brand", label: "Brand" },
  { id: "stores", label: "Stores" },
  { id: "priorities", label: "Priorities" },
  { id: "areas", label: "Areas" },
  { id: "account", label: "Account" },
];

export function Settings() {
  const { brand, setBrand, user, setUser, health } = useSession();
  const resetWorkspace = useWorkspace((s) => s.reset);
  const [draft, setDraft] = useState<BrandInput>({
    name: brand!.name,
    vertical: brand!.vertical,
    description: brand!.description ?? "",
    store_format: brand!.store_format,
    store_count_band: brand!.store_count_band,
    priorities: brand!.priorities,
    regions: brand!.regions,
    onboarded: true,
  });
  const [stores, setStores] = useState<StoreLoc[]>(brand!.stores);
  const [status, setStatus] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  async function saveProfile(section: string) {
    setBusy(section);
    try {
      if (!draft.name.trim()) throw new Error("Write your brand's name.");
      const b = section === "stores" ? await api.saveStores(stores) : await api.saveBrand(draft);
      setBrand(b);
      resetWorkspace();
      setStatus({ [section]: "Saved. Your scores are updated." });
    } catch (e) {
      setStatus({ [section]: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  const save = (section: string, label = "Save changes") => (
    <div className="mt-6 flex items-center gap-4">
      <button className="btn-primary" onClick={() => void saveProfile(section)} disabled={busy !== null}>
        {busy === section && <Spinner />} {label}
      </button>
      <p role="status" className="text-sm text-fg-secondary">{status[section]}</p>
    </div>
  );

  return (
    <div className="min-h-full">
      <header className="h-14 bg-white border-b border-bg-border sticky top-0 z-10">
        <div className="h-full max-w-[1120px] mx-auto px-6 flex items-center gap-4">
          <Link to="/" className="btn-quiet btn-sm -ml-3"><ArrowLeft size={16} aria-hidden="true" /> Back to map</Link>
          <span className="ml-auto"><DataBadge /></span>
          <Logo size={18} />
        </div>
      </header>

      <div className="max-w-[1120px] mx-auto px-6 py-10 lg:grid lg:grid-cols-[180px_minmax(0,1fr)] lg:gap-12">
        <nav className="hidden lg:block sticky top-24 self-start" aria-label="Settings sections">
          <ul className="space-y-1">
            {SECTIONS.map((s) => (
              <li key={s.id}><a href={`#${s.id}`} className="block px-3 py-2 rounded-sm text-[15px] text-fg-secondary hover:bg-bg-elevated hover:text-fg-primary">{s.label}</a></li>
            ))}
          </ul>
        </nav>

        <main className="space-y-6">
          <h1 className="text-[32px] font-medium tracking-display">Settings</h1>

          <Panel id="brand" title="Brand" lead="Your name and what you sell decide who counts as a competitor.">
            <div className="max-w-[720px]"><BrandBasics draft={draft} onChange={setDraft} errors={{}} /></div>
            {save("brand")}
          </Panel>

          <Panel id="stores" title="Your stores" lead="Sites near these score lower on spacing.">
            <StorePicker brandName={draft.name} stores={stores} onChange={setStores} />
            {save("stores", "Save stores")}
          </Panel>

          <Panel id="priorities" title="Priorities" lead="Change a weight and every score on the map updates.">
            <PriorityEditor priorities={draft.priorities} hasStores={stores.length > 0} onChange={(p) => setDraft({ ...draft, priorities: p })} />
            {save("priorities", "Save priorities")}
          </Panel>

          <Panel id="areas" title="Areas" lead="Where your ranked list looks.">
            <AreaPicker regions={draft.regions} onChange={(r) => setDraft({ ...draft, regions: r })} />
            {save("areas", "Save areas")}
          </Panel>

          <Panel id="account" title="Account" lead={`Signed in as ${user?.email}.`}>
            <div className="space-y-10">
              <div>
                <h3 className="text-base font-medium">Product tour</h3>
                <p className="mt-1 text-[15px] text-fg-secondary">Replay the five-step tour next time you open the map.</p>
                <button
                  className="btn-secondary mt-3"
                  onClick={() => {
                    if (user) setUser({ ...user, tour_done: false });
                    setStatus({ tour: "The tour will start when you go back to the map." });
                  }}
                >
                  Replay the tour
                </button>
                <p role="status" className="mt-2 text-sm text-fg-secondary">{status.tour}</p>
              </div>
              <PasswordForm />
              <DeleteAccount />
              <p className="text-[13px] text-fg-tertiary">
                Data: {health?.dataset?.source === "foursquare" ? "Foursquare Open Source Places" : "generated demo places"},{" "}
                {health?.poi_count.toLocaleString()} places in Greater Sydney.
              </p>
            </div>
          </Panel>
        </main>
      </div>
    </div>
  );
}

function Panel({ id, title, lead, children }: { id: string; title: string; lead: string; children: ReactNode }) {
  return (
    <section id={id} className="card p-6 sm:p-8 scroll-mt-20" aria-labelledby={`${id}-h`}>
      <h2 id={`${id}-h`} className="text-[22px] font-medium tracking-display">{title}</h2>
      <p className="mt-1 text-[15px] text-fg-secondary">{lead}</p>
      <div className="mt-6">{children}</div>
    </section>
  );
}

function PasswordForm() {
  const [cur, setCur] = useState("");
  const [next, setNext] = useState("");
  const [err, setErr] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErr({});
    setMsg("");
    if (next.length < 10) return setErr({ new_password: "Use at least 10 characters." });
    setBusy(true);
    try {
      await api.changePassword(cur, next);
      setCur("");
      setNext("");
      setMsg("Password changed. Other devices have been signed out.");
    } catch (e) {
      const a = e as ApiError;
      setErr({ [a.field ?? "form"]: a.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="max-w-[420px]">
      <h3 className="text-base font-medium">Change password</h3>
      <div className="mt-3 space-y-4">
        <TextField label="Current password" type="password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} error={err.current_password} />
        <TextField label="New password" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} error={err.new_password} hint="At least 10 characters." />
      </div>
      <button className="btn-secondary mt-4" disabled={busy}>{busy && <Spinner />} Change password</button>
      <p role="status" className={`mt-2 text-sm ${err.form ? "text-danger" : "text-fg-secondary"}`}>{err.form ?? msg}</p>
    </form>
  );
}

function DeleteAccount() {
  const nav = useNavigate();
  const setSession = useSession((s) => s.setSession);
  const [open, setOpen] = useState(false);
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      await api.deleteAccount(pw);
      setSession(null, null);
      nav("/signup", { replace: true });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-[520px] rounded-sm border border-danger/25 p-5">
      <h3 className="text-base font-medium text-danger">Delete account</h3>
      <p className="mt-1 text-[15px] text-fg-secondary">
        Removes your account, brand profile, stores and shortlist for good. This can't be undone.
      </p>
      {!open ? (
        <button className="btn-quiet mt-3 text-danger hover:bg-danger-soft hover:text-danger" onClick={() => setOpen(true)}>Delete my account</button>
      ) : (
        <form onSubmit={submit} className="mt-4 space-y-3" noValidate>
          <TextField label="Type your password to confirm" type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} error={err || undefined} />
          <div className="flex gap-2">
            <button className="btn-danger" disabled={busy || !pw}>{busy && <Spinner />} Delete everything</button>
            <button type="button" className="btn-quiet" onClick={() => { setOpen(false); setPw(""); setErr(""); }}>Cancel</button>
          </div>
        </form>
      )}
    </div>
  );
}
