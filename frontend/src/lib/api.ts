// Every API call goes through here. Types mirror backend/app/{auth,brand,main}.py.

export type SignalKey =
  | "market_saturation"
  | "cannibalisation"
  | "surrounding_amenities"
  | "transit_accessibility"
  | "demographic_match";

export const SIGNAL_KEYS: SignalKey[] = [
  "demographic_match",
  "surrounding_amenities",
  "transit_accessibility",
  "market_saturation",
  "cannibalisation",
];

export type Components = Record<SignalKey, number>;

export type User = { id: string; email: string; full_name: string | null; tour_done: boolean };

export type StoreLoc = {
  id?: string;
  name: string;
  lat: number;
  lng: number;
  locality: string | null;
  fsq_place_id: string | null;
};

export type StoreFormat = "kiosk" | "takeaway" | "cafe" | "restaurant";
export type StoreCountBand = "1" | "2-5" | "6-20" | "21-50" | "50+";

export type Brand = {
  id: string;
  name: string;
  vertical: string;
  description: string | null;
  store_format: StoreFormat | null;
  store_count_band: StoreCountBand | null;
  priorities: Record<SignalKey, number>;
  weights: Record<SignalKey, number>;
  regions: string[];
  onboarded: boolean;
  stores: StoreLoc[];
};

export type BrandInput = Omit<Brand, "id" | "weights" | "stores">;

export type Vertical = {
  key: string;
  label: string;
  blurb: string;
  competitors: string[];
  anchors: string[];
  complementary: string[];
};

export type Region = { key: string; label: string; lat: number; lng: number; radius_km: number };
export type SignalInfo = { key: SignalKey; label: string; question: string; detail: string };
export type Meta = { verticals: Vertical[]; regions: Region[]; signals: SignalInfo[] };

export type Health = {
  ok: boolean;
  poi_count: number;
  dataset: { source: "foursquare" | "synthetic" | "unknown"; release?: string | null; hex_count?: number };
  assistant_enabled: boolean;
};

export type HexResult = {
  h3_id: string;
  lat: number;
  lng: number;
  locality: string | null;
  score: number;
  components: Components;
  n_competitors: number;
  n_complementary: number;
};

export type RankedSite = HexResult & { rank: number; reasons: string[]; risks: string[] };

export type Place = {
  fsq_place_id: string;
  name: string;
  lat: number;
  lng: number;
  locality: string | null;
  primary_category: string | null;
  address: string | null;
};

export type Pin = {
  fsq_place_id: string;
  name: string;
  primary_category: string | null;
  latitude: number;
  longitude: number;
  locality: string | null;
  is_competitor: boolean;
  is_complementary: boolean;
  is_anchor: boolean;
  is_transit: boolean;
};

export type NearPoi = {
  name: string;
  primary_category: string | null;
  latitude: number;
  longitude: number;
  locality: string | null;
  dist_m: number;
};

export type SavedSite = {
  id: string;
  h3_id: string;
  locality: string | null;
  lat: number;
  lng: number;
  score_at_save: number;
  score?: number;
  note: string | null;
  created_at: string;
};

export type HexReport = {
  h3_id: string;
  lat: number;
  lng: number;
  locality: string | null;
  region: string | null;
  postcode: string | null;
  score: number;
  rank: number | null;
  rank_total: number;
  rank_pct: number | null;
  components: Components;
  signals_raw: {
    n_competitors: number;
    n_complementary: number;
    n_retail: number;
    d_anchor_m: number | null;
    d_transit_m: number | null;
    d_cannibal_m: number | null;
  };
  weights: Record<SignalKey, number>;
  nearest_competitors: NearPoi[];
  nearest_complementary: NearPoi[];
  nearest_anchors: NearPoi[];
  nearest_transit: NearPoi[];
  diversity_index: number;
  summary: string;
  reasons: string[];
  risks: string[];
  saved: SavedSite | null;
};

export type Session = { user: User | null; brand: Brand | null };

/** Error with an optional field name, so forms can show it under the right input. */
export class ApiError extends Error {
  status: number;
  field?: string;
  constructor(status: number, message: string, field?: string) {
    super(message);
    this.status = status;
    this.field = field;
  }
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  let r: Response;
  try {
    r = await fetch(url, {
      method,
      credentials: "same-origin",
      headers: {
        // required by the backend's CSRF guard on every state-changing call
        "X-Requested-With": "branchwise",
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, "Can't reach Branchwise. Check your connection and try again.");
  }
  if (r.status === 204) return undefined as T;
  const data = await r.json().catch(() => null);
  if (!r.ok) {
    const d = data?.detail;
    if (d && typeof d === "object" && !Array.isArray(d)) throw new ApiError(r.status, d.message, d.field);
    if (Array.isArray(d)) {
      // pydantic validation list
      const first = d[0];
      const field = Array.isArray(first?.loc) ? String(first.loc[first.loc.length - 1]) : undefined;
      throw new ApiError(r.status, String(first?.msg ?? "Check the form and try again.").replace(/^Value error, /, ""), field);
    }
    throw new ApiError(r.status, typeof d === "string" ? d : `Something went wrong (${r.status}).`);
  }
  return data as T;
}

const get = <T>(url: string) => request<T>("GET", url);
const post = <T>(url: string, body?: unknown) => request<T>("POST", url, body ?? {});
const put = <T>(url: string, body: unknown) => request<T>("PUT", url, body);
const patch = <T>(url: string, body: unknown) => request<T>("PATCH", url, body);
const del = <T>(url: string, body?: unknown) => request<T>("DELETE", url, body);

export const api = {
  health: () => get<Health>("/api/health"),
  meta: () => get<Meta>("/api/meta"),

  me: () => get<Session>("/api/auth/me"),
  signup: (email: string, password: string, full_name?: string) =>
    post<Session>("/api/auth/signup", { email, password, full_name }),
  login: (email: string, password: string) => post<Session>("/api/auth/login", { email, password }),
  logout: () => post<void>("/api/auth/logout"),
  tourDone: () => post<{ ok: boolean }>("/api/account/tour-done"),
  changePassword: (current_password: string, new_password: string) =>
    post<{ ok: boolean }>("/api/account/password", { current_password, new_password }),
  deleteAccount: (password: string) => del<void>("/api/account", { password }),

  saveBrand: (b: BrandInput) => put<Brand>("/api/brand", b),
  saveStores: (stores: StoreLoc[]) =>
    put<Brand>("/api/brand/stores", {
      stores: stores.map(({ name, lat, lng, locality, fsq_place_id }) => ({ name, lat, lng, locality, fsq_place_id })),
    }),
  searchPlaces: (q: string) => get<{ places: Place[] }>(`/api/places/search?q=${encodeURIComponent(q)}`),

  heatmap: () => get<{ vertical: string; count: number; hexes: HexResult[] }>("/api/heatmap"),
  rankings: (limit = 20, regions?: string[]) => {
    const q = new URLSearchParams({ limit: String(limit) });
    regions?.forEach((r) => q.append("region", r));
    return get<{ sites: RankedSite[]; regions: string[] }>(`/api/rankings?${q}`);
  },
  report: (h3_id: string) => get<HexReport>(`/api/report/${encodeURIComponent(h3_id)}`),
  compare: (h3_ids: string[]) => post<{ reports: HexReport[] }>("/api/compare", { h3_ids }),
  pins: (b: { min_lat: number; max_lat: number; min_lng: number; max_lng: number }) => {
    const q = new URLSearchParams({ ...Object.fromEntries(Object.entries(b).map(([k, v]) => [k, v.toFixed(5)])), limit: "500" });
    return get<{ pins: Pin[] }>(`/api/pins?${q}`);
  },

  shortlist: () => get<{ sites: SavedSite[] }>("/api/shortlist"),
  saveSite: (h3_id: string, note?: string) => post<SavedSite>("/api/shortlist", { h3_id, note }),
  updateSite: (id: string, note: string | null) => patch<SavedSite>(`/api/shortlist/${id}`, { note }),
  removeSite: (id: string) => del<void>(`/api/shortlist/${id}`),
};
