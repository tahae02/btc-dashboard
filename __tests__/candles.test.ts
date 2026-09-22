import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { dropIncompleteCandle, normaliseCandles, TIMEFRAME_MS } from '../src/services/candles';
import type { OHLCVCandle } from '../src/types';

const at = (time: number, close = 100): OHLCVCandle =>
  ({ time, open: close, high: close, low: close, close, volume: 1 });

const DAY = TIMEFRAME_MS['1D'];

describe('dropIncompleteCandle', () => {
  /**
   * The exchange returns the CURRENT, still-forming bar as the last row. On a
   * daily chart that bar is partial for 23 of every 24 hours. Feeding it to
   * the indicators meant volume read low, ATR under-read volatility, and the
   * signal quietly changed meaning depending on the time of day you looked.
   */
  test('drops a bar that has not closed yet', () => {
    const candles = [at(0), at(DAY), at(2 * DAY)];
    // Noon on the third day: that bar is still forming.
    const out = dropIncompleteCandle(candles, '1D', 2 * DAY + DAY / 2);
    assert.equal(out.length, 2);
    assert.equal(out[out.length - 1]!.time, DAY);
  });

  test('keeps the final bar once its period has elapsed', () => {
    const candles = [at(0), at(DAY), at(2 * DAY)];
    const out = dropIncompleteCandle(candles, '1D', 3 * DAY);
    assert.equal(out.length, 3);
  });

  test('treats the exact close boundary as closed', () => {
    const candles = [at(0), at(DAY)];
    assert.equal(dropIncompleteCandle(candles, '1D', 2 * DAY).length, 2);
    assert.equal(dropIncompleteCandle(candles, '1D', 2 * DAY - 1).length, 1);
  });

  test('respects the timeframe it is given', () => {
    const candles = [at(0), at(TIMEFRAME_MS['1H'])];
    const justAfter = TIMEFRAME_MS['1H'] * 2 + 1;
    assert.equal(dropIncompleteCandle(candles, '1H', justAfter).length, 2);
    // The same instant is mid-bar on a weekly chart.
    assert.equal(dropIncompleteCandle(candles, '1W', justAfter).length, 1);
  });

  test('handles empty input without throwing', () => {
    assert.deepEqual(dropIncompleteCandle([], '1D', 0), []);
  });
});

describe('normaliseCandles', () => {
  test('sorts ascending by time', () => {
    const out = normaliseCandles([at(3 * DAY), at(DAY), at(2 * DAY)]);
    assert.deepEqual(out.map((c) => c.time), [DAY, 2 * DAY, 3 * DAY]);
  });

  test('collapses duplicate timestamps, keeping the last seen', () => {
    const out = normaliseCandles([at(DAY, 100), at(DAY, 200)]);
    assert.equal(out.length, 1);
    assert.equal(out[0]!.close, 200);
  });

  test('discards rows that cannot be used', () => {
    const bad = [
      at(DAY),
      { time: NaN, open: 1, high: 1, low: 1, close: 1 },
      { time: 2 * DAY, open: 1, high: 1, low: 1, close: 0 },      // zero close
      { time: 3 * DAY, open: 1, high: 1, low: 1, close: -5 },     // negative
    ] as OHLCVCandle[];
    const out = normaliseCandles(bad);
    assert.equal(out.length, 1);
    assert.equal(out[0]!.time, DAY);
  });
});
