import { create } from "zustand";
import type { AssistantPlace, ChatMsg, HexReport, HexResult, RankedSite, SavedSite, Scenario } from "./api";

export type Layer = "opportunity" | "competitors" | "complementary" | "own_stores";
export type PanelTab = "ranked" | "shortlist";

type Workspace = {
  hexes: HexResult[];
  loadingHeatmap: boolean;
  heatmapError: string | null;

  ranked: RankedSite[];
  rankedRegions: string[] | null; // null = use the brand's saved regions
  loadingRanked: boolean;

  shortlist: SavedSite[];

  selectedHex: HexReport | null;
  loadingReport: boolean;
  hoveredHex: string | null;

  compareIds: string[];
  compareOpen: boolean;

  layers: Record<Layer, boolean>;
  panelTab: PanelTab;
  panelOpen: boolean;

  flyTo: { lat: number; lng: number; zoom: number; tick: number } | null;

  /** what-if from the assistant: overrides saved priorities/areas until saved or reset */
  scenario: Scenario | null;
  places: AssistantPlace[];
  chat: ChatMsg[];
  chatBusy: boolean;
  /** an area to open once the map view mounts (from the shortlist page) */
  pendingOpen: string | null;

  set: (p: Partial<Workspace>) => void;
  toggleLayer: (l: Layer) => void;
  toggleCompare: (h3: string) => void;
  flyToLocation: (lat: number, lng: number, zoom?: number) => void;
  reset: () => void;
};

const initial = {
  hexes: [],
  loadingHeatmap: false,
  heatmapError: null,
  ranked: [],
  rankedRegions: null,
  loadingRanked: false,
  shortlist: [],
  selectedHex: null,
  loadingReport: false,
  hoveredHex: null,
  compareIds: [],
  compareOpen: false,
  layers: { opportunity: true, competitors: true, complementary: false, own_stores: true },
  panelTab: "ranked" as PanelTab,
  panelOpen: true,
  flyTo: null,
  scenario: null as Scenario | null,
  places: [] as AssistantPlace[],
  chat: [] as ChatMsg[],
  chatBusy: false,
  pendingOpen: null as string | null,
};

export const useWorkspace = create<Workspace>((set) => ({
  ...initial,
  set: (p) => set(p),
  toggleLayer: (l) => set((s) => ({ layers: { ...s.layers, [l]: !s.layers[l] } })),
  toggleCompare: (h3) =>
    set((s) => {
      if (s.compareIds.includes(h3)) return { compareIds: s.compareIds.filter((x) => x !== h3) };
      return { compareIds: [...s.compareIds, h3].slice(-3) };
    }),
  flyToLocation: (lat, lng, zoom = 14.5) =>
    set((s) => ({ flyTo: { lat, lng, zoom, tick: (s.flyTo?.tick ?? 0) + 1 } })),
  reset: () => set(initial),
}));
