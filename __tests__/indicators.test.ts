import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  calcSMA, calcEMA, calcRSI, calcMACD, calcBollingerBands,
  calcStochRSI, calcATR, calcATRSeries, calcSupportResistance,
  computeIndicators, lastValid,
} from '../src/services/indicators';
import type { OHLCVCandle } from '../src/types';

const candle = (o: number, h: number, l: number, c: number, v = 1, t = 0): OHLCVCandle =>
  ({ time: t, open: o, high: h, low: l, close: c, volume: v });

const closeOnly = (closes: number[]): OHLCVCandle[] =>
  closes.map((c, i) => candle(c, c, c, c, 1, i * 86400000));

describe('calcSMA', () => {
  test('averages the window and warms up with NaN', () => {
    const out = calcSMA([1, 2, 3, 4, 5], 5);
    assert.equal(out.length, 5);
    assert.ok(out.slice(0, 4).every(Number.isNaN));
    assert.equal(out[4], 3);
  });

  test('a constant series averages to that constant', () => {
    assert.equal(lastValid(calcSMA(new Array(30).fill(7), 20)), 7);
  });

  test('rolling window matches a naive recomputation', () => {
    const data = [5, 3, 9, 1, 7, 2, 8, 4, 6, 10];
    const fast = calcSMA(data, 3);
    for (let i = 2; i < data.length; i++) {
      const naive = (data[i - 2]! + data[i - 1]! + data[i]!) / 3;
      assert.ok(Math.abs(fast[i]! - naive) < 1e-12, `index ${i}`);
    }
  });
});

describe('calcEMA', () => {
  test('seeds from the SMA of the first period', () => {
    const data = [1, 2, 3, 4, 5, 6, 7, 8];
    const out = calcEMA(data, 4);
    assert.ok(out.slice(0, 3).every(Number.isNaN));
    assert.equal(out[3], 2.5); // (1+2+3+4)/4
  });

  test('a constant series stays constant', () => {
    assert.equal(lastValid(calcEMA(new Array(20).fill(7), 5)), 7);
  });
});

describe('calcRSI', () => {
  // Wilder's original worked example, as republished by StockCharts. Matching
  // this is the difference between a correct Wilder-smoothed RSI and the naive
  // rolling-average version that a lot of hobby code ships by mistake.
  const WILDER = [
    44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.10, 45.42, 45.84, 46.08, 45.89,
    46.03, 45.61, 46.28, 46.28, 46.00, 46.03, 46.41, 46.22, 45.64, 46.21, 46.25,
    45.71, 46.45, 45.78, 45.35, 44.03, 44.18, 44.22, 44.57, 43.42, 42.66, 43.13,
  ];

  test('reproduces the published reference values', () => {
    const rsi = calcRSI(WILDER, 14)!;
    const warm = rsi.values.filter((v) => !Number.isNaN(v));
    // Published tables round their intermediate averages, so the early values
    // agree to ~0.1 and converge to exact agreement as the smoothing settles.
    assert.ok(Math.abs(warm[0]! - 70.53) < 0.1, `first ${warm[0]}`);
    assert.ok(Math.abs(warm[1]! - 66.32) < 0.1, `second ${warm[1]}`);
    assert.ok(Math.abs(rsi.value - 37.79) < 0.01, `last ${rsi.value}`);
  });

  test('values stay index-aligned to closes', () => {
    const rsi = calcRSI(WILDER, 14)!;
    assert.equal(rsi.values.length, WILDER.length);
    assert.ok(rsi.values.slice(0, 14).every(Number.isNaN));
  });

  test('pins to 100 when every bar gains and 0 when every bar loses', () => {
    const up = Array.from({ length: 40 }, (_, i) => 100 + i * 2);
    const down = Array.from({ length: 40 }, (_, i) => 200 - i * 2);
    assert.equal(calcRSI(up, 14)!.value, 100);
    assert.equal(calcRSI(down, 14)!.value, 0);
  });

  test('returns null rather than guessing when history is too short', () => {
    assert.equal(calcRSI([1, 2, 3], 14), null);
  });
});

describe('calcMACD', () => {
  test('a flat series produces a flat MACD', () => {
    const macd = calcMACD(new Array(60).fill(100))!;
    assert.ok(Math.abs(macd.macdLine) < 1e-9);
    assert.ok(Math.abs(macd.histogram) < 1e-9);
  });

  test('all three series stay index-aligned to closes', () => {
    const closes = Array.from({ length: 80 }, (_, i) => 100 + Math.sin(i / 5) * 10);
    const macd = calcMACD(closes)!;
    assert.equal(macd.macdValues.length, closes.length);
    assert.equal(macd.signalValues.length, closes.length);
    assert.equal(macd.histogramValues.length, closes.length);
    // Wherever the signal line exists the histogram must too, and vice versa.
    for (let i = 0; i < closes.length; i++) {
      assert.equal(
        Number.isNaN(macd.signalValues[i]!),
        Number.isNaN(macd.histogramValues[i]!),
        `index ${i}`
      );
    }
  });

  test('histogram equals macd minus signal', () => {
    const closes = Array.from({ length: 80 }, (_, i) => 100 + i + Math.sin(i) * 5);
    const macd = calcMACD(closes)!;
    assert.ok(Math.abs(macd.histogram - (macd.macdLine - macd.signalLine)) < 1e-9);
  });
});

describe('calcBollingerBands', () => {
  test('a flat series collapses the bands onto the mean', () => {
    const bb = calcBollingerBands(new Array(30).fill(50))!;
    assert.equal(bb.upper, 50);
    assert.equal(bb.lower, 50);
    assert.equal(bb.bandwidth, 0);
  });

  test('bands straddle the middle and widen with volatility', () => {
    const calm = calcBollingerBands(Array.from({ length: 40 }, (_, i) => 100 + (i % 2)))!;
    const wild = calcBollingerBands(Array.from({ length: 40 }, (_, i) => 100 + (i % 2) * 30))!;
    assert.ok(calm.upper > calm.middle && calm.lower < calm.middle);
    assert.ok(wild.bandwidth > calm.bandwidth);
  });
});

describe('calcStochRSI', () => {
  test('stays within 0..100', () => {
    const closes = Array.from({ length: 120 }, (_, i) => 100 + Math.sin(i / 7) * 20);
    const s = calcStochRSI(closes)!;
    assert.ok(s.k >= 0 && s.k <= 100, `k=${s.k}`);
    assert.ok(s.d >= 0 && s.d <= 100, `d=${s.d}`);
  });
});

describe('calcATR', () => {
  test('a constant-range series has ATR equal to that range', () => {
    // Each bar spans exactly 10 and closes mid-range, so true range is 10.
    const candles = Array.from({ length: 40 }, (_, i) => candle(100, 105, 95, 100, 1, i * 86400000));
    const atr = calcATR(candles, 14)!;
    assert.ok(Math.abs(atr - 10) < 1e-9, `atr=${atr}`);
  });

  test('the series is index-aligned to the candles', () => {
    const candles = Array.from({ length: 40 }, (_, i) => candle(100, 105, 95, 100, 1, i * 86400000));
    const series = calcATRSeries(candles, 14);
    assert.equal(series.length, candles.length);
    // Needs 14 true ranges, and trs[i] describes candles[i + 1], so the first
    // usable value lands at index 14.
    assert.ok(series.slice(0, 14).every(Number.isNaN));
    assert.ok(!Number.isNaN(series[14]!));
  });

  test('returns null rather than guessing when history is too short', () => {
    assert.equal(calcATR([candle(1, 1, 1, 1)], 14), null);
  });
});

describe('calcSupportResistance', () => {
  /**
   * REGRESSION TEST for the bug that made the app suggest buying ~20% below
   * spot and selling ~30% above it.
   *
   * The old code sorted highs descending and lows ascending, then took index
   * 0 and labelled it "nearest". Index 0 of those sorts is the FURTHEST level.
   * That value fed entryPrice, exitPrice and the price-target cards.
   */
  test('orders levels nearest-first, not furthest-first', () => {
    const lows = [80, 95, 97, 98, 99, 88, 92, 96, 99, 85, 93, 97, 98, 99, 90, 94, 96, 98, 99, 99];
    const highs = [130, 101, 102, 103, 105, 125, 110, 104, 101, 128, 108, 103, 102, 101, 120, 106, 104, 102, 101, 101];
    const candles = lows.map((l, i) => candle(100, highs[i]!, l, 100, 1, i * 86400000));

    const sr = calcSupportResistance(candles, 20);
    const price = 100;

    assert.ok(sr.supports.length > 0 && sr.resistances.length > 0);
    assert.ok(sr.supports[0]! < price, 'support must sit below price');
    assert.ok(sr.resistances[0]! > price, 'resistance must sit above price');

    // The headline level must be the closest one, not the extreme.
    const nearestSupport = Math.max(...sr.supports);
    const nearestResistance = Math.min(...sr.resistances);
    assert.equal(sr.supports[0], nearestSupport, 'supports[0] must be the nearest support');
    assert.equal(sr.resistances[0], nearestResistance, 'resistances[0] must be the nearest resistance');

    // Concretely: the old code returned 80 and 130 here.
    assert.ok(price - sr.supports[0]! < 15, `support ${sr.supports[0]} is implausibly far below ${price}`);
    assert.ok(sr.resistances[0]! - price < 25, `resistance ${sr.resistances[0]} is implausibly far above ${price}`);
  });

  test('levels are sorted by increasing distance from price', () => {
    const candles = Array.from({ length: 60 }, (_, i) =>
      candle(100, 100 + ((i * 7) % 30), 100 - ((i * 11) % 25), 100, 1, i * 86400000)
    );
    const sr = calcSupportResistance(candles, 60);
    for (let i = 1; i < sr.resistances.length; i++) {
      assert.ok(sr.resistances[i]! >= sr.resistances[i - 1]!, 'resistances must move away from price');
    }
    for (let i = 1; i < sr.supports.length; i++) {
      assert.ok(sr.supports[i]! <= sr.supports[i - 1]!, 'supports must move away from price');
    }
  });

  test('degrades to an empty result rather than throwing on tiny input', () => {
    assert.deepEqual(calcSupportResistance([candle(1, 1, 1, 1)]), { supports: [], resistances: [] });
  });
});

describe('computeIndicators', () => {
  test('returns a fully null-shaped result for empty input instead of throwing', () => {
    const ind = computeIndicators([]);
    assert.equal(ind.rsi, null);
    assert.equal(ind.sma200, null);
    assert.deepEqual(ind.supportResistance, { supports: [], resistances: [] });
  });

  test('populates the regime fields once there is enough history', () => {
    const closes = Array.from({ length: 300 }, (_, i) => 100 * Math.exp(i * 0.003));
    const ind = computeIndicators(closeOnly(closes));
    assert.ok(ind.sma200 != null);
    assert.ok(ind.sma200Slope != null && ind.sma200Slope > 0, 'a rising series must give a positive slope');
    assert.ok(ind.priceVsSma200Pct != null && ind.priceVsSma200Pct > 0);
  });

  test('detects a golden cross exactly on the bar it happens', () => {
    // Long decline, then a sharp sustained rally, so the 50 crosses the 200.
    const closes: number[] = [];
    for (let i = 0; i < 260; i++) closes.push(200 - i * 0.4);
    for (let i = 0; i < 160; i++) closes.push(closes[closes.length - 1]! + 2.2);

    let crossBar = -1;
    for (let i = 210; i < closes.length; i++) {
      if (computeIndicators(closeOnly(closes.slice(0, i + 1))).goldenCross) { crossBar = i; break; }
    }
    assert.ok(crossBar > 0, 'expected a golden cross somewhere in the rally');
    // It is a one-bar event, not a persistent state.
    const after = computeIndicators(closeOnly(closes.slice(0, crossBar + 2)));
    assert.equal(after.goldenCross, false, 'goldenCross must not latch on');
  });
});
