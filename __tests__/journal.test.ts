import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseTrades, serialiseBackup, mergeTrades, parseAmount, parseLocalDateTime, parseTradeForm,
  summariseHoldings, priceAt, tradeOutcomes, tradesToCsv, groupBuysBySignal, resolveTradeFigures, fillFromMarket,
  parseOpening, parseOpeningForm, parseBackup, isCoveredByOpening, type Trade, type SignalStamp, type OpeningPosition,
} from '../src/services/journal';
import { formatPct, formatMoney, formatBtc, isFlat } from '../src/services/format';
import type { OHLCVCandle } from '../src/types';

const DAY = 86400000;
const HOUR = 3600000;
const T0 = Date.UTC(2026, 0, 1);

const trade = (over: Partial<Trade> = {}): Trade => ({
  id: over.id ?? Math.random().toString(36).slice(2),
  side: 'buy',
  time: T0,
  fiat: 1000,
  currency: 'GBP',
  btc: 0.02,
  unitPrice: null,
  fee: 0,
  marketPriceUsd: 60000,
  signal: null,
  note: '',
  createdAt: T0,
  ...over,
});

const LIVE = { usd: 80000, gbp: 60000 };

describe('parseTrades', () => {
  test('round-trips through a backup', () => {
    const list = [trade({ id: 'a' }), trade({ id: 'b', side: 'sell', time: T0 + DAY, btc: 0.01, fiat: 700 })];
    assert.deepEqual(parseTrades(serialiseBackup(list)), list);
  });

  test('accepts the bare stored array too', () => {
    assert.equal(parseTrades(JSON.stringify([trade({ id: 'x' })])).length, 1);
  });

  test('drops invalid entries instead of failing the whole list', () => {
    const raw = JSON.stringify([
      trade({ id: 'good' }),
      { ...trade({ id: 'neg' }), fiat: -5 },
      { ...trade({ id: 'zero' }), btc: 0 },
      { ...trade({ id: 'side' }), side: 'hodl' },
      { ...trade({ id: 'ccy' }), currency: 'EUR' },
      { ...trade({ id: 'old' }), time: Date.UTC(2008, 0, 1) },
      null,
      'junk',
    ]);
    assert.deepEqual(parseTrades(raw).map((t) => t.id), ['good']);
  });

  test('corrupt or empty storage yields no trades', () => {
    for (const raw of [null, '', '{', '42', '{"trades": 3}']) assert.deepEqual(parseTrades(raw), []);
  });

  test('a malformed signal stamp is dropped, the trade kept', () => {
    const [t] = parseTrades(JSON.stringify([{ ...trade({ id: 's' }), signal: { action: 'MOON' } }]));
    assert.equal(t?.signal, null);
  });

  test('merging a backup keeps both sides, and the backup wins on the same id', () => {
    const merged = mergeTrades([trade({ id: 'a', fiat: 1 }), trade({ id: 'b' })], [trade({ id: 'a', fiat: 2 }), trade({ id: 'c' })]);
    assert.deepEqual(merged.map((t) => t.id).sort(), ['a', 'b', 'c']);
    assert.equal(merged.find((t) => t.id === 'a')?.fiat, 2);
  });
});

describe('form parsing', () => {
  test('amounts accept currency symbols and thousands separators', () => {
    assert.equal(parseAmount('£1,250.50'), 1250.5);
    assert.equal(parseAmount(' $ 20 '), 20);
    assert.equal(parseAmount('.5'), 0.5);
    for (const bad of ['', 'abc', '1.2.3', '-5', '1e5']) assert.equal(parseAmount(bad), null, bad);
  });

  test('dates are read as local time, and impossible dates are rejected', () => {
    assert.equal(parseLocalDateTime('2026-03-05', '09:30'), new Date(2026, 2, 5, 9, 30).getTime());
    assert.equal(parseLocalDateTime('2026-02-31', '10:00'), null, '31 February must not roll into March');
    assert.equal(parseLocalDateTime('2026-13-01', '10:00'), null);
    assert.equal(parseLocalDateTime('2026-01-01', '24:00'), null);
    assert.equal(parseLocalDateTime('01/01/2026', '10:00'), null);
  });

  const form = { side: 'buy' as const, date: '2026-01-02', time: '10:00', total: '500', currency: 'GBP' as const, btc: '', price: '', fee: '' };
  const NOW = new Date(2026, 5, 1).getTime();

  test('BTC may be left blank, to be filled from the market price', () => {
    const r = parseTradeForm(form, NOW);
    assert.ok(r.ok);
    assert.equal(r.btc, null);
    assert.equal(r.fiat, 500);
  });

  test('reads the figures off a Coinbase-style order: total, BTC, price and fee', () => {
    const r = parseTradeForm({ ...form, total: '£250.00', btc: '0.00392063', price: '£63,000.00', fee: '£3.00' }, NOW);
    assert.ok(r.ok, r.ok ? '' : r.error);
    assert.equal(r.fiat, 250);
    assert.equal(r.fee, 3);
    assert.equal(r.unitPrice, 63000);
  });

  test('rejects a trade in the future, a zero amount and a nonsense BTC figure', () => {
    assert.equal(parseTradeForm({ ...form, date: '2026-07-01' }, NOW).ok, false);
    assert.equal(parseTradeForm({ ...form, total: '0' }, NOW).ok, false);
    assert.equal(parseTradeForm({ ...form, btc: 'lots' }, NOW).ok, false);
    assert.equal(parseTradeForm({ ...form, btc: '22000000' }, NOW).ok, false);
  });
});

describe('summariseHoldings', () => {
  test('buys accumulate BTC and cost; value and P&L use the live price', () => {
    const s = summariseHoldings([trade({ fiat: 1000, btc: 0.02 }), trade({ fiat: 500, btc: 0.01, time: T0 + DAY })], 'GBP', LIVE);
    assert.equal(s.btc, 0.03);
    assert.equal(s.costBasis, 1500);
    assert.equal(s.avgCost, 50000);
    assert.equal(s.value, 0.03 * 60000);
    assert.ok(Math.abs(s.unrealised - 300) < 1e-9);
    assert.ok(Math.abs((s.unrealisedPct ?? 0) - 20) < 1e-9);
    assert.equal(s.converted, false);
  });

  /**
   * Average cost: selling half the coins removes half the cost, and the
   * realised P&L is proceeds minus what those coins cost on average.
   */
  test('a sell realises P&L at the average cost and leaves the average unchanged', () => {
    const s = summariseHoldings(
      [trade({ fiat: 1000, btc: 0.02 }), trade({ fiat: 3000, btc: 0.02, time: T0 + DAY }), trade({ side: 'sell', fiat: 2500, btc: 0.02, time: T0 + 2 * DAY })],
      'GBP',
      LIVE
    );
    assert.ok(Math.abs(s.btc - 0.02) < 1e-12);
    assert.ok(Math.abs(s.costBasis - 2000) < 1e-9);
    assert.ok(Math.abs((s.avgCost ?? 0) - 100000) < 1e-6);
    assert.ok(Math.abs(s.realised - 500) < 1e-9);
    assert.equal(s.invested, 4000);
  });

  test('sells are applied in date order, whatever order they were logged in', () => {
    const buy = trade({ id: 'b', fiat: 1000, btc: 0.02, time: T0 });
    const sell = trade({ id: 's', side: 'sell', fiat: 800, btc: 0.01, time: T0 + DAY, createdAt: T0 - DAY });
    assert.equal(summariseHoldings([sell, buy], 'GBP', LIVE).oversold, false);
  });

  test('flags selling more than was ever logged, and never shows negative holdings', () => {
    const s = summariseHoldings([trade({ btc: 0.01 }), trade({ side: 'sell', btc: 0.05, fiat: 100, time: T0 + DAY })], 'GBP', LIVE);
    assert.equal(s.oversold, true);
    assert.equal(s.btc, 0);
    assert.equal(s.costBasis, 0);
  });

  test('trades in the other currency are converted at today\'s rate and flagged', () => {
    const s = summariseHoldings([trade({ currency: 'USD', fiat: 800, btc: 0.01 })], 'GBP', LIVE);
    assert.equal(s.converted, true);
    assert.equal(s.costBasis, 600);
  });

  test('no trades is an empty summary, not a division by zero', () => {
    const s = summariseHoldings([], 'USD', LIVE);
    assert.equal(s.btc, 0);
    assert.equal(s.avgCost, null);
    assert.equal(s.unrealisedPct, null);
  });
});

describe('priceAt', () => {
  const daily: OHLCVCandle[] = [0, 1, 2, 3].map((i) => ({ time: T0 + i * DAY, open: 100 + i, high: 0, low: 0, close: 110 + i }));
  const hourly: OHLCVCandle[] = [0, 1, 2].map((i) => ({ time: T0 + 2 * DAY + i * HOUR, open: 0, high: 0, low: 0, close: 500 + i }));
  const series = [{ candles: hourly, intervalMs: HOUR }, { candles: daily, intervalMs: DAY }];

  test('uses the finest series that covers the moment', () => {
    assert.equal(priceAt(T0 + 2 * DAY + 90 * 60 * 1000, series), 501);
  });

  test('falls back to a coarser series outside the fine one', () => {
    assert.equal(priceAt(T0 + DAY + 5 * HOUR, series), 111);
  });

  test('is null before or after all data', () => {
    assert.equal(priceAt(T0 - 1, series), null);
    assert.equal(priceAt(T0 + 4 * DAY, series), null);
  });
});

describe('tradeOutcomes', () => {
  const daily: OHLCVCandle[] = Array.from({ length: 40 }, (_, i) => ({ time: T0 + i * DAY, open: 0, high: 0, low: 0, close: 100 + i }));
  const series = [{ candles: daily, intervalMs: DAY }];
  const NOW = T0 + 39 * DAY + 1;

  test('measures from the market price at the time, not the price paid', () => {
    const [d1, d7, d30, d90] = tradeOutcomes(trade({ time: T0, marketPriceUsd: 100, fiat: 999, btc: 0.001 }), series, NOW);
    assert.ok(Math.abs((d1!.change ?? 0) - 0.01) < 1e-12);
    assert.ok(Math.abs((d7!.change ?? 0) - 0.07) < 1e-12);
    assert.ok(Math.abs((d30!.change ?? 0) - 0.3) < 1e-12);
    assert.equal(d90!.change, null, 'not due yet');
    assert.equal(d1!.favourable, true);
  });

  test('for a sell, a fall afterwards is the favourable outcome', () => {
    const [d1] = tradeOutcomes(trade({ side: 'sell', time: T0, marketPriceUsd: 200 }), series, NOW);
    assert.ok((d1!.change ?? 0) < 0);
    assert.equal(d1!.favourable, true);
  });

  test('a horizon that has not arrived yet stays unknown even if a candle exists', () => {
    const [d1] = tradeOutcomes(trade({ time: T0 }), series, T0 + DAY - 1);
    assert.equal(d1!.change, null);
  });
});

describe('tradesToCsv', () => {
  test('one header plus one row per trade, with notes safely quoted', () => {
    const csv = tradesToCsv([trade({ note: 'payday, "big" buy' })]);
    const lines = csv.split('\n');
    assert.equal(lines.length, 2);
    assert.ok(lines[1]!.endsWith('"payday, ""big"" buy"'));
  });
});

describe('groupBuysBySignal', () => {
  const daily: OHLCVCandle[] = Array.from({ length: 60 }, (_, i) => ({ time: T0 + i * DAY, open: 0, high: 0, low: 0, close: 100 + i }));
  const series = [{ candles: daily, intervalMs: DAY }];
  const stamp = (action: SignalStamp['action']): SignalStamp => ({
    action, targetAllocation: 0.9, dcaMultiplier: 1.5, conviction: 70, regimeScore: 3, fearGreed: null, source: 'live',
  });
  const NOW = T0 + 59 * DAY + 1;

  test('groups buys by the signal at the time, in tier order, ignoring sells and unstamped trades', () => {
    const g = groupBuysBySignal(
      [
        trade({ time: T0, marketPriceUsd: 100, signal: stamp('HOLD') }),
        trade({ time: T0, marketPriceUsd: 100, signal: stamp('ACCUMULATE_STRONG') }),
        trade({ time: T0 + 10 * DAY, marketPriceUsd: 110, signal: stamp('ACCUMULATE_STRONG') }),
        trade({ side: 'sell', time: T0, marketPriceUsd: 100, signal: stamp('HOLD') }),
        trade({ time: T0, marketPriceUsd: 100, signal: null }),
      ],
      series,
      NOW
    );
    assert.deepEqual(g.map((x) => [x.action, x.buys]), [['ACCUMULATE_STRONG', 2], ['HOLD', 1]]);
    // 30d after T0: 130/100 - 1 = 0.3; 30d after T0+10: 140/110 - 1.
    const expected = (0.3 + (140 / 110 - 1)) / 2;
    assert.ok(Math.abs((g[0]!.after30d.mean ?? 0) - expected) < 1e-12);
    assert.equal(g[0]!.after30d.n, 2);
  });

  test('buys whose horizon has not passed are counted but not averaged', () => {
    const g = groupBuysBySignal([trade({ time: NOW - 2 * DAY, marketPriceUsd: 150, signal: stamp('HOLD') })], series, NOW);
    assert.equal(g[0]!.buys, 1);
    assert.equal(g[0]!.after7d.mean, null);
  });
});

describe('format', () => {
  /** REGRESSION TEST: a tiny fall printed as "-0.0%", coloured as a gain. */
  test('a move that rounds to zero is "0.0%", with no sign, and counts as flat', () => {
    assert.equal(formatPct(-0.00002), '0.0%');
    assert.equal(formatPct(0.00002), '0.0%');
    assert.equal(isFlat(-0.00002), true);
    assert.equal(formatPct(0.0213), '+2.1%');
    assert.equal(formatPct(-0.05), '-5.0%');
  });
  test('money and BTC', () => {
    assert.equal(formatMoney(84428.4, 'GBP'), '£84,428');
    assert.equal(formatMoney(-25.5, 'USD'), '-$25.50');
    assert.equal(formatMoney(4.34, 'GBP', true), '+£4.34');
    assert.equal(formatBtc(0.005917), '0.005917');
    assert.equal(formatBtc(1), '1');
  });
});

describe('resolveTradeFigures', () => {
  const near = (a: number | null, b: number) => assert.ok(a != null && Math.abs(a - b) < 1e-9, `${a} != ${b}`);

  test('buy: total and BTC give the price before fees', () => {
    const r = resolveTradeFigures('buy', 250, 0.004, null, 2);
    assert.ok(r.ok);
    near(r.figures.unitPrice, 62000);
  });

  test('buy: BTC and price give the total, fee added', () => {
    const r = resolveTradeFigures('buy', null, 0.004, 62000, 2);
    assert.ok(r.ok);
    near(r.figures.fiat, 250);
  });

  test('buy: total and price give the BTC, fee taken off first', () => {
    const r = resolveTradeFigures('buy', 250, null, 62000, 2);
    assert.ok(r.ok);
    near(r.figures.btc, 0.004);
  });

  test('sell: the fee comes off what you receive', () => {
    const r = resolveTradeFigures('sell', null, 0.01, 60000, 5);
    assert.ok(r.ok);
    near(r.figures.fiat, 595);
    const back = resolveTradeFigures('sell', 595, 0.01, null, 5);
    assert.ok(back.ok);
    near(back.figures.unitPrice, 60000);
  });

  /** A typo in one of three figures must be caught, not averaged into your cost. */
  test('three figures that do not add up are rejected', () => {
    const r = resolveTradeFigures('buy', 250, 0.004, 26000, 2);
    assert.equal(r.ok, false);
  });

  test('three figures that agree within rounding are accepted', () => {
    assert.equal(resolveTradeFigures('buy', 250, 0.00392063, 63000, 3).ok, true);
  });

  test('total alone is allowed and leaves BTC to the market price', () => {
    const r = resolveTradeFigures('buy', 250, null, null, 2);
    assert.ok(r.ok);
    assert.equal(r.figures.btc, null);
    const filled = fillFromMarket('buy', r.figures, 62000);
    near(filled!.btc, 0.004);
    assert.equal(filled!.unitPrice, 62000);
    assert.equal(fillFromMarket('buy', r.figures, null), null);
  });

  test('rejects too little information, a fee bigger than the total, and negatives', () => {
    assert.equal(resolveTradeFigures('buy', null, 0.004, null, null).ok, false);
    assert.equal(resolveTradeFigures('buy', null, null, 62000, null).ok, false);
    assert.equal(resolveTradeFigures('buy', 2, 0.001, null, 5).ok, false);
    assert.equal(resolveTradeFigures('buy', 250, null, null, -1).ok, false);
  });
});

describe('starting balance', () => {
  const opening: OpeningPosition = { time: T0 + 10 * DAY, invested: 5000, currency: 'GBP', btc: 0.1, updatedAt: T0 };

  test('your average cost comes from what you put in and what you hold, in both currencies', () => {
    const s = summariseHoldings([], 'GBP', LIVE, opening);
    assert.equal(s.btc, 0.1);
    assert.equal(s.avgCost, 50000);
    assert.equal(s.avgCostIn.GBP, 50000);
    assert.ok(Math.abs((s.avgCostIn.USD ?? 0) - 50000 * (80000 / 60000)) < 1e-6, 'converted at today\'s rate');
    assert.equal(s.hasOpening, true);
  });

  /**
   * Trades on or before the starting balance are already inside it. Counting
   * them again would double your holdings the moment you back-log an order.
   */
  test('trades dated before the starting balance are not counted twice', () => {
    const before = trade({ time: T0, fiat: 1000, btc: 0.02 });
    const after = trade({ time: T0 + 20 * DAY, fiat: 1000, btc: 0.02 });
    const s = summariseHoldings([before, after], 'GBP', LIVE, opening);
    assert.ok(Math.abs(s.btc - 0.12) < 1e-12);
    assert.equal(s.costBasis, 6000);
    assert.equal(s.covered, 1);
    assert.equal(isCoveredByOpening(before, opening), true);
    assert.equal(isCoveredByOpening(after, opening), false);
  });

  test('a sell after the starting balance realises against its average cost', () => {
    const s = summariseHoldings([trade({ side: 'sell', time: T0 + 20 * DAY, fiat: 3000, btc: 0.05 })], 'GBP', LIVE, opening);
    assert.ok(Math.abs(s.realised - 500) < 1e-9);
    assert.ok(Math.abs(s.btc - 0.05) < 1e-12);
  });

  test('form validation and storage round trip', () => {
    const r = parseOpeningForm({ invested: '£5,000', btc: '0.1', currency: 'GBP' }, T0, T0);
    assert.ok(r.ok);
    assert.deepEqual(parseOpening(JSON.stringify(r.opening)), r.opening);
    assert.equal(parseOpeningForm({ invested: '0', btc: '0.1', currency: 'GBP' }, T0).ok, false);
    assert.equal(parseOpeningForm({ invested: '100', btc: '', currency: 'GBP' }, T0).ok, false);
    assert.equal(parseOpening('{"time": 1}'), null);
    assert.equal(parseOpening('nope'), null);
  });

  test('a backup carries the starting balance; an old backup simply has none', () => {
    const b = parseBackup(serialiseBackup([trade({ id: 'z' })], opening));
    assert.deepEqual(b.opening, opening);
    assert.equal(b.trades.length, 1);
    assert.equal(parseBackup(JSON.stringify({ app: 'btc-analyst', version: 1, trades: [trade({ id: 'y' })] })).opening, null);
  });
});
