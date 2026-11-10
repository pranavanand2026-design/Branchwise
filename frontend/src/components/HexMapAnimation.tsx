// Animated hex map for the sign-in screens: zones light up in waves from the
// centre, a pin drops on the best one, and everything speeds up while signing in.
import { useMemo } from "react";

type Hex = { x: number; y: number; v: number; d: number };

const R = 15; // hex radius
const W = Math.sqrt(3) * R;
const COLS = 28;
const ROWS = 26;
const VIEW_W = COLS * W + W;
const VIEW_H = ROWS * 1.5 * R + R;

// Deterministic "opportunity" field: a few soft peaks, like busy centres
const PEAKS = [
  { x: 0.56, y: 0.42, s: 0.16, h: 1 },
  { x: 0.34, y: 0.58, s: 0.12, h: 0.8 },
  { x: 0.7, y: 0.66, s: 0.1, h: 0.7 },
  { x: 0.44, y: 0.24, s: 0.09, h: 0.6 },
];

function field(nx: number, ny: number): number {
  return PEAKS.reduce((acc, p) => acc + p.h * Math.exp(-((nx - p.x) ** 2 + (ny - p.y) ** 2) / (2 * p.s * p.s)), 0);
}

// a coastline-ish outline: land to the west, water to the east
function onLand(nx: number, ny: number, i: number): boolean {
  const coast = 0.86 - 0.12 * Math.sin(ny * 7.5) - 0.05 * Math.cos(ny * 17 + 1);
  const jitter = ((i * 9301 + 49297) % 233280) / 233280;
  return nx < coast - 0.04 * jitter && ny > 0.04 && ny < 0.96 && nx > 0.03;
}

function hexPoints(cx: number, cy: number, r: number) {
  return Array.from({ length: 6 }, (_, k) => {
    const a = (Math.PI / 180) * (60 * k - 30);
    return `${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`;
  }).join(" ");
}

function colourFor(v: number): string {
  if (v > 0.75) return "#5289AD";
  if (v > 0.45) return "#698696";
  if (v > 0.2) return "#ACBCBF";
  return "#3A5263";
}

export function HexMapAnimation({ busy = false }: { busy?: boolean }) {
  const hexes = useMemo(() => {
    const out: Hex[] = [];
    let i = 0;
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++, i++) {
        const x = W / 2 + col * W + (row % 2 ? W / 2 : 0);
        const y = R + row * 1.5 * R;
        const nx = x / VIEW_W;
        const ny = y / VIEW_H;
        if (!onLand(nx, ny, i)) continue;
        const v = Math.min(1, field(nx, ny));
        out.push({ x, y, v, d: Math.hypot(nx - PEAKS[0].x, ny - PEAKS[0].y) });
      }
    }
    return out;
  }, []);

  const best = useMemo(() => hexes.reduce((a, b) => (b.v > a.v ? b : a), hexes[0]), [hexes]);
  const cycle = busy ? 1.4 : 5.2;
  const spread = busy ? 1.6 : 4.5; // seconds of delay across the map

  return (
    <svg
      viewBox={`0 0 ${VIEW_W.toFixed(0)} ${VIEW_H.toFixed(0)}`}
      className="w-full h-full"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
    >
      <rect width="100%" height="100%" fill="#243C4C" />
      {hexes.map((h, k) => (
        <polygon
          key={k}
          points={hexPoints(h.x, h.y, R * 0.9)}
          fill={colourFor(h.v)}
          style={{
            // base and peak opacity follow the zone's value, so good areas glow brighter
            ["--o0" as string]: (0.16 + h.v * 0.3).toFixed(2),
            ["--o1" as string]: (0.45 + h.v * 0.55).toFixed(2),
            opacity: 0.16 + h.v * 0.3,
            animation: `hex-glow ${cycle}s ease-in-out ${(h.d * spread).toFixed(2)}s infinite`,
            transition: "fill 400ms",
          }}
        />
      ))}

      {/* the pick: ring + pin on the best zone */}
      <g transform={`translate(${best.x} ${best.y})`}>
        <circle r={R} fill="none" stroke="#F4FCFB" strokeWidth="2.5"
          style={{ transformBox: "fill-box", transformOrigin: "center", animation: `ring-out ${busy ? 1 : 2.4}s ease-out 1.6s infinite`, opacity: 0 }} />
        <polygon points={hexPoints(0, 0, R * 0.9)} fill="#5289AD" stroke="#F4FCFB" strokeWidth="3" />
        <g style={{ animation: "pin-drop 900ms cubic-bezier(.2,.9,.3,1.2) 1.1s both" }}>
          <path d="M0 -46a15 15 0 0 1 15 15c0 12-15 26-15 26s-15-14-15-26a15 15 0 0 1 15-15z" fill="#F4FCFB" />
          <circle cy="-31" r="5.5" fill="#243C4C" />
        </g>
      </g>
    </svg>
  );
}
