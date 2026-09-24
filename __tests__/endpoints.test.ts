import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { ENDPOINTS, SOURCE_CHECKS, MEMPOOL_BASE, KRAKEN_INTERVAL } from '../src/services/endpoints';

describe('endpoints', () => {
  /**
   * REGRESSION TEST. The previous code built these with
   * `new URL('/v1/fees/recommended', 'https://mempool.space/api')`, and under
   * the standard URL rules a leading `/` replaces the base's path, silently
   * dropping `/api`. Whether that bit depended on the runtime's URL
   * implementation, so every URL must now carry its full path explicitly.
   */
  test('mempool.space URLs keep their /api prefix', () => {
    for (const url of [ENDPOINTS.hashrate, ENDPOINTS.difficulty, ENDPOINTS.mempool, ENDPOINTS.fees]) {
      assert.ok(url.startsWith(`${MEMPOOL_BASE}/`), `${url} lost the /api prefix`);
    }
  });

  test('the standard URL constructor really would have dropped /api', () => {
    // Documents why plain concatenation is used, and fails loudly if the
    // platform's URL semantics ever change.
    assert.equal(new URL('/v1/fees/recommended', MEMPOOL_BASE).pathname, '/v1/fees/recommended');
  });

  test('every URL is absolute https with no doubled slashes in the path', () => {
    const urls = [
      ENDPOINTS.ticker, ENDPOINTS.dominance, ENDPOINTS.fearGreed,
      ENDPOINTS.hashrate, ENDPOINTS.difficulty, ENDPOINTS.mempool, ENDPOINTS.fees,
      ...(['1H', '4H', '1D', '1W'] as const).map((tf) => ENDPOINTS.ohlc(tf)),
    ];
    for (const url of urls) {
      const u = new URL(url);
      assert.equal(u.protocol, 'https:', url);
      assert.ok(!u.pathname.includes('//'), `${url} has a doubled slash`);
    }
  });

  test('OHLC requests the interval each timeframe needs', () => {
    assert.match(ENDPOINTS.ohlc('1D'), /interval=1440$/);
    assert.match(ENDPOINTS.ohlc('1H'), /interval=60$/);
    assert.equal(KRAKEN_INTERVAL['1W'], 7 * 24 * 60);
  });
});

describe('source checks', () => {
  test('accept a response shaped the way the app reads it', () => {
    const byKey = Object.fromEntries(SOURCE_CHECKS.map((s) => [s.key, s]));
    assert.equal(byKey.dominance!.validate({ bitcoin_dominance_percentage: 57.2 }), null);
    assert.equal(byKey.fearGreed!.validate({ data: [{ value: '40' }] }), null);
    assert.equal(byKey.fees!.validate({ fastestFee: 3 }), null);
    assert.equal(byKey.ticker!.validate({ error: [], result: { XXBTZUSD: {} } }), null);
  });

  test('reject a 200 whose body is an error or has changed shape', () => {
    const byKey = Object.fromEntries(SOURCE_CHECKS.map((s) => [s.key, s]));
    assert.notEqual(byKey.dominance!.validate({ error: 'rate limited' }), null);
    assert.notEqual(byKey.fearGreed!.validate({ metadata: { error: 'x' } }), null);
    assert.notEqual(byKey.ticker!.validate({ error: ['EGeneral:Too many requests'] }), null);
    assert.notEqual(byKey.ohlc!.validate({ error: [], result: { XXBTZUSD: [[1, 2]] } }), null);
  });

  test('price and history are marked essential, the rest are not', () => {
    const essential = SOURCE_CHECKS.filter((s) => s.essential).map((s) => s.key).sort();
    assert.deepEqual(essential, ['ohlc', 'ticker']);
  });
});
