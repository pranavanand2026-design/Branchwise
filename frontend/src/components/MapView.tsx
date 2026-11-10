import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Map, { Marker, type MapRef, useControl } from "react-map-gl/maplibre";
import { H3HexagonLayer } from "@deck.gl/geo-layers";
import { MapboxOverlay, type MapboxOverlayProps } from "@deck.gl/mapbox";
import { api, priParam, type HexResult, type Pin } from "../lib/api";
import { useWorkspace } from "../lib/store";
import { useSession } from "../lib/session";
import { scoreColor, scoreHex, scoreLabel } from "../lib/colors";

const INITIAL_VIEW = { latitude: -33.875, longitude: 151.16, zoom: 11.3, pitch: 0, bearing: 0 };
const BASEMAP = "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";

/**
 * deck.gl overlay as a map control, drawn on its own canvas over the map.
 * - A fresh MapboxOverlay is made on every add: React StrictMode adds, removes and
 *   re-adds controls in development, and a removed overlay keeps a finalised Deck.
 * - Position "top-left": the overlay's container is absolutely placed at 0,0 inside
 *   that control corner; in any other corner it lands off the map.
 * - Not interleaved, so hexes draw even while the basemap style is still loading.
 */
function DeckGLOverlay(props: MapboxOverlayProps) {
  const overlayRef = useRef<MapboxOverlay | null>(null);
  const propsRef = useRef(props);
  propsRef.current = props;
  useControl(
    () => ({
      onAdd(map) {
        overlayRef.current = new MapboxOverlay({ ...propsRef.current, interleaved: false });
        return overlayRef.current.onAdd(map as never);
      },
      onRemove() {
        overlayRef.current?.onRemove();
        overlayRef.current = null;
      },
    }),
    { position: "top-left" }
  );
  overlayRef.current?.setProps(props);
  return null;
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

export function MapView({ onOpenSite }: { onOpenSite: (h3: string, lat: number, lng: number) => void }) {
  const mapRef = useRef<MapRef>(null);
  const [pins, setPins] = useState<Pin[]>([]);
  const brand = useSession((s) => s.brand);
  const {
    hexes, loadingHeatmap, heatmapError, layers, selectedHex, hoveredHex, ranked, compareIds, flyTo, set,
    scenario, places,
  } = useWorkspace();
  const pri = priParam(scenario?.priorities);

  useEffect(() => {
    if (!flyTo) return;
    mapRef.current?.flyTo({ center: [flyTo.lng, flyTo.lat], zoom: flyTo.zoom, duration: 1100, essential: true });
  }, [flyTo?.tick]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadHeatmap = useCallback(() => {
    set({ loadingHeatmap: true, heatmapError: null });
    api
      .heatmap(pri)
      .then((d) => set({ hexes: d.hexes }))
      .catch((e) => set({ hexes: [], heatmapError: (e as Error).message }))
      .finally(() => set({ loadingHeatmap: false }));
  }, [set, pri]);

  // Reload whenever the profile (or the assistant's what-if) that drives scoring changes
  const profileKey = brand ? JSON.stringify([brand.vertical, brand.priorities, brand.stores.length, pri]) : "";
  useEffect(() => {
    if (brand) loadHeatmap();
  }, [profileKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadPins = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    if (map.getZoom() < 12.5) return setPins([]); // too many to be useful when zoomed out
    const b = map.getBounds();
    api
      .pins({ min_lat: b.getSouth(), max_lat: b.getNorth(), min_lng: b.getWest(), max_lng: b.getEast() })
      .then((d) => setPins(d.pins))
      .catch(() => setPins([]));
  }, []);

  useEffect(() => {
    loadPins();
  }, [profileKey, loadPins]);

  const topTen = useMemo(() => ranked.slice(0, 10), [ranked]);
  const highlight = useMemo(
    () => [...new Set([hoveredHex, selectedHex?.h3_id, ...compareIds].filter(Boolean) as string[])],
    [hoveredHex, selectedHex?.h3_id, compareIds]
  );

  const deckLayers = [
    new H3HexagonLayer<HexResult>({
      id: "hexes",
      visible: layers.opportunity,
      data: hexes,
      getHexagon: (d) => d.h3_id,
      getFillColor: (d) => scoreColor(d.score),
      getLineColor: [255, 255, 255, 200],
      lineWidthMinPixels: 0.6,
      filled: true,
      stroked: true,
      extruded: false,
      pickable: true,
      opacity: 0.55,
      autoHighlight: true,
      highlightColor: [10, 10, 10, 40],
      onClick: ({ object }) => object && onOpenSite(object.h3_id, object.lat, object.lng),
      onHover: ({ object }) => set({ hoveredHex: object?.h3_id ?? null }),
      updateTriggers: { getFillColor: [hexes] },
    }),
    new H3HexagonLayer<{ h3_id: string }>({
      id: "highlight",
      data: highlight.map((h3_id) => ({ h3_id })),
      getHexagon: (d) => d.h3_id,
      filled: false,
      stroked: true,
      getLineColor: [10, 10, 10, 235],
      lineWidthMinPixels: 2.5,
      pickable: false,
    }),
  ];

  const getTooltip = ({ object, layer }: { object?: HexResult; layer?: { id: string } | null }) => {
    if (!object || layer?.id !== "hexes") return null;
    return {
      html: `<div style="background:#fff;border:1px solid rgba(36,60,76,.14);border-radius:10px;padding:10px 14px;font:14px 'IBM Plex Sans',sans-serif;color:#243C4C;box-shadow:0 8px 24px rgba(36,60,76,.14);min-width:150px">
        <div style="font-weight:500">${esc(object.locality ?? "Sydney")}</div>
        <div style="display:flex;align-items:baseline;gap:6px;margin-top:4px">
          <span style="font:400 28px/1 Reglo,'IBM Plex Sans',sans-serif;color:${scoreHex(object.score)}">${object.score}</span>
          <span style="color:#516C7C;font-size:13px">/100 · ${scoreLabel(object.score)}</span>
        </div>
      </div>`,
      style: { background: "transparent", border: "none", padding: "0" },
    };
  };

  return (
    <div className="relative w-full h-full" data-tour="map">
      <Map
        ref={mapRef}
        mapStyle={BASEMAP}
        initialViewState={INITIAL_VIEW}
        onMoveEnd={loadPins}
        onLoad={loadPins}
        minZoom={9.5}
        maxZoom={17}
        maxBounds={[[150.3, -34.4], [151.7, -33.3]]}
      >
        <DeckGLOverlay layers={deckLayers} getTooltip={getTooltip as never} />

        {layers.competitors &&
          pins.filter((p) => p.is_competitor).map((p) => (
            <Marker key={p.fsq_place_id} longitude={p.longitude} latitude={p.latitude} anchor="center">
              <span
                className="block w-2.5 h-2.5 rounded-full bg-score-weak ring-2 ring-white shadow"
                title={`${p.name} · competitor`}
              />
            </Marker>
          ))}

        {layers.complementary &&
          pins.filter((p) => (p.is_complementary || p.is_anchor) && !p.is_competitor).map((p) => (
            <Marker key={p.fsq_place_id} longitude={p.longitude} latitude={p.latitude} anchor="center">
              <span
                className={`block rounded-full ring-2 ring-white shadow ${p.is_anchor ? "w-3 h-3 bg-[#243C4C]" : "w-2 h-2 bg-[#698696]"}`}
                title={`${p.name} · ${p.is_anchor ? "anchor" : "complementary"}`}
              />
            </Marker>
          ))}

        {layers.own_stores &&
          brand?.stores.map((s, i) => (
            <Marker key={s.id ?? i} longitude={s.lng} latitude={s.lat} anchor="bottom">
              <svg width="22" height="28" viewBox="0 0 26 34" aria-label={`${s.name} (your store)`} role="img">
                <title>{`${s.name} · your store`}</title>
                <path d="M13 0C5.8 0 0 5.8 0 13c0 9.1 13 21 13 21s13-11.9 13-21C26 5.8 20.2 0 13 0z" fill="#243C4C" />
                <circle cx="13" cy="13" r="5" fill="#fff" />
              </svg>
            </Marker>
          ))}

        {places.map((p) => (
          <Marker key={`place-${p.id}`} longitude={p.lng} latitude={p.lat} anchor="center">
            <span className="group relative block">
              <span className="block w-3.5 h-3.5 rotate-45 rounded-[3px] bg-accent-blue ring-2 ring-white shadow" />
              <span className="pointer-events-none absolute left-1/2 bottom-5 -translate-x-1/2 hidden group-hover:block whitespace-nowrap rounded-sm bg-white px-2.5 py-1.5 text-[13px] shadow-pop border border-bg-border">
                <b className="font-medium">{p.name}</b>
                <span className="text-fg-tertiary"> · {p.category ?? "Place"}{p.suburb ? `, ${p.suburb}` : ""}</span>
              </span>
            </span>
          </Marker>
        ))}

        {topTen.map((s) => (
          <Marker
            key={`rank-${s.h3_id}`}
            longitude={s.lng}
            latitude={s.lat}
            anchor="center"
            onClick={(e) => {
              e.originalEvent.stopPropagation();
              onOpenSite(s.h3_id, s.lat, s.lng);
            }}
          >
            <button
              className={`relative grid place-items-center w-7 h-7 rounded-full text-[13px] font-medium tabular shadow-pop transition-transform hover:scale-110 ${
                selectedHex?.h3_id === s.h3_id || hoveredHex === s.h3_id ? "bg-accent text-white scale-110" : "bg-white text-fg-primary"
              }`}
              aria-label={`Ranked site ${s.rank}: ${s.locality ?? "Sydney"}, score ${s.score}`}
              onMouseEnter={() => set({ hoveredHex: s.h3_id })}
              onMouseLeave={() => set({ hoveredHex: null })}
            >
              {s.rank === 1 && <span className="absolute inset-0 rounded-full bg-accent/40 animate-ping motion-reduce:hidden" aria-hidden="true" />}
              <span className="relative">{s.rank}</span>
            </button>
          </Marker>
        ))}
      </Map>

      {loadingHeatmap && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 h-9 px-4 rounded-full bg-white shadow-panel border border-bg-border text-sm flex items-center gap-2 z-10" role="status">
          <span className="w-3.5 h-3.5 border-2 border-accent border-t-transparent rounded-full animate-spin" aria-hidden="true" />
          Finding the best areas for {brand?.name}
        </div>
      )}
      {!loadingHeatmap && heatmapError && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 max-w-md h-10 pl-4 pr-1.5 rounded-full bg-danger-soft border border-danger/20 text-sm text-danger flex items-center gap-3 z-10" role="alert">
          <span className="truncate">The map didn't load. {heatmapError}</span>
          <button className="btn-sm btn bg-white text-danger hover:bg-danger/10" onClick={loadHeatmap}>Retry</button>
        </div>
      )}
    </div>
  );
}
