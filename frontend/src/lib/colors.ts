// Score -> colour. Matches tailwind `score.*` tokens.
export function scoreColor(score: number): [number, number, number, number] {
  if (score >= 75) return [47, 138, 82, 190];   // #2f8a52
  if (score >= 50) return [201, 131, 23, 165];  // #c98317
  return [194, 71, 59, 140];                    // #c2473b
}

export function scoreHex(score: number): string {
  if (score >= 75) return "#2f8a52";
  if (score >= 50) return "#c98317";
  return "#c2473b";
}

export function scoreLabel(score: number): string {
  if (score >= 80) return "Strong fit";
  if (score >= 65) return "Good fit";
  if (score >= 50) return "Mixed";
  return "Weak fit";
}

export function fmtDist(m: number | null | undefined): string {
  if (m == null) return "—";
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`;
}
