/**
 * "What if Bitcoin hits…" calculator: what a holding or an amount would be
 * worth at a price you pick.
 *
 * Pure (no storage, no React) so it can be tested directly. This is
 * arithmetic on a price the owner chooses, not a forecast: nothing here says
 * how likely any price is.
 *
 * The slider runs on a log scale, so $10k to $100k takes the same width as
 * $100k to $1M. On a straight scale everything under $100k would be squeezed
 * into the first tenth of the track.
 */
import type { Currency } from '../types';
import { convert, type LivePrices } from './journal';

/** The slider's ends, in whichever currency it is showing. */
export const SCALE_MIN = 10_000;
export const SCALE_MAX = 1_000_000;

/** Quick picks under the slider. */
export const PRESET_PRICES = [50_000, 75_000, 100_000, 150_000, 200_000, 250_000, 500_000, 1_000_000];

/** Labelled marks along the track. */
export const SCALE_TICKS = [10_000, 50_000, 100_000, 250_000, 500_000, 1_000_000];

/** Largest price you can type in. */
export const MAX_TARGET = 100_000_000;

/** Round-number steps the slider snaps to: finer at lower prices. */
export const priceStep = (price: number): number => (price < 100_000 ? 1_000 : price < 500_000 ? 5_000 : 10_000);

const clampScale = (price: number) => Math.min(SCALE_MAX, Math.max(SCALE_MIN, price));

/** Nearest round step, kept inside the slider's range. */
export const snapPrice = (price: number): number => {
  const p = clampScale(price);
  const step = priceStep(p);
  return clampScale(Math.round(p / step) * step);
};

/** Where a price sits along the track, 0 (left) to 1 (right). Prices off the scale pin to an end. */
export const positionForPrice = (price: number): number => {
  if (!(price > 0)) return 0;
  const t = Math.log(price / SCALE_MIN) / Math.log(SCALE_MAX / SCALE_MIN);
  return Math.min(1, Math.max(0, t));
};

/** The snapped price at a point along the track. */
export const priceAtPosition = (position: number): number => {
  const t = Math.min(1, Math.max(0, position));
  return snapPrice(SCALE_MIN * Math.pow(SCALE_MAX / SCALE_MIN, t));
};

/** One step up or down from any price, landing on a round number ($123,456 up is $125,000). */
export const nudgePrice = (price: number, direction: 1 | -1): number => {
  if (direction === 1) {
    const step = priceStep(price);
    return clampScale(Math.floor(price / step) * step + step);
  }
  const step = priceStep(price - 1);
  return clampScale(Math.ceil(price / step) * step - step);
};

/** Short label for the scale: 10000 -> "$10k", 1000000 -> "$1M". */
export const shortPrice = (price: number, currency: Currency): string => {
  const sym = currency === 'GBP' ? '£' : '$';
  if (price >= 1_000_000) return `${sym}${+(price / 1_000_000).toFixed(2)}M`;
  if (price >= 1_000) return `${sym}${+(price / 1_000).toFixed(1)}k`;
  return `${sym}${Math.round(price)}`;
};

/** Accepts "100000", "100,000", "£100k", "$1.5m"; null for anything else or out of range. */
export const parsePriceInput = (text: string): number | null => {
  const m = text.trim().toLowerCase().replace(/[£$,\s]/g, '').match(/^(\d*\.?\d+)([km]?)$/);
  if (!m) return null;
  const n = Number(m[1]) * (m[2] === 'k' ? 1_000 : m[2] === 'm' ? 1_000_000 : 1);
  return Number.isFinite(n) && n > 0 && n <= MAX_TARGET ? Math.round(n) : null;
};

/**
 * Starting price when nothing is saved: the first quick pick at least 5%
 * above today's price, so it opens on a "what if it goes up" round number.
 */
export const defaultTarget = (todayPrice: number | null | undefined): number => {
  if (!(todayPrice != null && todayPrice > 0)) return 100_000;
  return PRESET_PRICES.find((p) => p >= todayPrice * 1.05) ?? SCALE_MAX;
};

/** Move a target to the other currency at today's rate, onto a round step. */
export const convertTarget = (price: number, from: Currency, to: Currency, live: LivePrices): number => {
  if (from === to || !(live.usd > 0) || !(live.gbp > 0)) return price;
  const raw = convert(price, from, to, live);
  // Off the slider's range, keep the exact figure rather than pinning it.
  if (raw < SCALE_MIN || raw > SCALE_MAX) return Math.round(raw);
  return snapPrice(raw);
};

export interface ProjectionInput {
  /** BTC being valued. */
  btc: number;
  /** What it cost, or null when unknown. */
  paid: number | null;
  paidCurrency: Currency;
  /** The price picked on the slider. */
  target: number;
  targetCurrency: Currency;
  live: LivePrices;
}

export interface Projection {
  /** The picked price in both currencies (the other at today's rate). */
  targetIn: Record<Currency, number>;
  /** What the BTC would be worth at that price. */
  worth: Record<Currency, number>;
  /** What it is worth at today's price. */
  worthToday: Record<Currency, number>;
  /** What it cost, in both currencies, or null when unknown. */
  paid: Record<Currency, number> | null;
  /** Worth minus what was paid, or null when the cost is unknown. */
  gain: Record<Currency, number> | null;
  /** Gain as a fraction of what was paid. The same in both currencies, as both convert at today's rate. */
  gainPct: number | null;
  /** How far the picked price is from today's, as a fraction. */
  moveFromToday: number | null;
}

const both = (amount: number, from: Currency, live: LivePrices): Record<Currency, number> => ({
  USD: convert(amount, from, 'USD', live),
  GBP: convert(amount, from, 'GBP', live),
});

export const project = (i: ProjectionInput): Projection => {
  const today = i.targetCurrency === 'GBP' ? i.live.gbp : i.live.usd;
  const worth = both(i.btc * i.target, i.targetCurrency, i.live);
  const paid = i.paid != null && i.paid > 0 ? both(i.paid, i.paidCurrency, i.live) : null;
  return {
    targetIn: both(i.target, i.targetCurrency, i.live),
    worth,
    worthToday: { USD: i.btc * i.live.usd, GBP: i.btc * i.live.gbp },
    paid,
    gain: paid ? { USD: worth.USD - paid.USD, GBP: worth.GBP - paid.GBP } : null,
    gainPct: paid ? worth.GBP / paid.GBP - 1 : null,
    moveFromToday: today > 0 ? i.target / today - 1 : null,
  };
};

/** BTC that an amount buys at today's price, before fees; 0 without a price. */
export const btcForAmount = (amount: number, currency: Currency, live: LivePrices): number => {
  const price = currency === 'GBP' ? live.gbp : live.usd;
  return price > 0 && amount > 0 ? amount / price : 0;
};

// ===== Remembered between visits =====

export const CALCULATOR_KEY = 'btc_dashboard_calculator_v1';

export type CalculatorBasis = 'holdings' | 'amount';

export interface CalculatorState {
  /** Picked price, or null to use the default. */
  target: number | null;
  /** Currency of the slider. Dollars unless the owner switches. */
  currency: Currency;
  /** Value what you hold, or an amount you type in. */
  basis: CalculatorBasis;
  amount: number | null;
  amountCurrency: Currency;
}

export const DEFAULT_CALCULATOR: CalculatorState = {
  target: null,
  currency: 'USD',
  basis: 'holdings',
  amount: null,
  amountCurrency: 'GBP',
};

const isCurrency = (v: unknown): v is Currency => v === 'USD' || v === 'GBP';
const positive = (v: unknown, max: number): number | null =>
  typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= max ? v : null;

/** Field by field, so a damaged or older payload still loads what it can. */
export const parseCalculatorState = (raw: string | null): CalculatorState => {
  let o: Record<string, unknown> = {};
  try {
    const parsed = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) o = parsed;
  } catch { /* defaults */ }
  return {
    target: positive(o.target, MAX_TARGET),
    currency: isCurrency(o.currency) ? o.currency : DEFAULT_CALCULATOR.currency,
    basis: o.basis === 'amount' || o.basis === 'holdings' ? o.basis : DEFAULT_CALCULATOR.basis,
    amount: positive(o.amount, 1e12),
    amountCurrency: isCurrency(o.amountCurrency) ? o.amountCurrency : DEFAULT_CALCULATOR.amountCurrency,
  };
};
