import { useMemo } from 'react';
import { OHLCVCandle, Indicators, RSIResult, MACDResult, BollingerBandsResult, StochRSIResult, SupportResistance } from '../types';

// ===== Pure calculation functions =====

const calcSMA = (data: number[], period: number): number[] => {
  const result: number[] = [];
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) { result.push(NaN); continue; }
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += data[j] ?? 0;
    result.push(sum / period);
  }
  return result;
};

const calcEMA = (data: number[], period: number): number[] => {
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

const calcRSI = (closes: number[], period: number = 14): RSIResult | null => {
  if (closes.length < period + 1) return null;
  let avgGain = 0, avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const diff = (closes[i] ?? 0) - (closes[i - 1] ?? 0);
    if (diff > 0) avgGain += diff; else avgLoss += Math.abs(diff);
  }
  avgGain /= period;
  avgLoss /= period;
  const values: number[] = [];
  for (let i = 0; i < period; i++) values.push(NaN);
  if (avgLoss === 0) { values.push(100); }
  else { const rs = avgGain / avgLoss; values.push(100 - 100 / (1 + rs)); }

  for (let i = period + 1; i < closes.length; i++) {
    const diff = (closes[i] ?? 0) - (closes[i - 1] ?? 0);
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? Math.abs(diff) : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    if (avgLoss === 0) values.push(100);
    else { const rs = avgGain / avgLoss; values.push(100 - 100 / (1 + rs)); }
  }
  const lastVal = values[values.length - 1] ?? 50;
  return { value: lastVal, values };
};

const calcMACD = (closes: number[], fast = 12, slow = 26, signal = 9): MACDResult | null => {
  if (closes.length < slow + signal) return null;
  const emaFast = calcEMA(closes, fast);
  const emaSlow = calcEMA(closes, slow);
  const macdLine: number[] = [];
  for (let i = 0; i < closes.length; i++) {
    if (isNaN(emaFast[i] ?? NaN) || isNaN(emaSlow[i] ?? NaN)) macdLine.push(NaN);
    else macdLine.push((emaFast[i] ?? 0) - (emaSlow[i] ?? 0));
  }
  const validMacd = macdLine.filter((v) => !isNaN(v));
  const signalLine = calcEMA(validMacd, signal);
  const fullSignal: number[] = [];
  let idx = 0;
  for (let i = 0; i < macdLine.length; i++) {
    if (isNaN(macdLine[i] ?? NaN)) fullSignal.push(NaN);
    else { fullSignal.push(signalLine[idx] ?? NaN); idx++; }
  }
  const histogram: number[] = macdLine.map((m, i) => {
    if (isNaN(m) || isNaN(fullSignal[i] ?? NaN)) return NaN;
    return m - (fullSignal[i] ?? 0);
  });
  const lastMacd = macdLine.filter(v => !isNaN(v));
  const lastSig = fullSignal.filter(v => !isNaN(v));
  const lastHist = histogram.filter(v => !isNaN(v));
  return {
    macdLine: lastMacd[lastMacd.length - 1] ?? 0,
    signalLine: lastSig[lastSig.length - 1] ?? 0,
    histogram: lastHist[lastHist.length - 1] ?? 0,
    macdValues: macdLine,
    signalValues: fullSignal,
    histogramValues: histogram,
  };
};

const calcBollingerBands = (closes: number[], period = 20, stdDev = 2): BollingerBandsResult | null => {
  if (closes.length < period) return null;
  const smaArr = calcSMA(closes, period);
  const upper: number[] = [], lower: number[] = [];
  for (let i = 0; i < closes.length; i++) {
    if (isNaN(smaArr[i] ?? NaN)) { upper.push(NaN); lower.push(NaN); continue; }
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += Math.pow((closes[j] ?? 0) - (smaArr[i] ?? 0), 2);
    const sd = Math.sqrt(sum / period);
    upper.push((smaArr[i] ?? 0) + stdDev * sd);
    lower.push((smaArr[i] ?? 0) - stdDev * sd);
  }
  const lastSma = smaArr.filter(v => !isNaN(v));
  const lastUpper = upper.filter(v => !isNaN(v));
  const lastLower = lower.filter(v => !isNaN(v));
  const bw = (lastSma[lastSma.length - 1] ?? 1) !== 0
    ? ((lastUpper[lastUpper.length - 1] ?? 0) - (lastLower[lastLower.length - 1] ?? 0)) / (lastSma[lastSma.length - 1] ?? 1)
    : 0;
  return {
    upper: lastUpper[lastUpper.length - 1] ?? 0,
    middle: lastSma[lastSma.length - 1] ?? 0,
    lower: lastLower[lastLower.length - 1] ?? 0,
    upperValues: upper,
    middleValues: smaArr,
    lowerValues: lower,
    bandwidth: bw,
  };
};

const calcStochRSI = (closes: number[], rsiPeriod = 14, stochPeriod = 14, kSmooth = 3, dSmooth = 3): StochRSIResult | null => {
  const rsi = calcRSI(closes, rsiPeriod);
  if (!rsi) return null;
  const rsiVals = rsi.values.filter(v => !isNaN(v));
  if (rsiVals.length < stochPeriod) return null;
  const stochK: number[] = [];
  for (let i = stochPeriod - 1; i < rsiVals.length; i++) {
    const slice = rsiVals.slice(i - stochPeriod + 1, i + 1);
    const min = Math.min(...slice);
    const max = Math.max(...slice);
    stochK.push(max === min ? 50 : ((rsiVals[i] ?? 0) - min) / (max - min) * 100);
  }
  const smoothK = calcSMA(stochK, kSmooth);
  const smoothD = calcSMA(smoothK.filter(v => !isNaN(v)), dSmooth);
  const lastK = smoothK.filter(v => !isNaN(v));
  const lastD = smoothD.filter(v => !isNaN(v));
  return { k: lastK[lastK.length - 1] ?? 50, d: lastD[lastD.length - 1] ?? 50 };
};

const calcATR = (candles: OHLCVCandle[], period = 14): number | null => {
  if (candles.length < period + 1) return null;
  const trs: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    const p = candles[i - 1];
    const tr = Math.max(
      (c?.high ?? 0) - (c?.low ?? 0),
      Math.abs((c?.high ?? 0) - (p?.close ?? 0)),
      Math.abs((c?.low ?? 0) - (p?.close ?? 0))
    );
    trs.push(tr);
  }
  let atr = 0;
  for (let i = 0; i < period; i++) atr += trs[i] ?? 0;
  atr /= period;
  for (let i = period; i < trs.length; i++) {
    atr = (atr * (period - 1) + (trs[i] ?? 0)) / period;
  }
  return atr;
};

const calcSupportResistance = (candles: OHLCVCandle[], lookback = 20): SupportResistance => {
  if (candles.length < 5) return { supports: [], resistances: [] };
  const recent = candles.slice(-lookback);
  const highs = recent.map(c => c?.high ?? 0).sort((a, b) => b - a);
  const lows = recent.map(c => c?.low ?? 0).sort((a, b) => a - b);
  // Cluster nearby levels
  const cluster = (vals: number[], threshold: number): number[] => {
    const clusters: number[] = [];
    for (const v of vals) {
      if (!clusters.some(c => Math.abs(c - v) / v < threshold)) clusters.push(v);
      if (clusters.length >= 3) break;
    }
    return clusters;
  };
  const price = candles[candles.length - 1]?.close ?? 0;
  const pct = 0.005; // 0.5%
  return {
    resistances: cluster(highs.filter(h => h > price), pct),
    supports: cluster(lows.filter(l => l < price), pct),
  };
};

export const useIndicators = (candles: OHLCVCandle[]): Indicators => {
  return useMemo(() => {
    if (!candles || candles.length < 2) {
      return {
        rsi: null, macd: null, bollingerBands: null,
        ema9: null, ema21: null, sma50: null, sma200: null,
        ema9Values: [], ema21Values: [], sma50Values: [], sma200Values: [],
        stochRSI: null, atr: null, volumeAvg20: null, currentVolume: null,
        supportResistance: { supports: [], resistances: [] },
        goldenCross: false, deathCross: false,
      };
    }
    const closes = candles.map(c => c?.close ?? 0);
    const volumes = candles.map(c => c?.volume ?? 0);

    const ema9Values = calcEMA(closes, 9);
    const ema21Values = calcEMA(closes, 21);
    const sma50Values = calcSMA(closes, 50);
    const sma200Values = calcSMA(closes, 200);

    const validSma50 = sma50Values.filter(v => !isNaN(v));
    const validSma200 = sma200Values.filter(v => !isNaN(v));
    const prevSma50 = validSma50.length >= 2 ? validSma50[validSma50.length - 2] ?? 0 : 0;
    const prevSma200 = validSma200.length >= 2 ? validSma200[validSma200.length - 2] ?? 0 : 0;
    const curSma50 = validSma50[validSma50.length - 1] ?? 0;
    const curSma200 = validSma200[validSma200.length - 1] ?? 0;

    const goldenCross = prevSma50 <= prevSma200 && curSma50 > curSma200;
    const deathCross = prevSma50 >= prevSma200 && curSma50 < curSma200;

    // Volume avg
    const vol20 = volumes.length >= 20
      ? volumes.slice(-20).reduce((a, b) => a + b, 0) / 20
      : null;

    return {
      rsi: calcRSI(closes),
      macd: calcMACD(closes),
      bollingerBands: calcBollingerBands(closes),
      ema9: ema9Values.filter(v => !isNaN(v)).pop() ?? null,
      ema21: ema21Values.filter(v => !isNaN(v)).pop() ?? null,
      sma50: curSma50 || null,
      sma200: curSma200 || null,
      ema9Values,
      ema21Values,
      sma50Values,
      sma200Values,
      stochRSI: calcStochRSI(closes),
      atr: calcATR(candles),
      volumeAvg20: vol20,
      currentVolume: volumes[volumes.length - 1] ?? null,
      supportResistance: calcSupportResistance(candles),
      goldenCross,
      deathCross,
    };
  }, [candles]);
};
