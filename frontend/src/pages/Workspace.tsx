import { useCallback, useEffect, useRef, useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { Bookmark, ChevronLeft, ChevronRight, Columns3, Layers, ListOrdered, Map as MapIcon, MessageCircle, Sparkles, X } from "lucide-react";
import { api, priParam } from "../lib/api";
import { useSession } from "../lib/session";
import { useWorkspace, type Layer } from "../lib/store";
import { MapView } from "../components/MapView";
import { ReportPanel } from "../components/ReportPanel";
import { CompareMode } from "../components/CompareMode";
import { SitePanel } from "../components/SitePanel";
import { ChatPanel } from "../components/ChatPanel";
import { Tour, type TourStep } from "../components/Tour";
import { DataBadge, Logo, Spinner } from "../components/ui";
import { ProfileMenu } from "../components/ProfileMenu";
import { ShortlistPage } from "./Shortlist";

export type View = "map" | "shortlist" | "assistant";

export function Workspace({ view }: { view: View }) {
  const nav = useNavigate();
  const { brand, user, setUser, logout } = useSession();
  const ws = useWorkspace();
  const [tourOpen, setTourOpen] = useState(false);
  const [mobileView, setMobileView] = useState<"panel" | "map">("panel");
  const reportReq = useRef(0);

  const openSite = useCallback(
    async (h3: string, lat: number, lng: number) => {
      const id = ++reportReq.current;
      ws.flyToLocation(lat, lng, 14.6);
      ws.set({ loadingReport: true });
      setMobileView("map");
      try {
        const r = await api.report(h3, priParam(useWorkspace.getState().scenario?.priorities));
        if (id === reportReq.current) ws.set({ selectedHex: r });
      } finally {
        if (id === reportReq.current) ws.set({ loadingReport: false });
      }
    },
    [ws]
  );

  // arriving from the shortlist page: open the area it asked for
  useEffect(() => {
    if (view === "shortlist" || !ws.pendingOpen) return;
    const h3 = ws.pendingOpen;
    const s = ws.shortlist.find((x) => x.h3_id === h3);
    ws.set({ pendingOpen: null });
    if (s) void openSite(s.h3_id, s.lat, s.lng);
  }, [view]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    api.shortlist().then((d) => ws.set({ shortlist: d.sites })).catch(() => undefined);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // First visit after onboarding: run the tour once (on the map)
  useEffect(() => {
    if (view === "map" && user && !user.tour_done) {
      const t = setTimeout(() => setTourOpen(true), 900);
      return () => clearTimeout(t);
    }
  }, [user, view]);

  const finishTour = useCallback(() => {
    setTourOpen(false);
    if (user && !user.tour_done) {
      setUser({ ...user, tour_done: true });
      void api.tourDone();
    }
  }, [user, setUser]);

  const tourSteps: TourStep[] = [
    {
      target: "ranked",
      title: "Your best areas",
      body: `The ten parts of Sydney that suit ${brand?.name} best, with the main reason for each. Tap one to see more.`,
      before: () => { ws.set({ selectedHex: null, panelOpen: true }); setMobileView("panel"); },
    },
    {
      target: "map",
      title: "The whole city at a glance",
      body: "Green areas suit your brand best, amber are mixed, red are weak. Hover any area for its score.",
      before: () => setMobileView("map"),
    },
    {
      target: "report",
      title: "Why an area fits",
      body: "Each area tells you why it suits you and what to check before you commit.",
      before: async () => {
        const top = useWorkspace.getState().ranked[0];
        if (top) await openSite(top.h3_id, top.lat, top.lng);
      },
    },
    {
      target: "nav-assistant",
      title: "Ask the assistant",
      body: "Describe your customers in plain words. The assistant re-weights the map, looks up places and recommends areas.",
      before: () => ws.set({ selectedHex: null }),
    },
    {
      target: "settings",
      title: "Your account",
      body: "Your brand, settings and this tour live in your account menu.",
    },
  ];

  if (!brand) return null;

  const tab = (to: string, label: string, icon: React.ReactNode, tourKey: string, badge?: number) => (
    <NavLink
      to={to}
      end
      data-tour={tourKey}
      className={({ isActive }) =>
        `inline-flex items-center gap-2 h-9 px-3.5 rounded-full text-[15px] font-medium transition-colors ${
          isActive ? "bg-brand-navy text-brand-mint" : "text-fg-secondary hover:bg-bg-elevated hover:text-fg-primary"
        }`
      }
    >
      {icon}
      <span className="hidden sm:inline">{label}</span>
      {badge ? <span className="text-[12px] tabular opacity-80">{badge}</span> : null}
    </NavLink>
  );

  const showMap = view !== "shortlist";

  return (
    <div className="h-full flex flex-col bg-bg-base">
      <header className="h-16 shrink-0 bg-white border-b border-bg-border">
        <div className="h-full px-4 sm:px-5 flex items-center gap-4">
          <Logo href="/" size={18} />
          <nav className="flex items-center gap-1 sm:ml-6" aria-label="Workspace">
            {tab("/", "Map", <MapIcon size={17} aria-hidden="true" />, "nav-map")}
            {tab("/shortlist", "Shortlist", <Bookmark size={17} aria-hidden="true" />, "nav-shortlist", ws.shortlist.length)}
            {tab("/assistant", "Assistant", <MessageCircle size={17} aria-hidden="true" />, "nav-assistant")}
          </nav>
          <div className="ml-auto flex items-center gap-3">
            <DataBadge />
            <ProfileMenu onTour={() => { nav("/"); setTourOpen(true); }} onLogout={() => void logout().then(() => { ws.reset(); nav("/login"); })} />
          </div>
        </div>
      </header>

      {view === "shortlist" ? (
        <div className="flex-1 min-h-0">
          <ShortlistPage />
        </div>
      ) : (
        <div className="flex-1 min-h-0 flex gap-3 p-3 relative">
          {/* left panel: best areas or the assistant */}
          <aside
            id="side-panel"
            className={`shrink-0 min-h-0 bg-white rounded-lg border border-bg-border overflow-hidden relative
              w-full md:transition-[width,opacity] md:duration-300
              ${view === "assistant" ? "md:w-[440px]" : ws.panelOpen ? "md:w-[380px]" : "md:w-0 md:opacity-0 md:border-0 md:-mr-3"}
              ${mobileView === "panel" ? "block" : "hidden"} md:block`}
            aria-label={view === "assistant" ? "Assistant" : "Best areas"}
          >
            <div className={`h-full w-full ${view === "assistant" ? "md:w-[440px]" : "md:w-[380px]"}`}>
              {view === "assistant" ? <ChatPanel onOpenSite={openSite} /> : <SitePanel onOpenSite={openSite} />}
            </div>
            {view === "map" && (
              <button
                onClick={() => { ws.set({ panelOpen: false }); setTimeout(() => window.dispatchEvent(new Event("resize")), 320); }}
                className="hidden md:grid absolute top-4 right-4 w-8 h-8 place-items-center rounded-full text-fg-tertiary hover:bg-bg-elevated hover:text-fg-primary"
                aria-label="Hide best areas"
                aria-controls="side-panel"
              >
                <ChevronLeft size={18} />
              </button>
            )}
          </aside>

          {/* the map card. On a phone it stays laid out behind the panel (never display:none):
              a zero-size map breaks the hex layer, which needs a real viewport. */}
          <main
            className={`flex-1 min-w-0 relative rounded-lg overflow-hidden border border-bg-border bg-white ${
              mobileView === "map" ? "" : "max-md:absolute max-md:inset-3 max-md:opacity-0 max-md:pointer-events-none max-md:-z-10"
            }`}
          >
            {showMap && <MapView onOpenSite={openSite} />}
            {view === "map" && !ws.panelOpen && (
              <button
                onClick={() => { ws.set({ panelOpen: true }); setTimeout(() => window.dispatchEvent(new Event("resize")), 320); }}
                className="hidden md:inline-flex absolute top-3 left-3 z-20 h-10 items-center gap-1.5 pl-2.5 pr-4 rounded-full bg-white border border-bg-border shadow-panel text-sm font-medium"
                aria-controls="side-panel"
              >
                <ChevronRight size={18} aria-hidden="true" /> Best areas
              </button>
            )}
            <ScenarioBanner />
            <LayerToggles />
            <ReportPanel />
            {ws.compareIds.length > 0 && !ws.compareOpen && (
              <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-30 flex items-center gap-3 h-12 pl-4 pr-1.5 rounded-full bg-fg-primary text-white shadow-pop">
                <span className="text-sm tabular">{ws.compareIds.length} of 3 selected</span>
                <button className="text-sm text-[#c9c9c9] hover:text-white" onClick={() => ws.set({ compareIds: [] })}>Clear</button>
                <button className="btn-primary btn-sm rounded-full" onClick={() => ws.set({ compareOpen: true })} disabled={ws.compareIds.length < 2}>
                  <Columns3 size={16} aria-hidden="true" /> Compare
                </button>
              </div>
            )}
          </main>

          {/* phone: switch between the panel and the map */}
          <div className="md:hidden absolute bottom-6 left-1/2 -translate-x-1/2 z-30 flex p-1 rounded-full bg-white shadow-pop border border-bg-border">
            {(["panel", "map"] as const).map((v) => (
              <button
                key={v}
                onClick={() => setMobileView(v)}
                aria-pressed={mobileView === v}
                className={`h-10 px-4 rounded-full text-sm font-medium inline-flex items-center gap-2 ${mobileView === v ? "bg-fg-primary text-white" : "text-fg-secondary"}`}
              >
                {v === "panel" ? <ListOrdered size={16} aria-hidden="true" /> : <MapIcon size={16} aria-hidden="true" />}
                {v === "panel" ? (view === "assistant" ? "Chat" : "List") : "Map"}
              </button>
            ))}
          </div>
        </div>
      )}

      {view !== "shortlist" && <CompareMode />}
      {tourOpen && view === "map" && <Tour steps={tourSteps} onDone={finishTour} />}
    </div>
  );
}

/** Shown while the assistant's what-if is on the map. */
function ScenarioBanner() {
  const { scenario, set } = useWorkspace();
  const { brand, setBrand } = useSession();
  const [busy, setBusy] = useState(false);
  if (!scenario || !brand) return null;

  async function save() {
    if (!brand || !scenario) return;
    setBusy(true);
    try {
      const b = await api.saveBrand({
        name: brand.name, vertical: brand.vertical, description: brand.description,
        store_format: brand.store_format, store_count_band: brand.store_count_band,
        priorities: scenario.priorities ?? brand.priorities, regions: scenario.regions ?? brand.regions, onboarded: true,
      });
      setBrand(b);
      set({ scenario: null, rankedRegions: null });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20 max-w-[calc(100%-24px)] flex items-center gap-3 h-11 pl-4 pr-1.5 rounded-full bg-white border border-accent-blue/40 shadow-panel">
      <Sparkles size={16} className="text-accent-link shrink-0" aria-hidden="true" />
      <span className="text-sm truncate">
        <span className="text-fg-tertiary">Assistant's view: </span>
        <span className="font-medium">{scenario.label || "custom priorities"}</span>
      </span>
      <button className="btn-secondary btn-sm h-8 shrink-0" onClick={() => void save()} disabled={busy}>
        {busy && <Spinner />} Save to my profile
      </button>
      <button className="w-8 h-8 shrink-0 grid place-items-center rounded-full text-fg-tertiary hover:bg-bg-elevated" onClick={() => set({ scenario: null, places: [] })} aria-label="Reset to my saved priorities">
        <X size={16} />
      </button>
    </div>
  );
}

const LAYERS: { key: Layer; label: string; swatch: React.ReactNode }[] = [
  {
    key: "opportunity",
    label: "How well it fits",
    swatch: (
      <span className="flex gap-0.5" aria-hidden="true">
        {["#3BB273", "#F5A623", "#E85D5D"].map((c) => <span key={c} className="w-2 h-3 rounded-[2px]" style={{ background: c }} />)}
      </span>
    ),
  },
  { key: "competitors", label: "Competitors", swatch: <span className="w-2.5 h-2.5 rounded-full bg-score-weak ring-2 ring-white" aria-hidden="true" /> },
  { key: "complementary", label: "Anchors and complements", swatch: <span className="w-2.5 h-2.5 rounded-full bg-[#243C4C] ring-2 ring-white" aria-hidden="true" /> },
  { key: "own_stores", label: "Your stores", swatch: <span className="w-2.5 h-2.5 rounded-full bg-fg-primary ring-2 ring-white" aria-hidden="true" /> },
];

function LayerToggles() {
  const { layers, toggleLayer } = useWorkspace();
  const [open, setOpen] = useState(false);
  return (
    <div className="absolute left-3 bottom-3 z-10 bg-white/95 rounded-md shadow-panel border border-bg-border text-sm">
      <button className="w-full flex items-center gap-2 h-10 px-3 font-medium" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <Layers size={16} aria-hidden="true" /> Map layers
      </button>
      {open && (
        <ul className="px-3 pb-3 space-y-1.5">
          {LAYERS.map((l) => (
            <li key={l.key}>
              <label className="flex items-center gap-2.5 cursor-pointer h-7">
                <input type="checkbox" className="w-4 h-4 accent-[#243C4C]" checked={layers[l.key]} onChange={() => toggleLayer(l.key)} />
                <span className="w-6 grid place-items-center">{l.swatch}</span>
                {l.label}
              </label>
            </li>
          ))}
          <li className="text-[13px] text-fg-tertiary pt-1">Green is a strong fit, amber is mixed, red is weak. Pins show when you zoom in.</li>
        </ul>
      )}
    </div>
  );
}
