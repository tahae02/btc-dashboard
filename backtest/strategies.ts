/**
 * Strategies under test, plus the benchmarks they have to beat.
 *
 * The benchmarks matter as much as the strategy. Two in particular:
 *
 *   - Buy and hold / flat DCA. If the engine cannot beat simply buying, all
 *     the machinery is costing you money and attention for nothing.
 *   - "Price above its 200-day average". This is a one-line rule. If the full
 *     engine cannot beat it, the extra complexity is not earning its keep and
 *     should be cut. Including it is the cheapest defence against fooling
 *     yourself that sophistication equals edge.
 */
import type { OHLCVCandle, SignalConfig } from '../src/types';
import { computeIndicators, calcSMA } from '../src/services/indicators';
import { computeSignal, DEFAULT_CONFIG } from '../src/services/signalEngine';
import type { Strategy } from './engine';

/** Always fully invested. In DCA mode this deploys each contribution at once. */
export const buyAndHold: Strategy = {
  name: 'Buy & hold',
  description: 'Always 100% in BTC. Contributions deployed the moment they arrive.',
  targetAllocation: () => 1,
};

/**
 * The classic trend filter: in when price is above its 200-day average, out
 * when below. One line, no parameters beyond the window.
 */
export const sma200Filter: Strategy = {
  name: 'SMA200 filter',
  description: '100% in BTC while price is above its 200-day average, otherwise 0%.',
  targetAllocation: ({ history }) => {
    const closes = history.map((c) => c.close);
    if (closes.length < 200) return 1;
    const sma = calcSMA(closes, 200);
    const last = sma[sma.length - 1];
    const price = closes[closes.length - 1] ?? 0;
    if (last == null || isNaN(last)) return 1;
    return price > last ? 1 : 0;
  },
};

/** Softer version of the above: scales exposure rather than switching it. */
export const sma200Graded: Strategy = {
  name: 'SMA200 graded',
  description: 'Exposure scales with how far price sits above or below its 200-day average.',
  targetAllocation: ({ history }) => {
    const closes = history.map((c) => c.close);
    if (closes.length < 200) return 1;
    const sma = calcSMA(closes, 200);
    const last = sma[sma.length - 1];
    const price = closes[closes.length - 1] ?? 0;
    if (last == null || isNaN(last) || last <= 0) return 1;
    const pct = ((price - last) / last) * 100;
    // -20% below -> 0, +20% above -> 1, linear in between.
    return Math.min(1, Math.max(0, (pct + 20) / 40));
  },
};

/** The app's own engine, driving allocation directly. */
export const signalEngineStrategy = (
  config: SignalConfig = DEFAULT_CONFIG,
  name = 'Signal engine'
): Strategy => ({
  name,
  description: 'Regime sets a base allocation; stretch and momentum adjust it within a band.',
  rebalanceBand: config.rebalanceBand,
  targetAllocation: ({ history }) => {
    // History from the engine is already closed bars only, so no trimming here.
    const indicators = computeIndicators(history as OHLCVCandle[]);
    const price = history[history.length - 1]?.close ?? 0;
    // Fear & Greed has no reliable history before 2018 and is not in the OHLCV
    // data, so it is left out of the backtest rather than approximated. It only
    // ever moves the allocation by a few points anyway.
    return computeSignal({ indicators, currentPrice: price, fearGreed: null, config }).targetAllocation;
  },
});

/** Regime layer alone, to see how much the faster layers actually add. */
export const regimeOnlyStrategy = (config: SignalConfig = DEFAULT_CONFIG): Strategy =>
  signalEngineStrategy({ ...config, stretchWeight: 0, momentumWeight: 0 }, 'Regime only');

export const BENCHMARKS: Strategy[] = [buyAndHold, sma200Filter, sma200Graded];
