import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseCoinbaseCsv, splitCsvLine, parseMoneyCell, parseCoinbaseTime, importedTradeId, isAlreadyLogged } from '../src/services/coinbaseImport';

const NEW_FORMAT = `You can use this transaction report to inform your likely tax obligations.
User,someone@example.com,abc123
Transactions
ID,Timestamp,Transaction Type,Asset,Quantity Transacted,Price Currency,Price at Transaction,Subtotal,Total (inclusive of fees and/or spread),Fees and/or Spread,Notes
65a1,2025-01-05 10:22:33 UTC,Buy,BTC,0.0063,GBP,"£78,600.00",£495.18,£500.00,£4.82,Bought 0.0063 BTC
65a2,2025-02-01 08:00:00 UTC,Advanced Trade Sell,BTC,-0.002,GBP,"£80,000.00",£160.00,£159.04,£0.96,
65a3,2025-02-03 09:00:00 UTC,Send,BTC,-0.001,GBP,"£80,000.00",£80.00,£80.00,£0.00,To a wallet
65a4,2025-02-04 09:00:00 UTC,Buy,ETH,0.1,GBP,"£2,500.00",£250.00,£252.00,£2.00,
65a5,2025-02-05 09:00:00 UTC,Buy,BTC,0.001,EUR,"€90,000.00",€90.00,€91.00,€1.00,
`;

const OLD_FORMAT = `Timestamp,Transaction Type,Asset,Quantity Transacted,Spot Price Currency,Spot Price at Transaction,Subtotal,Total (inclusive of fees and/or spread),Fees and/or Spread,Notes
2023-06-01T12:00:00Z,Buy,BTC,0.01,USD,27000,270,274.99,4.99,`;

describe('Coinbase import', () => {
  test('reads BTC buys and sells in pounds, skipping everything else', () => {
    const r = parseCoinbaseCsv(NEW_FORMAT);
    assert.equal(r.error, null);
    assert.equal(r.trades.length, 2);
    assert.equal(r.skipped, 3, 'a send, an ETH buy and a euro buy');
    const [buy, sell] = r.trades;
    assert.deepEqual(
      { side: buy!.side, fiat: buy!.fiat, btc: buy!.btc, fee: buy!.fee, unitPrice: buy!.unitPrice, currency: buy!.currency, sourceId: buy!.sourceId },
      { side: 'buy', fiat: 500, btc: 0.0063, fee: 4.82, unitPrice: 78600, currency: 'GBP', sourceId: '65a1' }
    );
    assert.equal(buy!.time, Date.UTC(2025, 0, 5, 10, 22, 33));
    assert.equal(sell!.side, 'sell');
    assert.equal(sell!.btc, 0.002, 'the minus sign on a sell is dropped');
    assert.equal(sell!.fiat, 159.04, 'a sale is what was received after the fee');
  });

  test('reads the older layout without an ID column', () => {
    const r = parseCoinbaseCsv(OLD_FORMAT);
    assert.equal(r.trades.length, 1);
    assert.equal(r.trades[0]!.currency, 'USD');
    assert.equal(r.trades[0]!.sourceId, null);
    assert.equal(r.trades[0]!.fiat, 274.99);
  });

  test('says plainly when the text is not a Coinbase export', () => {
    const r = parseCoinbaseCsv('{"app":"btc-analyst"}');
    assert.ok(r.error);
    assert.equal(r.trades.length, 0);
  });

  test('the same row always gets the same ID, so importing twice adds nothing', () => {
    const a = parseCoinbaseCsv(NEW_FORMAT).trades[0]!;
    const b = parseCoinbaseCsv(NEW_FORMAT).trades[0]!;
    assert.equal(importedTradeId(a), importedTradeId(b));
    assert.equal(importedTradeId(a), 'cb-65a1');
  });

  test('spots a trade already logged by hand', () => {
    const t = parseCoinbaseCsv(NEW_FORMAT).trades[0]!;
    assert.equal(isAlreadyLogged(t, [{ id: 'x', side: 'buy', time: t.time + 60000, btc: 0.00631 }]), true);
    assert.equal(isAlreadyLogged(t, [{ id: 'x', side: 'buy', time: t.time + 600000, btc: 0.0063 }]), false);
    assert.equal(isAlreadyLogged(t, [{ id: 'x', side: 'sell', time: t.time, btc: 0.0063 }]), false);
  });

  test('cell helpers', () => {
    assert.deepEqual(splitCsvLine('a,"b,c","d ""e"""'), ['a', 'b,c', 'd "e"']);
    assert.equal(parseMoneyCell('£1,234.56'), 1234.56);
    assert.equal(parseMoneyCell('-$12.00'), -12);
    assert.equal(parseMoneyCell(''), null);
    assert.equal(parseCoinbaseTime('2025-01-05 10:22:33 UTC'), Date.UTC(2025, 0, 5, 10, 22, 33));
  });
});
