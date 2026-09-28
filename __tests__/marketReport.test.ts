import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildReport, analyseTimeframe, formatUkTime, fixFor, collectSnapshot, summariseSources, type ReportInput, type SnapshotFetchers } from '../src/services/marketReport';
import { FetchError } from '../src/services/http';
import { computeIndicators } from '../src/services/indicators';
import { dropIncompleteCandle } from '../src/services/candles';
import { computeSignal, configFromSettings } from '../src/services/signalEngine';
import { DEFAULT_SETTINGS } from '../src/services/settings';
import { generateSyntheticSeries } from '../backtest/data';
import type { OHLCVCandle, PriceData } from '../src/types';

const DAY = 86400000;
// Midday on 28 Sep 2026 UTC, so the final daily bar is still forming.
const NOW = Date.UTC(2026, 8, 28, 12, 0);

/** A synthetic daily series re-stamped so its last bar opened today. */
const dailyCandles = (n = 500): OHLCVCandle[] => {
  const raw = generateSyntheticSeries(n, 7);
  const today = Math.floor(NOW / DAY) * DAY;
  return raw.map((c, i) => ({ ...c, time: today - (raw.length - 1 - i) * DAY }));
};

const priceFor = (candles: OHLCVCandle[]): PriceData => {
  const p = candles[candles.length - 1]!.close;
  return {
    price: p, price_gbp: p * 0.75, market_cap: p * 19.9e6, volume_24h: 2e10, change_24h: p * 0.01,
    change_24h_pct: 1, high_24h: p * 1.02, low_24h: p * 0.98, circulating_supply: 19.9e6, last_updated: NOW / 1000,
  };
};

const fearGreed = {
  current: { value: 15, value_classification: 'Extreme Fear', timestamp: String(Math.floor(NOW / DAY) * 86400) },
  history: [{ value: 15, value_classification: 'Extreme Fear', timestamp: '0' }],
};

const input = (over: Partial<ReportInput> = {}): ReportInput => {
  const candles = dailyCandles();
  return {
    now: NOW,
    settings: { ...DEFAULT_SETTINGS, currency: 'GBP' },
    price: priceFor(candles),
    candles: { '1D': candles, '4H': candles.slice(-300) },
    fearGreed,
    btcDominance: 57.2,
    onChain: null,
    sources: [{ label: 'Live price (Kraken)', host: 'api.kraken.com', error: null }],
    ...over,
  };
};

describe('snapshot report', () => {
  test('uses exactly the numbers the app pipeline produces', () => {
    const inp = input();
    const candles = inp.candles['1D']!;
    // What the Signals tab does: drop the forming bar, compute, run the engine.
    const indicators = computeIndicators(dropIncompleteCandle(candles, '1D', NOW));
    const expected = computeSignal({
      indicators,
      currentPrice: inp.price!.price,
      fearGreed: 15,
      config: configFromSettings(inp.settings),
    });

    const a = analyseTimeframe('1D', candles, inp.price!.price, 15, configFromSettings(inp.settings), NOW);
    assert.equal(a.closed.length, candles.length - 1, 'the still-forming bar is dropped');
    assert.deepEqual(a.signal, expected);

    const text = buildReport(inp);
    assert.ok(text.includes(`RSI (14)`) && text.includes(indicators.rsi!.value.toFixed(1)));
    assert.ok(text.includes(`Advice: ${expected.actionLabel}.`));
    assert.ok(text.includes(`Target Bitcoin allocation ${Math.round(expected.targetAllocation * 100)}%`));
    assert.ok(text.includes(`Conviction ${expected.conviction}%`));
    for (const r of expected.readings) assert.ok(text.includes(`- ${r.name}: ${r.value} [${r.signal}]`), r.name);
  });

  test('covers every indicator, the rules, both currencies and UK time', () => {
    const text = buildReport(input());
    for (const s of ['MACD (12, 26, 9)', 'StochRSI', 'Bollinger (20, 2)', 'EMA 9 / EMA 21', 'SMA 50 / SMA 200',
      '200 SMA slope', 'ATR (14)', 'Supports, nearest first', 'Rule: BULL at +2', 'RSI 30..70 maps to -1..+1',
      '20 or below adds 10% allocation', 'BTC/GBP £', 'BTC/USD $', 'In plain English', 'OTHER TIMEFRAMES', '4H:']) {
      assert.ok(text.includes(s), `missing "${s}"`);
    }
    assert.match(text, /^BTC SNAPSHOT {2}Mon 28 Sep 2026, 13:00 BST/);
    // Extreme fear is active and says so.
    assert.match(text, /Market mood \(Fear & Greed\): 15 {2}\[BULLISH\] {2}moves allocation by \+10\.0%/);
  });

  test('never prints broken values or em dashes', () => {
    for (const text of [buildReport(input()), buildReport(input({ price: null, fearGreed: null, candles: {} }))]) {
      assert.ok(!/undefined|NaN|\u2014/.test(text), text);
    }
  });

  test('says when history is too short for the engine, as the app does', () => {
    const text = buildReport(input({ candles: { '1D': dailyCandles(150) } }));
    assert.match(text, /needs 200 1D bars and there are 150/);
  });

  test('flags a stale Fear & Greed reading', () => {
    const old = { ...fearGreed, current: { ...fearGreed.current, timestamp: String(Math.floor((NOW - 3 * DAY) / 1000)) } };
    assert.match(buildReport(input({ fearGreed: old })), /STALE: older than 36h/);
  });
});

describe('failed sources', () => {
  const blocked = [
    { label: 'Live price (Kraken)', host: 'api.kraken.com', error: 'HTTP 403' },
    { label: 'Fear & Greed (Alternative.me)', host: 'api.alternative.me', error: 'HTTP 403' },
    { label: 'On-chain (mempool.space)', host: 'mempool.space', error: 'timed out after 8s' },
  ];

  test('behind a proxy, names every blocked host in one allowlist fix', () => {
    const text = buildReport(input({ sources: blocked, proxied: true }));
    assert.match(text, /FAIL Live price \(Kraken\) +HTTP 403/);
    assert.match(text, /allowlist: api\.kraken\.com, api\.alternative\.me\./);
    assert.match(text, /mempool\.space could not be reached/);
  });

  test('off a proxy, a 403 points at blockers on the network instead', () => {
    assert.match(fixFor(blocked[0]!), /firewall, VPN, ad or DNS blocker/);
    assert.match(fixFor({ ...blocked[0]!, error: 'HTTP 429' }), /rate limiting/);
  });
});

describe('formatUkTime', () => {
  test('uses BST in summer and GMT in winter, whatever the machine zone', () => {
    assert.equal(formatUkTime(Date.UTC(2026, 6, 1, 12, 5)), 'Wed 1 Jul 2026, 13:05 BST');
    assert.equal(formatUkTime(Date.UTC(2026, 0, 15, 23, 30)), 'Thu 15 Jan 2026, 23:30 GMT');
    // Just after midnight UK time in summer is still the previous day in UTC.
    assert.equal(formatUkTime(Date.UTC(2026, 5, 30, 23, 30)), 'Wed 1 Jul 2026, 00:30 BST');
  });
});

describe('allocation breakdown', () => {
  test('the parts add up to the target allocation whenever it is not capped', () => {
    const candles = dailyCandles(900);
    for (let i = 250; i < candles.length; i += 40) {
      const window = candles.slice(0, i);
      const s = computeSignal({ indicators: computeIndicators(window), currentPrice: window[window.length - 1]!.close, fearGreed: 50 });
      const sum = s.allocationParts.base + s.allocationParts.stretch + s.allocationParts.momentum + s.allocationParts.sentiment;
      assert.ok(Math.abs(Math.min(1, Math.max(0, sum)) - s.targetAllocation) < 1e-12);
    }
  });
});

describe('collectSnapshot (shared by the phone export and yarn snapshot)', () => {
  const candles = dailyCandles();
  const ok: SnapshotFetchers = {
    fetchPriceData: async () => priceFor(candles),
    fetchOHLCV: async () => candles,
    fetchBTCDominance: async () => 57,
    fetchFearGreed: async () => fearGreed,
    fetchOnChainData: async () => ({ hashRate: 0, difficulty: null, mempool: null, fees: null }),
  };

  test('records every source, and the report says it came from the phone', async () => {
    const { input, coreFailed } = await collectSnapshot(
      { ...ok, fetchFearGreed: async () => { throw new FetchError('HTTP 403', 403); } },
      { ...DEFAULT_SETTINGS, stretchWeight: 0.3 },
      { origin: 'app', now: () => NOW }
    );
    assert.equal(coreFailed, false);
    assert.equal(input.sources.length, 8);
    assert.equal(input.fearGreed, null);
    assert.equal(summariseSources(input.sources), '7 of 8 sources loaded. Failed: Fear & Greed (Alternative.me) (HTTP 403).');

    const text = buildReport(input);
    assert.match(text, /Exported from the BTC Analyst app on the owner's phone/);
    assert.match(text, /stretch weight 0\.3/);
    // Advice meant for a phone, not for someone with the repository.
    assert.match(text, /Try another network/);
    assert.ok(!text.includes('yarn probe'));
  });

  test('flags a missing price or signal-timeframe history as a core failure', async () => {
    const noPrice = await collectSnapshot({ ...ok, fetchPriceData: async () => { throw new Error('x'); } }, DEFAULT_SETTINGS, { origin: 'cli' });
    assert.equal(noPrice.coreFailed, true);
    const no4h = await collectSnapshot(
      { ...ok, fetchOHLCV: async (tf) => { if (tf === '4H') throw new Error('x'); return candles; } },
      DEFAULT_SETTINGS,
      { origin: 'cli' }
    );
    assert.equal(no4h.coreFailed, false, 'only the signal timeframe (1D here) is core');
    assert.equal(summariseSources(no4h.input.sources).startsWith('7 of 8'), true);
  });
});
