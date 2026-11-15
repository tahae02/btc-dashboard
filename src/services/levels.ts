/**
 * How far the live price is from a support or resistance level, in words.
 *
 * Levels come from closed bars, so the live price can already have gone
 * through one. The Signals tab used to print the plain difference whatever its
 * sign, which gave "-0.9% below" for a support the price had already fallen
 * under. The text snapshot said so; the screen did not. Both now use this.
 */
export interface LevelDistance {
  /** e.g. "2.1% below" or "already broken: the price is 0.9% under it". */
  text: string;
  /** The live price has already gone through the level. */
  broken: boolean;
  /** Absolute distance as a fraction of the live price. */
  fraction: number;
}

export const levelDistance = (price: number, level: number, kind: 'support' | 'resistance'): LevelDistance | null => {
  if (!(price > 0) || !(level > 0)) return null;
  const fraction = Math.abs(level - price) / price;
  const pct = `${(fraction * 100).toFixed(1)}%`;
  if (kind === 'support') {
    return price >= level
      ? { text: `${pct} below`, broken: false, fraction }
      : { text: `already broken: the price is ${pct} under it`, broken: true, fraction };
  }
  return price <= level
    ? { text: `${pct} above`, broken: false, fraction }
    : { text: `already broken: the price is ${pct} over it`, broken: true, fraction };
};

/** Whole dollars with thousands separators: 103861 -> "$103,861". */
export const usd0 = (n: number): string => `$${Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
