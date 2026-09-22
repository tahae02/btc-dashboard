/**
 * Settings validation.
 *
 * Kept out of the React context on purpose: this is pure logic with real
 * invariants, so it belongs somewhere it can be tested directly.
 *
 * Settings are validated as a WHOLE rather than field by field. The previous
 * version checked each RSI threshold in isolation, which let you set oversold
 * to 90 and overbought to 10 — silently inverting every reading that depended
 * on them, with nothing in the UI to say so. Cross-field rules only work where
 * both values are visible at once.
 */
import type { Settings, RefreshInterval, Currency, Timeframe } from '../types';

export const DEFAULT_SETTINGS: Settings = {
  refreshInterval: '5min',
  currency: 'USD',
  signalTimeframe: '1D',
  rsiOverbought: 70,
  rsiOversold: 30,
  stretchWeight: 0.15,
};

/** Minimum gap between the RSI bands for them to mean anything. */
export const MIN_RSI_GAP = 5;

const TIMEFRAMES: Timeframe[] = ['1H', '4H', '1D', '1W'];
const INTERVALS: RefreshInterval[] = ['manual', '1min', '5min'];
const CURRENCIES: Currency[] = ['USD', 'GBP'];

const clamp = (v: unknown, lo: number, hi: number, fallback: number): number => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
};

export const sanitiseSettings = (input: Partial<Settings> | null | undefined): Settings => {
  const merged = { ...DEFAULT_SETTINGS, ...(input ?? {}) };

  let oversold = clamp(merged.rsiOversold, 1, 99, DEFAULT_SETTINGS.rsiOversold);
  let overbought = clamp(merged.rsiOverbought, 1, 99, DEFAULT_SETTINGS.rsiOverbought);
  // An inverted or collapsed pair is rejected outright rather than silently
  // half-corrected, because either single value could be the intended one and
  // guessing wrong would quietly change what every signal means.
  if (oversold >= overbought - MIN_RSI_GAP) {
    oversold = DEFAULT_SETTINGS.rsiOversold;
    overbought = DEFAULT_SETTINGS.rsiOverbought;
  }

  return {
    refreshInterval: INTERVALS.includes(merged.refreshInterval) ? merged.refreshInterval : DEFAULT_SETTINGS.refreshInterval,
    currency: CURRENCIES.includes(merged.currency) ? merged.currency : DEFAULT_SETTINGS.currency,
    signalTimeframe: TIMEFRAMES.includes(merged.signalTimeframe) ? merged.signalTimeframe : DEFAULT_SETTINGS.signalTimeframe,
    rsiOversold: oversold,
    rsiOverbought: overbought,
    // Capped at 0.5: beyond that the mean-reversion layer starts overriding
    // the regime, which is the failure mode this engine was built to avoid.
    stretchWeight: clamp(merged.stretchWeight, 0, 0.5, DEFAULT_SETTINGS.stretchWeight),
  };
};
