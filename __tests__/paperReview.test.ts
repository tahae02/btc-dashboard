import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { scorePaper, paperHeadlines, paperStart, paperReviewReport, MIN_CALLS } from '../src/services/paperReview';
import { EMPTY_BOOK, type PaperTrade, type PaperOrder, type PaperSkip, type PaperBook, type DecisionMeta, type BriefCall } from '../src/services/paper';
import type { SignalStamp, Trade } from '../src/services/journal';

const DAY = 86400000;
const T0 = Date.UTC(2026, 3, 6);

const stamp = (over: Partial<SignalStamp> = {}): SignalStamp => ({
  action: 'HOLD', targetAllocation: 0.6, dcaMultiplier: 1, conviction: 50, regimeScore: 0, fearGreed: 50, source: 'live', ...over,
});
const meta = (over: Partial<DecisionMeta> = {}): DecisionMeta => ({
  advice: 'app', scenario: 'routine', usualAmount: 100, suggestedAmount: 100, change24hPct: 0, brief: null, ...over,
});
const brief = (over: Partial<BriefCall> = {}): BriefCall => ({ verdict: null, confidence: null, lower24h: null, lower48h: null, lower7d: null, ...over });

/** A paper buy of `fiat` pounds at `gbp` per BTC (USD at 1.25x), no fee. */
const buy = (i: number, fiat: number, gbp: number, m: Partial<PaperTrade['paper']> = {}, over: Partial<PaperTrade> = {}): PaperTrade => ({
  id: `b${i}-${Math.random()}`, side: 'buy', time: T0 + i * DAY, fiat, currency: 'GBP', btc: fiat / gbp, unitPrice: gbp, fee: 0,
  marketPriceUsd: gbp * 1.25, marketPriceGbp: gbp, signal: stamp(), note: '', createdAt: T0,
  paper: { ...meta(), orderId: null, after: {}, ...m }, ...over,
});

const skip = (i: number, gbp: number, m: Partial<DecisionMeta> = {}, after = {}): PaperSkip => ({
  id: `s${i}`, time: T0 + i * DAY, currency: 'GBP', marketPriceUsd: gbp * 1.25, marketPriceGbp: gbp, signal: stamp(),
  meta: meta(m), note: '', after, createdAt: T0,
});

const order = (over: Partial<PaperOrder> = {}): PaperOrder => ({
  id: `o${Math.random()}`, currency: 'GBP', total: 100, limitPrice: 48000, feePct: 0.6, placedAt: T0, expiresAt: T0 + 2 * DAY,
  marketAtPlacement: 50000, marketPriceUsd: 62500, marketPriceGbp: 50000, signal: stamp(), meta: meta({ advice: 'brief' }),
  note: '', status: 'open', closedAt: null, priceAtClose: null, tradeId: null, after: {}, createdAt: T0, ...over,
});

describe('against spreading the same money evenly', () => {
  test('buying more when the price is low beats the same money spread evenly', () => {
    // Day 0 at £50k: £50. Day 1 at £25k: £150. Evenly: £100 each day.
    const b: PaperBook = { ...EMPTY_BOOK, trades: [buy(0, 50, 50000), buy(1, 150, 25000)] };
    const v = scorePaper(b).vsFlat!;
    assert.equal(v.days, 2);
    assert.equal(v.invested, 200);
    // You: 50/50000 + 150/25000 = 0.007 BTC for £200. Even: 100/50000 + 100/25000 = 0.006 BTC.
    assert.ok(Math.abs(v.adviceAvgCost - 200 / 0.007) < 1e-6);
    assert.ok(Math.abs(v.flatAvgCost - 200 / 0.006) < 1e-6);
    assert.ok(v.advantagePct > 0);
  });

  test('a decision not to buy is a day the even buyer still buys on', () => {
    // You skip the expensive day and put £100 in on the cheap one.
    const b: PaperBook = { ...EMPTY_BOOK, trades: [buy(1, 100, 25000)], skips: [skip(0, 50000)] };
    const v = scorePaper(b).vsFlat!;
    assert.equal(v.days, 2);
    assert.ok(Math.abs(v.flatAvgCost - 100 / (50 / 50000 + 50 / 25000)) < 1e-6);
    assert.equal(v.adviceAvgCost, 25000);
  });

  test('a split buy on one day counts as one day, and a filled limit counts at its limit on the day it was placed', () => {
    const o = order({ status: 'filled', placedAt: T0, total: 100, limitPrice: 40000, marketPriceGbp: 50000, tradeId: 'tf', closedAt: T0 + DAY });
    const fromOrder = buy(1, 100, 40000, { orderId: o.id }, { id: 'tf' });
    const b: PaperBook = { trades: [buy(0, 100, 50000), fromOrder, buy(3, 200, 50000)], orders: [o], skips: [] };
    const v = scorePaper(b).vsFlat!;
    assert.equal(v.days, 2, 'day 0 (buy and order) and day 3');
    assert.equal(v.invested, 400);
    assert.ok(Math.abs(v.adviceAvgCost - 400 / (100 / 50000 + 100 / 40000 + 200 / 50000)) < 1e-6);
  });

  test('needs at least two days and some money in', () => {
    assert.equal(scorePaper({ ...EMPTY_BOOK, trades: [buy(0, 100, 50000)] }).vsFlat, null);
    assert.equal(scorePaper({ ...EMPTY_BOOK, skips: [skip(0, 50000), skip(1, 50000)] }).vsFlat, null);
  });
});

describe('groups', () => {
  test('buys are grouped by source, reason, tier and how they compared with the app', () => {
    const up = { '7d': 1.1, '30d': 1.2 }; // as a multiple of the decision's USD price, filled in below
    const at = (gbp: number, mult: { '7d': number; '30d': number }) => ({ '7d': gbp * 1.25 * mult['7d'], '30d': gbp * 1.25 * mult['30d'] });
    const b: PaperBook = {
      ...EMPTY_BOOK,
      trades: [
        buy(0, 100, 40000, { after: at(40000, up) }),
        buy(1, 300, 40000, { advice: 'own', scenario: 'bigMove', after: at(40000, { '7d': 0.9, '30d': 0.8 }) }, { signal: stamp({ action: 'ACCUMULATE' }) }),
        buy(2, 100, 40000),
        { ...buy(3, 100, 40000), side: 'sell' },
      ],
    };
    const c = scorePaper(b);
    assert.equal(c.buys, 3);
    assert.equal(c.sells, 1);
    assert.deepEqual(c.bySource.map((g) => [g.key, g.buys]), [['app', 2], ['own', 1]]);
    const app = c.bySource[0]!;
    assert.equal(app.after30d.n, 1, 'only buys old enough to have a 30-day price count');
    assert.ok(Math.abs(app.after30d.mean! - 0.2) < 1e-12);
    assert.deepEqual(c.byScenario.map((g) => g.key), ['routine', 'bigMove']);
    assert.deepEqual(c.byTier.map((g) => g.key), ['ACCUMULATE', 'HOLD'], 'in tier order');
    assert.deepEqual(c.byVsApp.map((g) => [g.key, g.buys]), [['same', 2], ['more', 1]]);
  });
});

describe("Claude's calls", () => {
  test('scored like a weather forecast: chance given against how often it happened', () => {
    const p = 40000;
    const down = { '24h': p * 1.25 * 0.97 };
    const upp = { '24h': p * 1.25 * 1.02 };
    const b: PaperBook = {
      ...EMPTY_BOOK,
      trades: [
        buy(0, 100, p, { advice: 'brief', brief: brief({ verdict: 'BUY_NOW', lower24h: 30 }), after: upp }),
        buy(1, 100, p, { advice: 'brief', brief: brief({ verdict: 'BUY_NOW', lower24h: 30 }), after: down }),
      ],
      skips: [skip(2, p, { advice: 'brief', brief: brief({ verdict: 'WAIT', lower24h: 70 }) }, down)],
    };
    const c = scorePaper(b);
    const cal = c.calibration.find((x) => x.key === '24h')!;
    assert.equal(cal.n, 3);
    assert.ok(Math.abs(cal.meanForecast! - (0.3 + 0.3 + 0.7) / 3) < 1e-12);
    assert.ok(Math.abs(cal.lowerRate! - 2 / 3) < 1e-12);
    // (0.3-0)^2 + (0.3-1)^2 + (0.7-1)^2, over 3.
    assert.ok(Math.abs(cal.brier! - (0.09 + 0.49 + 0.09) / 3) < 1e-12);
    assert.equal(c.calibration.find((x) => x.key === '7d')!.n, 0);
    assert.deepEqual(c.verdicts.map((v) => [v.verdict, v.n]), [['BUY_NOW', 2], ['WAIT', 1]]);
    assert.ok(Math.abs(c.verdicts[1]!.after24h.mean! - -0.03) < 1e-12);
  });

  test('a brief behind a limit order is counted once, on the order, from when it was placed', () => {
    const o = order({ status: 'filled', tradeId: 'tf', closedAt: T0 + DAY, meta: meta({ advice: 'brief', brief: brief({ lower24h: 60 }) }), after: { '24h': 62500 * 0.99 } });
    const t = buy(1, 100, 48000, { orderId: o.id, advice: 'brief', brief: brief({ lower24h: 60 }), after: { '24h': 1 } }, { id: 'tf' });
    const c = scorePaper({ trades: [t], orders: [o], skips: [] });
    const cal = c.calibration.find((x) => x.key === '24h')!;
    assert.equal(cal.n, 1);
    assert.equal(cal.lowerRate, 1);
    assert.equal(c.decisions, 1, 'an order and its fill are one decision');
  });
});

describe('limit orders', () => {
  test('fill rate, saving and what the ones that ran out missed', () => {
    const b: PaperBook = {
      ...EMPTY_BOOK,
      orders: [
        order({ status: 'filled', limitPrice: 48000, marketAtPlacement: 50000, closedAt: T0 + 6 * 3600000 }),
        order({ status: 'expired', marketAtPlacement: 50000, priceAtClose: 52000 }),
        order({ status: 'cancelled' }),
        order({ status: 'open' }),
      ],
    };
    const o = scorePaper(b).orders;
    assert.equal(o.placed, 4);
    assert.equal(o.fillRate, 0.5, 'cancelled and open orders are not counted either way');
    assert.ok(Math.abs(o.saving.mean! - 0.04) < 1e-12);
    assert.equal(o.hoursToFill.mean, 6);
    assert.ok(Math.abs(o.missed.mean! - 0.04) < 1e-12);
    const line = paperHeadlines(scorePaper(b)).find((l) => /limit orders filled/.test(l))!;
    assert.equal(line, '1 of 2 limit orders filled, buying 4.0% below the price when placed. The one that ran out finished with the price 4.0% above where it was placed.');
  });
});

describe('real against paper', () => {
  const real = (time: number, fiat: number, btc: number, over: Partial<Trade> = {}): Trade => ({
    id: `r${time}`, side: 'buy', time, fiat, currency: 'GBP', btc, unitPrice: null, fee: 0, marketPriceUsd: null,
    marketPriceGbp: null, signal: null, note: '', createdAt: time, ...over,
  });

  test('average price paid since paper trading began, fees included', () => {
    const b: PaperBook = { ...EMPTY_BOOK, trades: [buy(1, 100, 40000), buy(2, 100, 60000)] };
    const r = scorePaper(b, [real(T0 - 5 * DAY, 100, 1), real(T0 + 2 * DAY, 100, 0.002), real(T0 + 3 * DAY, 200, 50 / 6250, { currency: 'USD', marketPriceUsd: 62500, marketPriceGbp: 50000 })]).realVsPaper!;
    assert.equal(r.since, T0 + DAY);
    assert.equal(r.real.buys, 2, 'the real buy from before paper trading began is left out');
    // £100 + $200 (= £160 at that day's rate) for 0.002 + 0.008 BTC.
    assert.ok(Math.abs(r.real.avgPrice - 260 / 0.01) < 1e-6);
    assert.ok(Math.abs(r.paper.avgPrice - 200 / (100 / 40000 + 100 / 60000)) < 1e-6);
  });

  test('nothing to compare without both', () => {
    assert.equal(scorePaper({ ...EMPTY_BOOK, trades: [buy(0, 100, 40000)] }, []).realVsPaper, null);
    assert.equal(paperStart(EMPTY_BOOK), null);
  });
});

describe('headlines', () => {
  test('an empty record says nothing', () => {
    assert.deepEqual(paperHeadlines(scorePaper(EMPTY_BOOK)), []);
  });

  test('every finding carries its sample size, and a warning when it is small', () => {
    const p = 40000;
    const b: PaperBook = {
      ...EMPTY_BOOK,
      trades: [
        buy(0, 50, 50000),
        buy(1, 150, 25000, { advice: 'brief', brief: brief({ lower24h: 40 }), after: { '24h': p } }),
      ],
    };
    const lines = paperHeadlines(scorePaper(b));
    assert.ok(lines.some((l) => /cheaper than putting the same £200 in evenly over the same 2 days/.test(l)));
    assert.ok(lines.every((l) => !/—/.test(l)), 'no em dashes');
    const cal = lines.find((l) => /Claude's chances/.test(l))!;
    assert.match(cal, /checked 1 time \(24 hours after each call\)/);
    // One call, said 40% lower, was higher: (0.4 - 0)^2.
    assert.match(cal, /score 0\.160, against 0\.250/);
    assert.match(cal, /better than a coin flip/);
    assert.match(cal, new RegExp(`it takes ${MIN_CALLS} or more`));
  });
});

describe('report for /paper-review', () => {
  test('carries the findings, each grouping and the order figures, with small groups marked', () => {
    const b: PaperBook = {
      trades: [buy(0, 50, 50000, { after: { '7d': 50000 * 1.25 * 1.1 } }), buy(1, 150, 25000, { advice: 'own' })],
      orders: [order({ status: 'expired', priceAtClose: 51000 })],
      skips: [],
    };
    const text = paperReviewReport(scorePaper(b));
    assert.match(text, /^PAPER RECORD SCORECARD/);
    assert.match(text, /Decisions: 3 \(2 buys, 0 sells, 0 decisions not to buy, 1 limit orders\)/);
    assert.match(text, /- Your paper buys got Bitcoin/);
    assert.match(text, /The app: 1 buy, 7d \+10\.0% \(1\), 30d … {2}\[too few\]/);
    assert.match(text, /Limit orders: 1 placed, 0 filled, 1 ran out/);
    assert.ok(!/—/.test(text), 'no em dashes');
  });

  test('an empty record still reads sensibly', () => {
    assert.match(paperReviewReport(scorePaper(EMPTY_BOOK)), /None yet/);
  });
});
