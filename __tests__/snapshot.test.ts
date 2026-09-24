import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseSnapshot, isFearGreedFresh, SNAPSHOT_MAX_AGE_MS, FEAR_GREED_FRESH_MS } from '../src/services/snapshot';
import { summariseRefresh } from '../src/services/sourceStatus';

const NOW = 1_780_000_000_000;

const price = {
  price: 84000, price_gbp: 63000, market_cap: 1.6e12, volume_24h: 2e10, change_24h: 40,
  change_24h_pct: 0.05, high_24h: 85000, low_24h: 83000, circulating_supply: 19.9e6, last_updated: NOW / 1000,
};
const candle = { time: NOW - 86400000, open: 1, high: 2, low: 0.5, close: 1.5, volume: 10 };
const fg = (ageMs: number) => ({
  current: { value: 40, value_classification: 'Fear', timestamp: String(Math.floor((NOW - ageMs) / 1000)) },
  history: [],
});

const stored = (over: Record<string, unknown> = {}) =>
  JSON.stringify({ savedAt: NOW - 60000, price, timeframe: '1D', candles: [candle], fearGreed: fg(0), btcDominance: 58, onChain: null, ...over });

describe('parseSnapshot', () => {
  test('round-trips a good snapshot', () => {
    const s = parseSnapshot(stored(), NOW);
    assert.ok(s);
    assert.equal(s.price?.price, 84000);
    assert.equal(s.candles.length, 1);
    assert.equal(s.btcDominance, 58);
  });

  test('ignores missing, corrupt and non-object input', () => {
    for (const raw of [null, '', '{', 'null', '42', '[]']) assert.equal(parseSnapshot(raw, NOW), null, String(raw));
  });

  test('ignores a snapshot that is too old to be useful', () => {
    assert.equal(parseSnapshot(stored({ savedAt: NOW - SNAPSHOT_MAX_AGE_MS - 1 }), NOW), null);
  });

  test('ignores a snapshot dated in the future (clock change)', () => {
    assert.equal(parseSnapshot(stored({ savedAt: NOW + 3600000 }), NOW), null);
  });

  test('needs a real price to be shown at all', () => {
    assert.equal(parseSnapshot(stored({ price: { price: 0, change_24h_pct: 0 } }), NOW), null);
    assert.equal(parseSnapshot(stored({ price: null }), NOW), null);
  });

  test('drops malformed parts rather than passing them to the screens', () => {
    const s = parseSnapshot(stored({ candles: [{ time: 'x' }], fearGreed: { current: {} }, btcDominance: 'lots', timeframe: '3M' }), NOW);
    assert.ok(s);
    assert.deepEqual(s.candles, []);
    assert.equal(s.fearGreed, null);
    assert.equal(s.btcDominance, null);
    assert.equal(s.timeframe, '1D');
  });
});

describe('isFearGreedFresh', () => {
  test("a reading from today is fresh; one older than the window is not", () => {
    assert.equal(isFearGreedFresh(fg(3600000), NOW), true);
    assert.equal(isFearGreedFresh(fg(FEAR_GREED_FRESH_MS + 1), NOW), false);
  });
  test('no reading, or no timestamp, is never fresh', () => {
    assert.equal(isFearGreedFresh(null, NOW), false);
    assert.equal(isFearGreedFresh({ current: { value: 1, value_classification: '', timestamp: '0' }, history: [] }, NOW), false);
  });
});

describe('summariseRefresh', () => {
  test('nothing failed, nothing to say', () => {
    assert.deepEqual(summariseRefresh([], false), { error: null, errorKind: null });
  });

  /**
   * REGRESSION TEST. The banner named the failing source but not why, so a
   * provider blocking the phone looked the same as an outage or a timeout.
   */
  test('names each failing extra WITH its reason, as a partial failure', () => {
    const s = summariseRefresh([{ label: 'Fear & Greed (Alternative.me)', reason: 'HTTP 403' }], false);
    assert.equal(s.errorKind, 'partial');
    assert.match(s.error ?? '', /Fear & Greed \(Alternative\.me\) \(HTTP 403\) is unavailable/);
  });

  test('lists several failures naturally', () => {
    const s = summariseRefresh([{ label: 'A', reason: 'x' }, { label: 'B', reason: 'y' }, { label: 'C', reason: 'z' }], false);
    assert.match(s.error ?? '', /^A \(x\), B \(y\) and C \(z\) are unavailable/);
  });

  test('no price and no history is reported as offline, not partial', () => {
    const s = summariseRefresh([{ label: 'Live price (Kraken)', reason: 'could not connect' }], true);
    assert.equal(s.errorKind, 'offline');
    assert.match(s.error ?? '', /could not connect/);
  });
});
