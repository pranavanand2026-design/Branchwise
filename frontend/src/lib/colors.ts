// Fit -> colour, in the brand blues. Matches tailwind `score.*` tokens.
// The app talks in fit labels; the 0-100 number sits behind "details".

export type Fit = "strong" | "good" | "mixed" | "weak";

export function fitOf(score: number): Fit {
  if (score >= 80) return "strong";
  if (score >= 65) return "good";
  if (score >= 50) return "mixed";
  return "weak";
}

const RGBA: Record<Fit, [number, number, number, number]> = {
  strong: [46, 106, 147, 205], // #2E6A93
  good: [82, 137, 173, 165],   // #5289AD
  mixed: [172, 188, 191, 130], // #ACBCBF
  weak: [214, 196, 186, 95],   // warm grey, quiet
};

const HEX: Record<Fit, string> = {
  strong: "#2E6A93",
  good: "#3F7AA3",
  mixed: "#5F7882",
  weak: "#A0614B",
};

export function scoreColor(score: number): [number, number, number, number] {
  return RGBA[fitOf(score)];
}

export function scoreHex(score: number): string {
  return HEX[fitOf(score)];
}

export function scoreLabel(score: number): string {
  return { strong: "Great fit", good: "Good fit", mixed: "Worth a look", weak: "Poor fit" }[fitOf(score)];
}

export function fmtDist(m: number | null | undefined): string {
  if (m == null) return "—";
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`;
}
