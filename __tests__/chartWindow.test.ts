import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildChartWindow, visibleCandleCount, formatPriceShort } from '../src/services/chartWindow';
import type { OHLCVCandle } from '../src/types';

const series = (n: number, start = 100000, step = 100): OHLCVCandle[] =>
  Array.from({ length: n }, (_, i) => {
    const c = start + i * step;
    return { time: i * 86400000, open: c - 50, high: c + 200, low: c - 200, close: c, volume: 1 };
  });

describe('visibleCandleCount', () => {
  /**
   * REGRESSION TEST for the chart-tab crash. The chart drew every candle
   * (up to 720) into one very wide SVG, which Android kills the app over.
   * Whatever the screen, the count drawn must stay bounded.
   */
  test('stays bounded however wide the screen', () => {
    for (const width of [320, 412, 800, 1280, 2560, 10000]) {
      const n = visibleCandleCount(width, 8, 88);
      assert.ok(n >= 30 && n <= 90, `width ${width} gave ${n} candles`);
    }
  });

  test('fits a typical phone without horizontal scrolling', () => {
    // 412pt phone, 8pt per candle, 88pt of padding and axis labels.
    assert.equal(visibleCandleCount(412, 8, 88), 40);
  });

  test('falls back to the minimum on nonsense input', () => {
    assert.equal(visibleCandleCount(NaN, 8, 88), 30);
    assert.equal(visibleCandleCount(100, 8, 88), 30);
  });
});

describe('buildChartWindow', () => {
  test('keeps only the most recent candles', () => {
    const w = buildChartWindow(series(720), 40);
    assert.equal(w.candles.length, 40);
    assert.equal(w.start, 680);
  });

  test('copes with fewer candles than requested', () => {
    const w = buildChartWindow(series(10), 40);
    assert.equal(w.candles.length, 10);
    assert.equal(w.start, 0);
  });

  test('shifts prices so the candles fill the chart instead of hugging the top', () => {
    const full = series(720);
    const w = buildChartWindow(full, 40);
    const lowestLow = Math.min(...full.slice(680).map((c) => c.low));
    // Base sits just under the lowest low, so shifted lows are small but positive.
    assert.ok(w.base > 0 && w.base < lowestLow, `base ${w.base} vs lowest ${lowestLow}`);
    assert.ok(w.candles.every((c) => c.low >= 0), 'nothing may be shifted below zero');
    // Adding the base back recovers the true prices exactly.
    assert.equal(w.candles[0]!.close + w.base, full[680]!.close);
  });

  test('aligns the overlay one-to-one with the drawn candles', () => {
    const full = series(100);
    const raw = full.map((c) => c.close + 1); // a distinct, known line
    const w = buildChartWindow(full, 30, raw);
    assert.equal(w.overlay!.length, w.candles.length);
    for (let j = 0; j < w.candles.length; j++) {
      assert.equal(w.overlay![j]!.value + w.base, full[70 + j]!.close + 1, `point ${j} misaligned`);
    }
  });

  test('carries the last value forward over the still-forming final bar', () => {
    // Indicators skip the unclosed last candle, so the series is one shorter.
    const full = series(100);
    const raw = full.slice(0, -1).map((c) => c.close);
    const w = buildChartWindow(full, 30, raw);
    const values = w.overlay!.map((p) => p.value + w.base);
    assert.equal(values[values.length - 1], values[values.length - 2]);
  });

  test('never drops the overlay to zero during an indicator warm-up', () => {
    const full = series(60);
    const raw = full.map((c, i) => (i < 40 ? NaN : c.close)); // warms up mid-window
    const w = buildChartWindow(full, 30, raw);
    assert.ok(w.overlay!.every((p) => p.value + w.base > 1000), 'overlay fell to zero');
  });

  test('keeps an overlay that dips below the candles above zero too', () => {
    const full = series(60);
    const raw = full.map((c) => c.low * 0.9); // e.g. a lower Bollinger band
    const w = buildChartWindow(full, 30, raw);
    assert.ok(w.overlay!.every((p) => p.value >= 0));
  });

  test('returns no overlay when the series never warms up', () => {
    const full = series(30);
    const w = buildChartWindow(full, 30, full.map(() => NaN));
    assert.equal(w.overlay, null);
  });
});

describe('formatPriceShort', () => {
  test('keeps axis labels short enough for a narrow axis', () => {
    assert.equal(formatPriceShort(112345), '$112k');
    assert.equal(formatPriceShort(61500), '$61.5k');
    assert.equal(formatPriceShort(950), '$950');
    assert.equal(formatPriceShort(1234567), '$1.23M');
    assert.equal(formatPriceShort(NaN), '');
  });
});
