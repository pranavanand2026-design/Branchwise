// Score -> colour. The map keeps the original traffic-light scale (green, amber, red);
// the rest of the UI uses the brand palette.

export type Fit = "strong" | "good" | "mixed" | "weak";

export function fitOf(score: number): Fit {
  if (score >= 80) return "strong";
  if (score >= 65) return "good";
  if (score >= 45) return "mixed";
  return "weak";
}

/** Map fill: green 70+, amber 45-69, red under 45 (the original GapMap colours).
 *  Red is kept light: most of suburban Sydney is a weak fit for a shopfront, and the
 *  map should show where is good, not shout about everywhere that isn't. */
export function scoreColor(score: number): [number, number, number, number] {
  if (score >= 70) return [59, 178, 115, 205];  // #3BB273
  if (score >= 45) return [245, 166, 35, 170];  // #F5A623
  return [232, 93, 93, 85];                      // #E85D5D, light
}

/** Swatch colour (same scale as the map). */
export function scoreFill(score: number): string {
  if (score >= 70) return "#3BB273";
  if (score >= 45) return "#F5A623";
  return "#E85D5D";
}

/** Readable text colour for the same scale (darker, 4.5:1 on white). */
export function scoreHex(score: number): string {
  if (score >= 70) return "#1E7A4B";
  if (score >= 45) return "#9A5B00";
  return "#B83A3A";
}

export function scoreLabel(score: number): string {
  return { strong: "Great fit", good: "Good fit", mixed: "Worth a look", weak: "Poor fit" }[fitOf(score)];
}

export function fmtDist(m: number | null | undefined): string {
  if (m == null) return "—";
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`;
}
