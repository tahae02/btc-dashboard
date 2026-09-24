/**
 * Technical indicator maths.
 *
 * Every function here is pure and free of React, so the same code runs in the
 * app, in the test suite, and in the backtester. That is deliberate: the
 * backtest is only meaningful if it exercises the exact code the app ships.
 */
import type { OHLCVCandle, Indicators, RSIResult, MACDResult, BollingerBandsResult, StochRSIResult, SupportResistance } from '../types';

// ===== Primitives =====

export const calcSMA = (data: number[], period: number): number[] => {
  const result: number[] = [];
  if (period <= 0) return data.map(() => NaN);
  let sum = 0;
  for (let i = 0; i < data.length; i++) {
    sum += data[i] ?? 0;
    if (i >= period) sum -= data[i - period] ?? 0;
    result.push(i < period - 1 ? NaN : sum / period);
  }
  return result;
};

export const calcEMA = (data: number[], period: number): number[] => {
  const k = 2 / (period + 1);
  const result: number[] = [];
  let prev = NaN;
  for (let i = 0; i < data.length; i++) {
    const val = data[i] ?? 0;
    if (i < period - 1) {
      result.push(NaN);
    } else if (i === period - 1) {
      let sum = 0;
      for (let j = 0; j < period; j++) sum += data[j] ?? 0;
      prev = sum / period;
      result.push(prev);
    } else {
      prev = val * k + prev * (1 - k);
      result.push(prev);
    }
  }
  return result;
};

/** Last non-NaN entry of a series, or null when the series never warmed up. */
export const lastValid = (values: number[]): number | null => {
  for (let i = values.length - 1; i >= 0; i--) {
    const v = values[i];
    if (v != null && !isNaN(v)) return v;
  }
  return null;
};

// ===== Momentum =====

/** RSI with Wilder's smoothing. `values` is index-aligned to `closes`. */
export const calcRSI = (closes: number[], period: number = 14): RSIResult | null => {
  if (closes.length < period + 1) return null;
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const diff = (closes[i] ?? 0) - (closes[i - 1] ?? 0);
    if (diff > 0) avgGain += diff;
    else avgLoss += Math.abs(diff);
  }
  avgGain /= period;
  avgLoss /= period;

  const values: number[] = new Array(period).fill(NaN);
  values.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss));

  for (let i = period + 1; i < closes.length; i++) {
    const diff = (closes[i] ?? 0) - (closes[i - 1] ?? 0);
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? Math.abs(diff) : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    values.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss));
  }
  return { value: values[values.length - 1] ?? 50, values };
};

export const calcMACD = (closes: number[], fast = 12, slow = 26, signal = 9): MACDResult | null => {
  if (closes.length < slow + signal) return null;
  const emaFast = calcEMA(closes, fast);
  const emaSlow = calcEMA(closes, slow);

  const macdLine: number[] = [];
  for (let i = 0; i < closes.length; i++) {
    const f = emaFast[i];
    const s = emaSlow[i];
    macdLine.push(f == null || s == null || isNaN(f) || isNaN(s) ? NaN : f - s);
  }

  // The signal line is an EMA of the MACD line, computed over the warmed-up
  // section only, then written back into index-aligned positions.
  const validMacd = macdLine.filter((v) => !isNaN(v));
  const signalCompact = calcEMA(validMacd, signal);
  const signalValues: number[] = [];
  let idx = 0;
  for (let i = 0; i < macdLine.length; i++) {
    if (isNaN(macdLine[i] ?? NaN)) signalValues.push(NaN);
    else signalValues.push(signalCompact[idx++] ?? NaN);
  }

  const histogramValues = macdLine.map((m, i) => {
    const s = signalValues[i];
    return isNaN(m) || s == null || isNaN(s) ? NaN : m - s;
  });

  return {
    macdLine: lastValid(macdLine) ?? 0,
    signalLine: lastValid(signalValues) ?? 0,
    histogram: lastValid(histogramValues) ?? 0,
    macdValues: macdLine,
    signalValues,
    histogramValues,
  };
};

export const calcBollingerBands = (closes: number[], period = 20, stdDev = 2): BollingerBandsResult | null => {
  if (closes.length < period) return null;
  const middleValues = calcSMA(closes, period);
  const upperValues: number[] = [];
  const lowerValues: number[] = [];

  for (let i = 0; i < closes.length; i++) {
    const mid = middleValues[i];
    if (mid == null || isNaN(mid)) {
      upperValues.push(NaN);
      lowerValues.push(NaN);
      continue;
    }
    let sumSq = 0;
    for (let j = i - period + 1; j <= i; j++) sumSq += Math.pow((closes[j] ?? 0) - mid, 2);
    const sd = Math.sqrt(sumSq / period);
    upperValues.push(mid + stdDev * sd);
    lowerValues.push(mid - stdDev * sd);
  }

  const middle = lastValid(middleValues) ?? 0;
  const upper = lastValid(upperValues) ?? 0;
  const lower = lastValid(lowerValues) ?? 0;
  return {
    upper,
    middle,
    lower,
    upperValues,
    middleValues,
    lowerValues,
    bandwidth: middle !== 0 ? (upper - lower) / middle : 0,
  };
};

export const calcStochRSI = (
  closes: number[],
  rsiPeriod = 14,
  stochPeriod = 14,
  kSmooth = 3,
  dSmooth = 3
): StochRSIResult | null => {
  const rsi = calcRSI(closes, rsiPeriod);
  if (!rsi) return null;
  const rsiVals = rsi.values.filter((v) => !isNaN(v));
  if (rsiVals.length < stochPeriod) return null;

  const stochK: number[] = [];
  for (let i = stochPeriod - 1; i < rsiVals.length; i++) {
    const slice = rsiVals.slice(i - stochPeriod + 1, i + 1);
    const min = Math.min(...slice);
    const max = Math.max(...slice);
    // Clamped because floating-point error can push a value that sits exactly
    // on the window's min or max a hair outside [0, 100], and StochRSI is
    // defined on that range. A stray -1e-14 would defeat a `k <= 0` check.
    const raw = max === min ? 50 : (((rsiVals[i] ?? 0) - min) / (max - min)) * 100;
    stochK.push(Math.min(100, Math.max(0, raw)));
  }
  const smoothK = calcSMA(stochK, kSmooth);
  const smoothD = calcSMA(smoothK.filter((v) => !isNaN(v)), dSmooth);
  // calcSMA keeps a rolling sum, which is fast but drifts by ~1e-14 over long
  // series. On price data that is irrelevant; here the output has a defined
  // domain of [0, 100] and a stray -1e-14 would defeat an oversold check, so
  // the result is clamped at the boundary where the domain is known.
  const bound = (v: number | null): number => Math.min(100, Math.max(0, v ?? 50));
  return { k: bound(lastValid(smoothK)), d: bound(lastValid(smoothD)) };
};

// ===== Volatility =====

/** Average True Range, Wilder-smoothed. Returns the full index-aligned series. */
export const calcATRSeries = (candles: OHLCVCandle[], period = 14): number[] => {
  const out: number[] = new Array(candles.length).fill(NaN);
  if (candles.length < period + 1) return out;

  const trs: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    const p = candles[i - 1];
    trs.push(
      Math.max(
        (c?.high ?? 0) - (c?.low ?? 0),
        Math.abs((c?.high ?? 0) - (p?.close ?? 0)),
        Math.abs((c?.low ?? 0) - (p?.close ?? 0))
      )
    );
  }

  let atr = 0;
  for (let i = 0; i < period; i++) atr += trs[i] ?? 0;
  atr /= period;
  out[period] = atr; // trs[i] corresponds to candles[i + 1]
  for (let i = period; i < trs.length; i++) {
    atr = (atr * (period - 1) + (trs[i] ?? 0)) / period;
    out[i + 1] = atr;
  }
  return out;
};

export const calcATR = (candles: OHLCVCandle[], period = 14): number | null =>
  candles.length < period + 1 ? null : lastValid(calcATRSeries(candles, period));

// ===== Structure =====

/**
 * Swing-pivot support and resistance, ordered NEAREST FIRST.
 *
 * The previous implementation sorted highs descending and lows ascending and
 * then took index 0, which returned the FURTHEST level while labelling it
 * "nearest". That fed the entry/target prices shown on the Signals screen, so
 * the app suggested buying ~20% below spot and selling ~30% above it. Levels
 * are now ranked by absolute distance from the current price.
 *
 * Levels are taken from confirmed swing pivots (a bar whose high/low exceeds
 * its neighbours) rather than from every bar, so a level means "price actually
 * turned here" instead of "this bar happened to be the highest".
 */
export const calcSupportResistance = (
  candles: OHLCVCandle[],
  lookback = 60,
  pivotWidth = 2,
  clusterPct = 0.005
): SupportResistance => {
  if (candles.length < 5) return { supports: [], resistances: [] };

  const recent = candles.slice(-lookback);
  const price = recent[recent.length - 1]?.close ?? 0;
  if (price <= 0) return { supports: [], resistances: [] };

  const pivotHighs: number[] = [];
  const pivotLows: number[] = [];
  for (let i = pivotWidth; i < recent.length - pivotWidth; i++) {
    const h = recent[i]?.high ?? 0;
    const l = recent[i]?.low ?? 0;
    let isHigh = true;
    let isLow = true;
    for (let j = i - pivotWidth; j <= i + pivotWidth; j++) {
      if (j === i) continue;
      if ((recent[j]?.high ?? 0) >= h) isHigh = false;
      if ((recent[j]?.low ?? 0) <= l) isLow = false;
    }
    if (isHigh) pivotHighs.push(h);
    if (isLow) pivotLows.push(l);
  }

  // Fall back to plain bar extremes when the window has no confirmed pivots
  // (short or extremely smooth series), so the caller always gets something.
  const highs = pivotHighs.length ? pivotHighs : recent.map((c) => c?.high ?? 0);
  const lows = pivotLows.length ? pivotLows : recent.map((c) => c?.low ?? 0);

  const rank = (vals: number[]): number[] => {
    const sorted = [...vals].sort((a, b) => Math.abs(a - price) - Math.abs(b - price));
    const clusters: number[] = [];
    for (const v of sorted) {
      if (v <= 0) continue;
      if (!clusters.some((c) => Math.abs(c - v) / v < clusterPct)) clusters.push(v);
      if (clusters.length >= 3) break;
    }
    return clusters;
  };

  return {
    resistances: rank(highs.filter((h) => h > price)),
    supports: rank(lows.filter((l) => l < price)),
  };
};

// ===== Aggregate =====

/**
 * Compute every indicator from a candle series.
 *
 * `candles` must contain only CLOSED bars. See `dropIncompleteCandle`.
 */
export const computeIndicators = (candles: OHLCVCandle[]): Indicators => {
  if (!candles || candles.length < 2) {
    return {
      rsi: null, macd: null, bollingerBands: null,
      ema9: null, ema21: null, sma50: null, sma200: null,
      ema9Values: [], ema21Values: [], sma50Values: [], sma200Values: [],
      stochRSI: null, atr: null, volumeAvg20: null, currentVolume: null,
      supportResistance: { supports: [], resistances: [] },
      goldenCross: false, deathCross: false,
      sma200Slope: null, priceVsSma200Pct: null, atrPct: null,
    };
  }

  const closes = candles.map((c) => c?.close ?? 0);
  const volumes = candles.map((c) => c?.volume ?? 0);
  const price = closes[closes.length - 1] ?? 0;

  const ema9Values = calcEMA(closes, 9);
  const ema21Values = calcEMA(closes, 21);
  const sma50Values = calcSMA(closes, 50);
  const sma200Values = calcSMA(closes, 200);

  const valid50 = sma50Values.filter((v) => !isNaN(v));
  const valid200 = sma200Values.filter((v) => !isNaN(v));
  const prev50 = valid50.length >= 2 ? valid50[valid50.length - 2] ?? 0 : 0;
  const prev200 = valid200.length >= 2 ? valid200[valid200.length - 2] ?? 0 : 0;
  const cur50 = valid50[valid50.length - 1] ?? 0;
  const cur200 = valid200[valid200.length - 1] ?? 0;

  // Slope of the 200 SMA over the last 20 bars, as a percentage. This is the
  // regime engine's primary read on trend direction: a rising long-term mean
  // is a far more stable signal than any oscillator.
  let sma200Slope: number | null = null;
  if (valid200.length >= 21) {
    const then = valid200[valid200.length - 21] ?? 0;
    if (then > 0) sma200Slope = ((cur200 - then) / then) * 100;
  }

  const atr = calcATR(candles);

  return {
    rsi: calcRSI(closes),
    macd: calcMACD(closes),
    bollingerBands: calcBollingerBands(closes),
    ema9: lastValid(ema9Values),
    ema21: lastValid(ema21Values),
    sma50: cur50 || null,
    sma200: cur200 || null,
    ema9Values,
    ema21Values,
    sma50Values,
    sma200Values,
    stochRSI: calcStochRSI(closes),
    atr,
    volumeAvg20: volumes.length >= 20 ? volumes.slice(-20).reduce((a, b) => a + b, 0) / 20 : null,
    currentVolume: volumes[volumes.length - 1] ?? null,
    supportResistance: calcSupportResistance(candles),
    goldenCross: prev50 > 0 && prev200 > 0 && prev50 <= prev200 && cur50 > cur200,
    deathCross: prev50 > 0 && prev200 > 0 && prev50 >= prev200 && cur50 < cur200,
    sma200Slope,
    priceVsSma200Pct: cur200 > 0 ? ((price - cur200) / cur200) * 100 : null,
    atrPct: atr != null && price > 0 ? (atr / price) * 100 : null,
  };
};
