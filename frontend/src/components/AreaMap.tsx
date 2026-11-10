// Small Sydney map for choosing areas: each area is a circle you click to add or remove.
import Map, { Layer, Marker, Source, type MapLayerMouseEvent } from "react-map-gl/maplibre";

const BASEMAP = "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";

type Label = { key: string; label: string; lat: number; lng: number; on: boolean };

export function AreaMap({
  geojson, onPick, onHover, labels,
}: {
  geojson: GeoJSON.FeatureCollection;
  onPick: (key: string) => void;
  onHover: (key: string | null) => void;
  labels: Label[];
}) {
  const keyOf = (e: MapLayerMouseEvent) => (e.features?.[0]?.properties?.key as string | undefined) ?? null;

  return (
    <Map
      mapStyle={BASEMAP}
      initialViewState={{ latitude: -33.86, longitude: 151.12, zoom: 9.6 }}
      minZoom={8.5}
      maxZoom={12}
      dragRotate={false}
      touchPitch={false}
      interactiveLayerIds={["areas-fill"]}
      cursor="pointer"
      onClick={(e) => {
        const k = keyOf(e);
        if (k) onPick(k);
      }}
      onMouseMove={(e) => onHover(keyOf(e))}
      onMouseLeave={() => onHover(null)}
    >
      <Source id="areas" type="geojson" data={geojson}>
        <Layer
          id="areas-fill"
          type="fill"
          paint={{
            "fill-color": ["match", ["get", "state"], "on", "#5289AD", "all", "#5289AD", "#243C4C"],
            "fill-opacity": [
              "+",
              ["match", ["get", "state"], "on", 0.42, "all", 0.16, 0.06],
              ["*", ["get", "hover"], 0.12],
            ],
          }}
        />
        <Layer
          id="areas-line"
          type="line"
          paint={{
            "line-color": ["match", ["get", "state"], "on", "#243C4C", "#698696"],
            "line-width": ["match", ["get", "state"], "on", 2.5, 1.5],
            "line-dasharray": [2, 1.5],
          }}
        />
      </Source>

      {labels.map((l) => (
        <Marker key={l.key} latitude={l.lat} longitude={l.lng} anchor="center">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onPick(l.key);
            }}
            onMouseEnter={() => onHover(l.key)}
            onMouseLeave={() => onHover(null)}
            aria-pressed={l.on}
            className={`px-2.5 h-7 rounded-full text-[12px] font-medium whitespace-nowrap shadow-panel transition-colors ${
              l.on ? "bg-brand-navy text-brand-mint" : "bg-white/95 text-fg-primary hover:bg-white"
            }`}
          >
            {l.label}
          </button>
        </Marker>
      ))}
    </Map>
  );
}
