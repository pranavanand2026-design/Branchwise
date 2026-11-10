import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ChevronDown, ChevronLeft, ChevronRight, Columns3, Layers, ListOrdered, Map as MapIcon } from "lucide-react";
import { api } from "../lib/api";
import { useSession, verticalLabel } from "../lib/session";
import { useWorkspace, type Layer } from "../lib/store";
import { MapView } from "../components/MapView";
import { ReportPanel } from "../components/ReportPanel";
import { CompareMode } from "../components/CompareMode";
import { SitePanel } from "../components/SitePanel";
import { Tour, type TourStep } from "../components/Tour";
import { DataBadge, Logo } from "../components/ui";
import { ProfileMenu } from "../components/ProfileMenu";

export function Workspace() {
  const nav = useNavigate();
  const { brand, user, meta, setUser, logout } = useSession();
  const ws = useWorkspace();
  const [tourOpen, setTourOpen] = useState(false);
  const [mobileView, setMobileView] = useState<"list" | "map">("list");
  const reportReq = useRef(0);

  const openSite = useCallback(
    async (h3: string, lat: number, lng: number) => {
      const id = ++reportReq.current;
      ws.flyToLocation(lat, lng, 14.6);
      ws.set({ loadingReport: true });
      setMobileView("map");
      try {
        const r = await api.report(h3);
        if (id === reportReq.current) ws.set({ selectedHex: r });
      } finally {
        if (id === reportReq.current) ws.set({ loadingReport: false });
      }
    },
    [ws]
  );

  // First visit after onboarding: run the tour once
  useEffect(() => {
    if (user && !user.tour_done) {
      const t = setTimeout(() => setTourOpen(true), 900);
      return () => clearTimeout(t);
    }
  }, [user]);

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
      before: () => { ws.set({ panelTab: "ranked", selectedHex: null }); setMobileView("list"); },
    },
    {
      target: "map",
      title: "The whole city at a glance",
      body: "Green areas suit your brand best, amber are mixed, red are weak. The numbered pins are your top ten; the dark pins are your own stores.",
      before: () => setMobileView("map"),
    },
    {
      target: "report",
      title: "Why an area fits",
      body: "Each area tells you why it suits you and what to check before you commit. Scores are under Score details if you want them.",
      before: async () => {
        const top = useWorkspace.getState().ranked[0];
        if (top) await openSite(top.h3_id, top.lat, top.lng);
      },
    },
    {
      target: "save",
      title: "Keep a shortlist",
      body: "Save the areas you like and add a note for your team. Compare up to three side by side.",
    },
    {
      target: "settings",
      title: "Your account",
      body: "Your account menu has Settings, where you can change your stores, what matters most or where you'd open. You can replay this tour from there too.",
      before: () => ws.set({ selectedHex: null }),
    },
  ];

  if (!brand) return null;

  return (
    <div className="h-full flex flex-col">
      <header className="h-14 shrink-0 bg-white border-b border-bg-border">
        <div className="h-full px-4 flex items-center gap-4">
          <Logo href="/" size={18} />
          <Link
            to="/settings"
            className="hidden sm:inline-flex items-center gap-2 h-9 pl-1.5 pr-3 ml-2 rounded-full border border-bg-border bg-white hover:bg-bg-base transition-colors min-w-0"
            title={`${brand.name} · ${verticalLabel(meta, brand.vertical)} · edit in Settings`}
          >
            <span className="w-6 h-6 shrink-0 rounded-full bg-brand-navy text-brand-mint grid place-items-center font-display text-[13px]" aria-hidden="true">
              {brand.name.trim().charAt(0).toUpperCase()}
            </span>
            <span className="text-[15px] font-medium truncate max-w-[200px]">{brand.name}</span>
            <ChevronDown size={15} className="text-fg-tertiary shrink-0" aria-hidden="true" />
          </Link>
          <div className="ml-auto flex items-center gap-3">
            <DataBadge />
            <ProfileMenu onTour={() => setTourOpen(true)} onLogout={() => void logout().then(() => { ws.reset(); nav("/login"); })} />
          </div>
        </div>
      </header>

      <div className="flex-1 min-h-0 flex relative">
        <aside
          id="sites-panel"
          className={`w-full shrink-0 bg-white min-h-0 overflow-hidden md:transition-[width] md:duration-300 ${
            ws.panelOpen ? "md:w-[380px] md:border-r md:border-bg-border" : "md:w-0"
          } ${mobileView === "list" ? "block" : "hidden"} md:block`}
          aria-label="Best areas"
        >
          <div className="h-full w-full md:w-[380px]">
            <SitePanel onOpenSite={openSite} />
          </div>
        </aside>

        {/* collapse / expand the list (desktop) */}
        <button
          onClick={() => {
            ws.set({ panelOpen: !ws.panelOpen });
            setTimeout(() => window.dispatchEvent(new Event("resize")), 320);
          }}
          aria-expanded={ws.panelOpen}
          aria-controls="sites-panel"
          className="hidden md:flex absolute top-3 z-20 h-10 items-center gap-1.5 pl-2 pr-3 rounded-r-full bg-white border border-l-0 border-bg-border shadow-panel text-sm font-medium text-fg-secondary hover:text-fg-primary transition-[left] duration-300"
          style={{ left: ws.panelOpen ? 380 : 0 }}
        >
          {ws.panelOpen ? <ChevronLeft size={18} aria-hidden="true" /> : <ChevronRight size={18} aria-hidden="true" />}
          {ws.panelOpen ? <span className="sr-only">Hide best areas</span> : "Best areas"}
        </button>

        {/* On a phone the map stays laid out behind the list (never display:none):
            a zero-size map breaks the hex layer, which needs a real viewport. */}
        <main className={`flex-1 min-w-0 relative ${mobileView === "map" ? "" : "max-md:absolute max-md:inset-0 max-md:opacity-0 max-md:pointer-events-none max-md:-z-10"}`}>
          <MapView onOpenSite={openSite} />
          <LayerToggles />
          <ReportPanel />
        </main>

        {ws.compareIds.length > 0 && !ws.compareOpen && (
          <div className={`absolute bottom-20 md:bottom-5 left-1/2 -translate-x-1/2 z-30 flex items-center gap-3 h-12 pl-4 pr-1.5 rounded-full bg-fg-primary text-white shadow-pop ${ws.panelOpen ? "md:left-[calc(380px+(100%-380px)/2)]" : ""}`}>
            <span className="text-sm tabular">{ws.compareIds.length} of 3 selected</span>
            <button className="text-sm text-[#c9c9c9] hover:text-white" onClick={() => ws.set({ compareIds: [] })}>Clear</button>
            <button className="btn-primary btn-sm rounded-full" onClick={() => ws.set({ compareOpen: true })} disabled={ws.compareIds.length < 2}>
              <Columns3 size={16} aria-hidden="true" /> Compare sites
            </button>
          </div>
        )}

        {/* phone: switch between list and map */}
        <div className="md:hidden absolute bottom-4 left-1/2 -translate-x-1/2 z-30 flex p-1 rounded-full bg-white shadow-pop border border-bg-border">
          {(["list", "map"] as const).map((v) => (
            <button
              key={v}
              onClick={() => setMobileView(v)}
              aria-pressed={mobileView === v}
              className={`h-10 px-4 rounded-full text-sm font-medium inline-flex items-center gap-2 ${mobileView === v ? "bg-fg-primary text-white" : "text-fg-secondary"}`}
            >
              {v === "list" ? <ListOrdered size={16} aria-hidden="true" /> : <MapIcon size={16} aria-hidden="true" />}
              {v === "list" ? "List" : "Map"}
            </button>
          ))}
        </div>
      </div>

      <CompareMode />
      {tourOpen && <Tour steps={tourSteps} onDone={finishTour} />}
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
    <div className="absolute left-3 bottom-8 md:bottom-3 z-10 bg-white/95 rounded-md shadow-panel border border-bg-border text-sm">
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
