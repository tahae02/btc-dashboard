import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { fetchJSON, clearHttpCache, describeFetchError, FetchError } from '../src/services/http';

type Handler = (url: string, init: RequestInit) => Promise<Response>;

const realFetch = globalThis.fetch;
let calls = 0;
const useFetch = (handler: Handler) => {
  calls = 0;
  globalThis.fetch = ((url: string, init: RequestInit) => {
    calls++;
    return handler(url, init);
  }) as typeof fetch;
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** A request that never answers, but honours abort like a real fetch. */
const hang: Handler = (_url, init) =>
  new Promise((_resolve, reject) => {
    init.signal?.addEventListener('abort', () => reject(Object.assign(new Error('Aborted'), { name: 'AbortError' })));
  });

const reasonOf = async (p: Promise<unknown>): Promise<string> => {
  try {
    await p;
  } catch (e) {
    return describeFetchError(e);
  }
  throw new Error('expected the request to fail');
};

describe('fetchJSON', () => {
  beforeEach(() => clearHttpCache());
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  test('returns parsed JSON', async () => {
    useFetch(async () => json({ ok: 1 }));
    assert.deepEqual(await fetchJSON('https://x.test/a'), { ok: 1 });
  });

  /**
   * REGRESSION TEST. A 403 was retried three times with backoff before the
   * app could report it, although a block does not lift between attempts.
   */
  test('does not retry a 403, and reports the status', async () => {
    useFetch(async () => json({}, 403));
    assert.equal(await reasonOf(fetchJSON('https://x.test/b', { attempts: 3 })), 'HTTP 403');
    assert.equal(calls, 1);
  });

  test('retries a 503, then succeeds', async () => {
    let n = 0;
    useFetch(async () => (n++ === 0 ? json({}, 503) : json({ ok: 2 })));
    assert.deepEqual(await fetchJSON('https://x.test/c', { attempts: 2 }), { ok: 2 });
    assert.equal(calls, 2);
  });

  test('a hanging request fails with a timeout reason, bounded by timeout x attempts', async () => {
    useFetch(hang);
    const started = Date.now();
    const reason = await reasonOf(fetchJSON('https://x.test/d', { timeout: 60, attempts: 2 }));
    const took = Date.now() - started;
    assert.match(reason, /^timed out/);
    assert.equal(calls, 2);
    // 2 x 60ms timeouts + one 500ms backoff, with slack for a slow runner.
    assert.ok(took < 1500, `took ${took}ms`);
  });

  test('a 200 carrying an HTML page is a failure, not a crash', async () => {
    useFetch(async () => new Response('<html>Just a moment...</html>', { status: 200 }));
    assert.equal(await reasonOf(fetchJSON('https://x.test/e', { attempts: 3 })), 'bad response (not JSON)');
    assert.equal(calls, 1, 'a challenge page will not change on retry');
  });

  test('a connection failure is reported as such', async () => {
    useFetch(async () => {
      throw new TypeError('Network request failed');
    });
    assert.equal(await reasonOf(fetchJSON('https://x.test/f', { attempts: 1 })), 'could not connect');
  });

  test('concurrent requests for one URL share a single network call', async () => {
    useFetch(async () => json({ ok: 3 }));
    const [a, b] = await Promise.all([fetchJSON('https://x.test/g'), fetchJSON('https://x.test/g')]);
    assert.deepEqual(a, b);
    assert.equal(calls, 1);
  });
});

describe('describeFetchError', () => {
  test('passes a FetchError reason through', () => {
    assert.equal(describeFetchError(new FetchError('HTTP 429', 429)), 'HTTP 429');
  });
  test('never returns an empty string', () => {
    assert.ok(describeFetchError(null).length > 0);
    assert.ok(describeFetchError(new Error('')).length > 0);
  });
});
