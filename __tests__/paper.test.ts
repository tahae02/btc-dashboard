import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseBook, toStored, parsePaperSettings, serialisePaperBackup, parsePaperBackup, mergeBooks, suggestedAmount,
  compareWithApp, paperFigures, parsePaperAmount, parseLimitOrder, parseUsualAmount, parseChance, checkOrder,
  filledLive, fillMarketPrices, fillOrder, settledPriceAt, recordAfter, recordBookAfter, hasDueAfter, moveAfter,
  detectConditions, change24h, change7d, adviceChangeFrom, timeline, deleteFromBook, paperToCsv, isBriefEmpty,
  DEFAULT_PAPER_SETTINGS, EMPTY_BOOK,
  type PaperTrade, type PaperOrder, type PaperSkip, type PaperBook, type DecisionMeta,
} from '../src/services/paper';
import { parseTrades, parseBackup, summariseHoldings, type SignalStamp } from '../src/services/journal';
import type { OHLCVCandle } from '../src/types';

const HOUR = 3600000;
const DAY = 24 * HOUR;
const T0 = Date.UTC(2026, 5, 1);

const stamp = (over: Partial<SignalStamp> = {}): SignalStamp => ({
  action: 'ACCUMULATE', targetAllocation: 0.78, dcaMultiplier: 1.3, conviction: 62, regimeScore: 2, fearGreed: 40,
  source: 'live', regime: 'BULL', fearGreedLabel: 'Fear', stretchScore: 0.1, momentumScore: 0.2, rsi: 55, atrPct: 2.5,
  priceVsSma200Pct: 12, sma200: 70000, ...over,
});

const meta = (over: Partial<DecisionMeta> = {}): DecisionMeta => ({
  advice: 'app', scenario: 'routine', usualAmount: 100, suggestedAmount: 130, change24hPct: 1.2, brief: null, ...over,
});

const ptrade = (over: Partial<PaperTrade> = {}, m: Partial<PaperTrade['paper']> = {}): PaperTrade => ({
  id: over.id ?? Math.random().toString(36).slice(2),
  side: 'buy', time: T0, fiat: 130, currency: 'GBP', btc: 0.002, unitPrice: 64350, fee: 1.56,
  marketPriceUsd: 80000, marketPriceGbp: 64350, signal: stamp(), note: '', createdAt: T0,
  paper: { ...meta(), orderId: null, after: {}, ...m },
  ...over,
});

const order = (over: Partial<PaperOrder> = {}): PaperOrder => ({
  id: over.id ?? Math.random().toString(36).slice(2),
  currency: 'GBP', total: 200, limitPrice: 60000, feePct: 0.6, placedAt: T0 + 30 * 60000, expiresAt: T0 + 2 * DAY,
  marketAtPlacement: 62000, marketPriceUsd: 77000, marketPriceGbp: 62000, signal: stamp(), meta: meta({ advice: 'brief' }),
  note: '', status: 'open', closedAt: null, priceAtClose: null, tradeId: null, after: {}, createdAt: T0,
  ...over,
});

const skip = (over: Partial<PaperSkip> = {}): PaperSkip => ({
  id: over.id ?? Math.random().toString(36).slice(2),
  time: T0, currency: 'GBP', marketPriceUsd: 80000, marketPriceGbp: 64000, signal: stamp({ action: 'EXIT', dcaMultiplier: 0.2 }),
  meta: meta({ suggestedAmount: 20 }), note: '', after: {}, createdAt: T0,
  ...over,
});

/** Hourly bars from T0, one per entry, with the given lows (highs and closes above). */
const hourly = (lows: number[], start = T0): OHLCVCandle[] =>
  lows.map((low, i) => ({ time: start + i * HOUR, open: low + 500, high: low + 1000, low, close: low + 400 }));

describe('storage', () => {
  test('a book round-trips through storage and through a backup', () => {
    const book: PaperBook = {
      trades: [ptrade({ id: 't1' }), ptrade({ id: 't2', side: 'sell', time: T0 + DAY, fiat: 50, btc: 0.0008 })],
      orders: [order({ id: 'o1' })],
      skips: [skip({ id: 's1', time: T0 + 2 * DAY })],
    };
    assert.deepEqual(parseBook(JSON.stringify(toStored(book))), book);
    const restored = parsePaperBackup(serialisePaperBackup(book, DEFAULT_PAPER_SETTINGS));
    assert.ok(restored.ok);
    if (restored.ok) {
      assert.deepEqual(restored.book, book);
      assert.deepEqual(restored.settings, DEFAULT_PAPER_SETTINGS);
      assert.equal(restored.count, 4);
    }
  });

  test('corrupt storage gives an empty book', () => {
    for (const raw of [null, '', '{', '7', '{"paperTrades": 3}']) assert.deepEqual(parseBook(raw), EMPTY_BOOK);
  });

  test('invalid entries are dropped one at a time and missing fields default', () => {
    const raw = JSON.stringify({
      paperTrades: [
        ptrade({ id: 'good' }),
        { ...ptrade({ id: 'nopaper' }), paper: undefined },
        { ...ptrade({ id: 'neg' }), fiat: -1 },
        { ...ptrade({ id: 'oddmeta' }), paper: { advice: 'guru', scenario: 'moon', brief: { verdict: 'YOLO', lower24h: 140 } } },
      ],
      orders: [order({ id: 'ok' }), { ...order({ id: 'back' }), expiresAt: T0 - DAY }, { ...order({ id: 'nolimit' }), limitPrice: 0 }],
      skips: [skip({ id: 'k' }), { ...skip({ id: 'eur' }), currency: 'EUR' }],
    });
    const b = parseBook(raw);
    assert.deepEqual(b.trades.map((t) => t.id).sort(), ['good', 'oddmeta']);
    const odd = b.trades.find((t) => t.id === 'oddmeta')!;
    assert.equal(odd.paper.advice, 'own', 'an unreadable source never counts as following the app');
    assert.equal(odd.paper.scenario, 'other');
    assert.equal(odd.paper.brief, null, 'a brief with nothing valid in it is dropped');
    assert.deepEqual(odd.paper.after, {});
    assert.deepEqual(b.orders.map((o) => o.id), ['ok']);
    assert.deepEqual(b.skips.map((s) => s.id), ['k']);
  });

  test('paper and real records can never be mixed up', () => {
    const backup = serialisePaperBackup({ ...EMPTY_BOOK, trades: [ptrade({ id: 'p' })] }, DEFAULT_PAPER_SETTINGS);
    assert.deepEqual(parseTrades(backup), [], 'a paper backup restores no real trades');
    assert.deepEqual(parseBackup(backup).trades, []);
    assert.deepEqual(parseTrades(JSON.stringify([ptrade({ id: 'p' })])), [], 'a paper trade in a real list is refused');
    const real = JSON.stringify({ app: 'btc-analyst', version: 2, opening: null, trades: [{ ...ptrade({ id: 'r' }), paper: undefined }] });
    const r = parsePaperBackup(real);
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /real trades/);
    assert.equal(parsePaperBackup('not json').ok, false);
    assert.equal(parsePaperBackup(JSON.stringify({ kind: 'paper', paperTrades: [] })).ok, false, 'empty');
  });

  test('settings default field by field and fees are capped', () => {
    assert.deepEqual(parsePaperSettings(null), DEFAULT_PAPER_SETTINGS);
    assert.deepEqual(parsePaperSettings('{'), DEFAULT_PAPER_SETTINGS);
    const s = parsePaperSettings(JSON.stringify({ usualAmount: 150, currency: 'USD', marketFeePct: 55, limitFeePct: 0.4 }));
    assert.deepEqual(s, { usualAmount: 150, currency: 'USD', marketFeePct: DEFAULT_PAPER_SETTINGS.marketFeePct, limitFeePct: 0.4 });
    assert.equal(parsePaperSettings(JSON.stringify({ usualAmount: -3 })).usualAmount, null);
  });

  test('merging a backup keeps both sides, and the backup wins on the same id', () => {
    const a: PaperBook = { trades: [ptrade({ id: 'x', fiat: 1 })], orders: [order({ id: 'o' })], skips: [] };
    const b: PaperBook = { trades: [ptrade({ id: 'x', fiat: 2 }), ptrade({ id: 'y' })], orders: [], skips: [skip({ id: 's' })] };
    const m = mergeBooks(a, b);
    assert.deepEqual(m.trades.map((t) => t.id).sort(), ['x', 'y']);
    assert.equal(m.trades.find((t) => t.id === 'x')?.fiat, 2);
    assert.equal(m.orders.length, 1);
    assert.equal(m.skips.length, 1);
  });
});

describe('following the advice', () => {
  test('the suggestion is the usual amount times the multiplier', () => {
    assert.equal(suggestedAmount(100, stamp({ dcaMultiplier: 1.3 })), 130);
    assert.equal(suggestedAmount(25, stamp({ dcaMultiplier: 0.7 })), 17.5);
    assert.equal(suggestedAmount(null, stamp()), null);
    assert.equal(suggestedAmount(100, null), null);
  });

  test('within 5% (or one pound) of the suggestion counts as following it', () => {
    assert.equal(compareWithApp(130, 130), 'same');
    assert.equal(compareWithApp(125, 130), 'same');
    assert.equal(compareWithApp(140, 130), 'more');
    assert.equal(compareWithApp(100, 130), 'less');
    assert.equal(compareWithApp(0, 0.5), 'same', 'skipping when the app says almost nothing');
    assert.equal(compareWithApp(0, 60), 'less');
    assert.equal(compareWithApp(100, null), null);
  });
});

describe('figures', () => {
  test('a paper buy pays the fee out of the amount, like a real one', () => {
    const f = paperFigures('buy', 100, 50000, 1.2)!;
    assert.equal(f.fee, 1.2);
    assert.equal(f.fiat, 100);
    assert.ok(Math.abs(f.btc! - 98.8 / 50000) < 1e-12);
    assert.ok(Math.abs(f.btc! * f.unitPrice! + f.fee - f.fiat) < 1e-9, 'total = BTC x price + fee');
  });

  test('a paper sell receives the value less the fee', () => {
    const f = paperFigures('sell', 100, 50000, 1.2)!;
    assert.equal(f.fiat, 98.8);
    assert.equal(f.btc, 0.002);
    assert.ok(Math.abs(f.btc! * f.unitPrice! - f.fee - f.fiat) < 1e-9, 'total = BTC x price - fee');
  });

  test('nonsense gives nothing rather than a broken trade', () => {
    assert.equal(paperFigures('buy', 0, 50000, 1), null);
    assert.equal(paperFigures('buy', 100, 0, 1), null);
    assert.equal(paperFigures('buy', 100, 50000, 100), null);
  });

  test('amounts: a sell cannot exceed the paper holdings', () => {
    assert.deepEqual(parsePaperAmount('£1,000', 'buy', 50000, 0, 'GBP'), { ok: true, amount: 1000 });
    assert.equal(parsePaperAmount('', 'buy', 50000, 0, 'GBP').ok, false);
    assert.equal(parsePaperAmount('100', 'buy', null, 0, 'GBP').ok, false, 'no live price, no paper trade');
    assert.equal(parsePaperAmount('100', 'sell', 50000, 0.002, 'GBP').ok, true);
    const over = parsePaperAmount('101', 'sell', 50000, 0.002, 'GBP');
    assert.equal(over.ok, false);
    if (!over.ok) assert.match(over.error, /0\.002 BTC/);
  });

  test('a limit buy must sit below the price, but not absurdly far', () => {
    assert.deepEqual(parseLimitOrder('200', '60,000', 62000, 'GBP'), { ok: true, total: 200, limitPrice: 60000 });
    const above = parseLimitOrder('200', '62000', 62000, 'GBP');
    assert.equal(above.ok, false);
    if (!above.ok) assert.match(above.error, /fill straight away/);
    assert.equal(parseLimitOrder('200', '20000', 62000, 'GBP').ok, false);
    assert.equal(parseLimitOrder('', '60000', 62000, 'GBP').ok, false);
    assert.equal(parseLimitOrder('200', '60000', null, 'GBP').ok, false);
  });

  test('usual amounts and chances', () => {
    assert.equal(parseUsualAmount(''), null);
    assert.equal(parseUsualAmount('£100'), 100);
    assert.equal(parseUsualAmount('abc'), 'bad');
    assert.equal(parseChance('55%'), 55);
    assert.equal(parseChance(' 40 '), 40);
    assert.equal(parseChance(''), null);
    assert.equal(parseChance('140'), 'bad');
    assert.equal(parseChance('lots'), 'bad');
    assert.equal(isBriefEmpty({ verdict: null, confidence: null, lower24h: null, lower48h: null, lower7d: null }), true);
    assert.equal(isBriefEmpty({ verdict: 'WAIT', confidence: null, lower24h: null, lower48h: null, lower7d: null }), false);
  });
});

describe('limit orders', () => {
  // Placed at 00:30. The 00:00 bar straddles placement and must be ignored.
  const o = order({ placedAt: T0 + 30 * 60000, expiresAt: T0 + 30 * 60000 + DAY, limitPrice: 60000 });

  test('fills on the first whole bar after placement that trades at the limit', () => {
    const c = hourly([59000, 61000, 60500, 59990, 58000]);
    assert.deepEqual(checkOrder(o, c, HOUR), { kind: 'filled', at: T0 + 3 * HOUR });
  });

  test('a dip in the bar it was placed in does not count, since it may have come first', () => {
    const c = hourly([55000, 61000, 61000]);
    assert.deepEqual(checkOrder(o, c, HOUR), { kind: 'open' });
  });

  test('the still-forming bar counts, because its low so far is real', () => {
    const c = hourly([61000, 61000, 59999]);
    assert.deepEqual(checkOrder(o, c, HOUR), { kind: 'filled', at: T0 + 2 * HOUR });
  });

  test('runs out only once the data reaches past the expiry', () => {
    const notYet = hourly(Array(24).fill(61000));
    assert.deepEqual(checkOrder(o, notYet, HOUR), { kind: 'open' }, 'last bar ends exactly at 24:00, before the 24:30 expiry');
    const past = hourly(Array(26).fill(61000));
    const r = checkOrder(o, past, HOUR);
    assert.equal(r.kind, 'expired');
    if (r.kind === 'expired') assert.equal(r.priceAtClose, 61400, 'close of the bar the expiry falls in');
  });

  test('a dip in the bar the expiry falls in does not count either', () => {
    const lows = Array(26).fill(61000);
    lows[24] = 50000; // 24:00 to 25:00, which the 24:30 expiry cuts through
    assert.equal(checkOrder(o, hourly(lows), HOUR).kind, 'expired');
  });

  test('lapses when the history no longer reaches back to the placement', () => {
    const c = hourly(Array(10).fill(61000), T0 + 5 * HOUR);
    assert.deepEqual(checkOrder(o, c, HOUR), { kind: 'lapsed' });
  });

  test('closed orders are never re-checked', () => {
    assert.deepEqual(checkOrder({ ...o, status: 'cancelled' }, hourly([1, 1, 1]), HOUR), { kind: 'open' });
  });

  test('the live price fills it while the app is open, but only in its window', () => {
    assert.equal(filledLive(o, 59900, o.placedAt + HOUR), true);
    assert.equal(filledLive(o, 60100, o.placedAt + HOUR), false);
    assert.equal(filledLive(o, 59900, o.placedAt - 1), false, 'a price seen before it was placed');
    assert.equal(filledLive(o, 59900, o.expiresAt + 1), false);
    assert.equal(filledLive({ ...o, status: 'filled' }, 1, o.placedAt + HOUR), false);
  });

  test('a fill becomes a paper trade at the limit, with the limit fee and the decision from placement', () => {
    const r = fillOrder(o, T0 + 3 * HOUR, { usd: 75000, gbp: 60000 }, T0 + 5 * HOUR)!;
    assert.equal(r.order.status, 'filled');
    assert.equal(r.order.closedAt, T0 + 3 * HOUR);
    assert.equal(r.order.tradeId, r.trade.id);
    const t = r.trade;
    assert.equal(t.side, 'buy');
    assert.equal(t.unitPrice, 60000);
    assert.equal(t.fiat, 200);
    assert.equal(t.fee, 1.2);
    assert.ok(Math.abs(t.btc - 198.8 / 60000) < 1e-12);
    assert.equal(t.paper.orderId, o.id);
    assert.equal(t.paper.advice, 'brief');
    assert.deepEqual(t.signal, o.signal);
  });

  test('market prices at a fill: the limit in its own currency, the other at that hour\'s rate', () => {
    const usd = [{ candles: hourly([79000, 79000, 79000, 79000]).map((c) => ({ ...c, close: 80000 })), intervalMs: HOUR }];
    const gbp = [{ candles: hourly([63000, 63000, 63000, 63000]).map((c) => ({ ...c, close: 64000 })), intervalMs: HOUR }];
    const m = fillMarketPrices(o, T0 + 3 * HOUR, usd, gbp, null);
    assert.equal(m.gbp, 60000);
    assert.equal(m.usd, 60000 * (80000 / 64000));
    const fallback = fillMarketPrices(o, T0 + 3 * HOUR, [], [], { usd: 100, gbp: 80 });
    assert.equal(fallback.usd, 75000);
    assert.deepEqual(fillMarketPrices(o, T0, [], [], null), { gbp: 60000, usd: null });
  });
});

describe('prices after each decision', () => {
  const hours = hourly(Array.from({ length: 24 * 9 }, (_, i) => 70000 + i));
  const series = [{ candles: hours, intervalMs: HOUR }];

  test('recorded once due, from the bar containing that moment', () => {
    const now = T0 + 8 * DAY;
    const after = recordAfter({}, T0, series, now);
    assert.equal(after['24h'], hours[24]!.close);
    assert.equal(after['48h'], hours[48]!.close);
    assert.equal(after['7d'], hours[24 * 7]!.close);
    assert.equal(after['30d'], undefined, 'not due yet');
  });

  test('a recorded price is never overwritten, and nothing new returns the same object', () => {
    const now = T0 + 8 * DAY;
    const first = recordAfter({ '24h': 1 }, T0, series, now);
    assert.equal(first['24h'], 1);
    const again = recordAfter(first, T0, series, now);
    assert.equal(again, first);
  });

  test('a daily bar is only used once it has closed', () => {
    const daily = [{ candles: [{ time: T0, open: 1, high: 1, low: 1, close: 70000 }], intervalMs: DAY }];
    assert.equal(settledPriceAt(T0 + 5 * HOUR, daily, T0 + 6 * HOUR), null);
    assert.equal(settledPriceAt(T0 + 5 * HOUR, daily, T0 + DAY), 70000);
  });

  test('across the whole book, and only when something is due', () => {
    const b: PaperBook = { trades: [ptrade({ id: 't', time: T0 })], orders: [order({ id: 'o', placedAt: T0 })], skips: [skip({ id: 's', time: T0 })] };
    assert.equal(hasDueAfter(b, T0 + HOUR), false);
    assert.equal(hasDueAfter(b, T0 + DAY), true);
    const next = recordBookAfter(b, series, T0 + 2 * DAY + HOUR);
    assert.equal(next.trades[0]!.paper.after['48h'], hours[48]!.close);
    assert.equal(next.orders[0]!.after['24h'], hours[24]!.close);
    assert.equal(next.skips[0]!.after['24h'], hours[24]!.close);
    assert.equal(recordBookAfter(next, series, T0 + 2 * DAY + HOUR), next);
  });

  test('moves are measured from the decision\'s own price', () => {
    assert.ok(Math.abs(moveAfter(80000, { '7d': 84000 }, '7d')! - 0.05) < 1e-12);
    assert.equal(moveAfter(80000, {}, '7d'), null);
    assert.equal(moveAfter(null, { '7d': 1 }, '7d'), null);
  });
});

describe('conditions', () => {
  test('flags big moves, extreme mood and a changed advice', () => {
    const c = detectConditions({ change24hPct: -6.2, fearGreed: 15, adviceChange: { from: 'HOLD', to: 'ACCUMULATE' } });
    assert.deepEqual(c.scenarios, ['signalChange', 'bigMove', 'extremeMood']);
    assert.equal(c.notes.length, 3);
    assert.match(c.notes[1]!, /down 6\.2%/);
    assert.deepEqual(detectConditions({ change24hPct: 2, fearGreed: 50, adviceChange: null }).scenarios, []);
    const week = detectConditions({ change24hPct: 1, change7dPct: 12.5, fearGreed: 50, adviceChange: null });
    assert.deepEqual(week.scenarios, ['bigMove']);
    assert.match(week.notes[0]!, /up 12\.5% in a week/);
  });

  test('the advice changed when the last two logged days disagree, and only recently', () => {
    const call = (i: number, action: any) => ({
      day: T0 + i * DAY, action, targetAllocation: 0.6, dcaMultiplier: 1, conviction: 50, regimeScore: 0, atr: null, loggedAt: T0, fearGreed: null,
    });
    const log = [call(0, 'HOLD'), call(1, 'ACCUMULATE')];
    assert.deepEqual(adviceChangeFrom(log, T0 + 2 * DAY + HOUR), { from: 'HOLD', to: 'ACCUMULATE' });
    assert.equal(adviceChangeFrom(log, T0 + 10 * DAY), null, 'too long ago to be news');
    assert.equal(adviceChangeFrom([call(0, 'HOLD'), call(1, 'HOLD')], T0 + 2 * DAY), null);
    assert.equal(adviceChangeFrom([call(0, 'HOLD')], T0 + DAY), null);
  });

  test('7-day change from daily bars', () => {
    const daily = Array.from({ length: 10 }, (_, i) => ({ time: T0 + i * DAY, open: 1, high: 1, low: 1, close: 100 + i }));
    // 7 days before day 9 at 06:00 is day 2.
    assert.ok(Math.abs(change7d(daily, 102 * 1.1, T0 + 9 * DAY + 6 * HOUR)! - 10) < 1e-9);
  });

  test('24-hour change from hourly bars', () => {
    const c = hourly(Array(30).fill(0)).map((x, i) => ({ ...x, close: 80000 + i * 100 }));
    const now = T0 + 29 * HOUR + 10 * 60000;
    // 24 hours earlier falls in bar 5, close 80,500.
    assert.ok(Math.abs(change24h(c, 80500 * 1.1, now)! - 10) < 1e-9);
    assert.equal(change24h([], 80000, now), null);
    assert.equal(change24h(c, null, now), null);
  });
});

describe('timeline and deleting', () => {
  const filled = order({ id: 'of', status: 'filled', tradeId: 'tf', closedAt: T0 + 3 * HOUR });
  const b: PaperBook = {
    trades: [ptrade({ id: 'tm', time: T0 + DAY }), ptrade({ id: 'tf', time: T0 + 3 * HOUR }, { orderId: 'of' })],
    orders: [filled, order({ id: 'oo', placedAt: T0 + 2 * DAY }), order({ id: 'ox', status: 'expired', placedAt: T0 + 3 * DAY })],
    skips: [skip({ id: 'sk', time: T0 + 4 * DAY })],
  };

  test('newest first; a filled order appears once, as its trade; waiting orders are left out', () => {
    const items = timeline(b);
    assert.deepEqual(items.map((d) => d.kind), ['skip', 'order', 'trade', 'trade']);
    const fromOrder = items.find((d) => d.kind === 'trade' && d.trade.id === 'tf');
    assert.ok(fromOrder && fromOrder.kind === 'trade' && fromOrder.order?.id === 'of');
  });

  test('deleting a filled order\'s trade removes the order too, and the other way round', () => {
    const a = deleteFromBook(b, 'trade', 'tf');
    assert.deepEqual(a.trades.map((t) => t.id), ['tm']);
    assert.ok(!a.orders.some((o) => o.id === 'of'));
    const c = deleteFromBook(b, 'order', 'of');
    assert.ok(!c.trades.some((t) => t.id === 'tf'));
    const d = deleteFromBook(b, 'skip', 'sk');
    assert.equal(d.skips.length, 0);
    assert.equal(d.trades.length, 2);
  });

  test('paper holdings come out of the same average-cost maths as real ones', () => {
    const s = summariseHoldings(b.trades, 'GBP', { usd: 80000, gbp: 64000 });
    assert.equal(s.buys, 2);
    assert.ok(Math.abs(s.btc - 0.004) < 1e-12);
  });
});

describe('CSV', () => {
  test('one row per decision, oldest first, with a filled order written once', () => {
    const b: PaperBook = {
      trades: [
        ptrade({ id: 'tm', time: T0 + DAY, marketPriceUsd: 80000 }, { after: { '24h': 84000 }, brief: { verdict: 'BUY_NOW', confidence: 'high', lower24h: 40, lower48h: null, lower7d: 45 } }),
        ptrade({ id: 'tf', time: T0 + 3 * HOUR }, { orderId: 'of' }),
      ],
      orders: [order({ id: 'of', status: 'filled', tradeId: 'tf', closedAt: T0 + 3 * HOUR })],
      skips: [skip({ id: 'sk', time: T0 + 2 * DAY })],
    };
    const lines = paperToCsv(b).split('\n');
    assert.equal(lines.length, 4, 'header and three decisions');
    const header = lines[0]!.split(',');
    const col = (line: string, name: string) => line.split(',')[header.indexOf(name)];
    assert.equal(col(lines[1]!, 'record'), 'limit buy');
    assert.equal(col(lines[1]!, 'status'), 'filled');
    assert.equal(col(lines[1]!, 'limit_below_market_pct'), '3.23');
    assert.equal(col(lines[2]!, 'record'), 'buy');
    assert.equal(col(lines[2]!, 'vs_app'), 'same');
    assert.equal(col(lines[2]!, 'brief_verdict'), 'BUY_NOW');
    assert.equal(col(lines[2]!, 'after_24h_pct'), '5');
    assert.equal(col(lines[3]!, 'record'), 'no buy');
    assert.equal(col(lines[3]!, 'vs_app'), 'less');
  });

  test('notes with commas and quotes are escaped', () => {
    const b: PaperBook = { ...EMPTY_BOOK, skips: [skip({ note: 'waited, as "the" brief said' })] };
    assert.ok(paperToCsv(b).endsWith('"waited, as ""the"" brief said"'));
  });
});
