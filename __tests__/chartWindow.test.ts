import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildChartWindow, visibleCandleCount, formatPriceShort, clampOffset, candleIsUp, priceScale, niceStep,
  formatAxisPrice, dateLabelIndexes, formatCandleTime, candleIndexAt,
} from '../src/services/chartWindow';
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
    assert.equal(w.offset, 0);
  });

  test('copes with fewer candles than requested', () => {
    const w = buildChartWindow(series(10), 40);
    assert.equal(w.candles.length, 10);
    assert.equal(w.start, 0);
  });

  test('draws real prices, not shifted ones', () => {
    const full = series(720);
    const w = buildChartWindow(full, 40);
    assert.equal(w.candles[0]!.close, full[680]!.close);
    assert.equal(w.lo, Math.min(...full.slice(680).map((c) => c.low)));
    assert.equal(w.hi, Math.max(...full.slice(680).map((c) => c.high)));
  });

  test('dragging back moves the window through history without widening it', () => {
    const full = series(720);
    const w = buildChartWindow(full, 40, {}, 100);
    assert.equal(w.candles.length, 40, 'the bitmap must stay bounded however far back');
    assert.equal(w.start, 580);
    assert.equal(w.offset, 100);
  });

  test('cannot drag past either end', () => {
    const full = series(100);
    assert.equal(buildChartWindow(full, 40, {}, 9999).start, 0);
    assert.equal(buildChartWindow(full, 40, {}, 9999).offset, 60);
    assert.equal(buildChartWindow(full, 40, {}, -5).offset, 0);
    assert.equal(clampOffset(30, 40, 10), 0, 'a short history has nowhere to go');
  });

  test('aligns each overlay one-to-one with the drawn candles', () => {
    const full = series(100);
    const raw = full.map((c) => c.close + 1);
    const w = buildChartWindow(full, 30, { upper: raw, lower: full.map((c) => c.close - 1) });
    assert.equal(w.lines.length, 2, 'a Bollinger pair draws both lines');
    for (const line of w.lines) assert.equal(line.values.length, w.candles.length);
    for (let j = 0; j < w.candles.length; j++) {
      assert.equal(w.lines[0]!.values[j], full[70 + j]!.close + 1, `point ${j} misaligned`);
    }
  });

  test('the overlay stays aligned after dragging back', () => {
    const full = series(100);
    const raw = full.map((c) => c.close + 1);
    const w = buildChartWindow(full, 30, { ma: raw }, 20);
    assert.equal(w.lines[0]!.values[0], full[50]!.close + 1);
  });

  test('carries the last value forward over the still-forming final bar', () => {
    const full = series(100);
    const raw = full.slice(0, -1).map((c) => c.close);
    const values = buildChartWindow(full, 30, { ma: raw }).lines[0]!.values;
    assert.equal(values[values.length - 1], values[values.length - 2]);
  });

  test('never drops the overlay to zero during an indicator warm-up', () => {
    const full = series(60);
    const raw = full.map((c, i) => (i < 40 ? NaN : c.close));
    const w = buildChartWindow(full, 30, { ma: raw });
    assert.ok(w.lines[0]!.values.every((v) => v > 1000), 'overlay fell to zero');
  });

  test('includes an overlay below the candles in the price range', () => {
    const full = series(60);
    const raw = full.map((c) => c.low * 0.9);
    const w = buildChartWindow(full, 30, { lower: raw });
    assert.equal(w.lo, Math.min(...raw.slice(30)));
  });

  test('leaves out an overlay that never warms up', () => {
    const full = series(30);
    const w = buildChartWindow(full, 30, { ma: full.map(() => NaN), none: null });
    assert.equal(w.lines.length, 0);
  });
});

describe('candle colours', () => {
  /**
   * REGRESSION TEST for the inverted candles. The old chart library painted a
   * candle "bullish" when it opened above its close, so rising candles were red.
   */
  test('a candle that closed higher than it opened is up (green)', () => {
    assert.equal(candleIsUp({ open: 98000, close: 99000 }), true);
    assert.equal(candleIsUp({ open: 99000, close: 98000 }), false);
    assert.equal(candleIsUp({ open: 98000, close: 98000 }), true, 'an unchanged candle is not a fall');
  });
});

describe('price axis', () => {
  test('labels land on round prices', () => {
    const s = priceScale(98123, 107456);
    assert.equal(s.step, 2500);
    assert.deepEqual(s.ticks, [97500, 100000, 102500, 105000, 107500]);
    assert.ok(s.min <= 98123 && s.max >= 107456);
  });

  test('round steps are 1, 2, 2.5 or 5 times a power of ten', () => {
    assert.equal(niceStep(830), 1000);
    assert.equal(niceStep(1700), 2000);
    assert.equal(niceStep(2300), 2500);
    assert.equal(niceStep(4100), 5000);
    assert.equal(niceStep(6000), 10000);
  });

  test('a flat window still gets a usable axis', () => {
    const s = priceScale(100000, 100000);
    assert.ok(s.max > s.min);
    assert.ok(s.ticks.length >= 2);
  });

  test('axis labels are short and in the chart currency', () => {
    assert.equal(formatAxisPrice(98000, 2000), '$98k');
    assert.equal(formatAxisPrice(98500, 500, 'GBP'), '£98.5k');
    assert.equal(formatAxisPrice(950, 50), '$950');
    assert.equal(formatAxisPrice(1250000, 50000), '$1.25M');
  });
});

describe('time axis', () => {
  test('spreads date labels evenly and keeps them off the edges', () => {
    assert.deepEqual(dateLabelIndexes(40, 4), [5, 15, 25, 35]);
    assert.deepEqual(dateLabelIndexes(3, 4), [0, 1, 2]);
    assert.deepEqual(dateLabelIndexes(0, 4), []);
  });

  test('date labels carry as much detail as the timeframe needs', () => {
    const t = new Date(2026, 10, 14, 9, 0).getTime();
    assert.equal(formatCandleTime(t, '1D'), '14 Nov');
    assert.equal(formatCandleTime(t, '1H'), '14 Nov 09:00');
    assert.equal(formatCandleTime(t, '1W'), 'Nov 2026');
  });

  test('finds the candle a moment falls in', () => {
    const c = series(10);
    assert.equal(candleIndexAt(c, c[3]!.time + 1000, 86400000), 3);
    assert.equal(candleIndexAt(c, c[0]!.time - 1, 86400000), -1);
    assert.equal(candleIndexAt(c, c[9]!.time + 86400000, 86400000), -1);
  });
});

describe('formatPriceShort', () => {
  test('keeps axis labels short enough for a narrow axis', () => {
    assert.equal(formatPriceShort(112345), '$112k');
    assert.equal(formatPriceShort(61500), '$61.5k');
    assert.equal(formatPriceShort(950), '$950');
    assert.equal(formatPriceShort(1234567), '$1.23M');
    assert.equal(formatPriceShort(NaN), '');
    assert.equal(formatPriceShort(75400, 'GBP'), '£75.4k');
  });
});
