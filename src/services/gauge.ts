/**
 * Geometry for the Fear & Greed half-circle gauge.
 *
 * Kept out of the component so the arc maths can be tested. The gauge used to
 * set SVG's "large arc" flag to 1 for any reading above 50. A reading never
 * spans more than half a circle, so the flag must always be 0: with it set,
 * SVG has to draw the longer way round, which it can only do on a different
 * circle, and the coloured arc came out as two stubs off the picture.
 */

/** The five bands Alternative.me uses, with the app's colour for each. */
export const FEAR_GREED_ZONES = [
  { from: 0, to: 25, label: 'Extreme fear', color: '#FF1744' },
  { from: 25, to: 45, label: 'Fear', color: '#FF6D00' },
  { from: 45, to: 55, label: 'Neutral', color: '#FFB300' },
  { from: 55, to: 75, label: 'Greed', color: '#66BB6A' },
  { from: 75, to: 100, label: 'Extreme greed', color: '#00E676' },
] as const;

/** Colour of the zone a reading falls in. */
export const fearGreedColor = (v: number): string => {
  if (v <= 25) return FEAR_GREED_ZONES[0].color;
  if (v <= 45) return FEAR_GREED_ZONES[1].color;
  if (v <= 55) return FEAR_GREED_ZONES[2].color;
  if (v <= 75) return FEAR_GREED_ZONES[3].color;
  return FEAR_GREED_ZONES[4].color;
};

const clamp = (v: number) => Math.max(0, Math.min(100, Number.isFinite(v) ? v : 0));

/** Point on the gauge for a reading: 0 is far left, 100 far right, over the top. */
export const gaugePoint = (cx: number, cy: number, r: number, value: number): { x: number; y: number } => {
  const angle = Math.PI - (clamp(value) / 100) * Math.PI;
  return { x: cx + r * Math.cos(angle), y: cy - r * Math.sin(angle) };
};

const f = (n: number) => Math.round(n * 100) / 100;

/**
 * SVG path for the arc between two readings, clockwise over the top.
 * The large-arc flag is always 0, because no part of a half circle is longer
 * than half a circle. Null when the span is empty.
 */
export const gaugeArc = (cx: number, cy: number, r: number, from: number, to: number): string | null => {
  const a = clamp(from);
  const b = clamp(to);
  if (b <= a) return null;
  const p = gaugePoint(cx, cy, r, a);
  const q = gaugePoint(cx, cy, r, b);
  return `M ${f(p.x)} ${f(p.y)} A ${f(r)} ${f(r)} 0 0 1 ${f(q.x)} ${f(q.y)}`;
};
