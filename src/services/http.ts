/**
 * JSON fetching with timeouts, retries, a short cache and in-flight dedup.
 *
 * Kept free of React Native imports so the tests can drive it with a fake
 * `fetch` and check the timing rules directly.
 *
 * Every failure is thrown as a FetchError carrying a short, human-readable
 * reason ("timed out after 8s", "HTTP 403", "could not connect"). The app
 * shows that reason next to the failing source, because "X is unavailable"
 * on its own gives no way to tell a block from an outage from a slow network.
 */

export class FetchError extends Error {
  /** Short reason suitable for showing to the user. */
  readonly reason: string;
  /** HTTP status, when the server answered at all. */
  readonly status?: number;

  constructor(reason: string, status?: number) {
    super(reason);
    this.name = 'FetchError';
    this.reason = reason;
    this.status = status;
  }
}

export interface FetchOptions {
  /** Per-attempt timeout in ms. */
  timeout?: number;
  /** Total attempts, including the first. */
  attempts?: number;
}

const DEFAULT_TIMEOUT = 10000;
const DEFAULT_ATTEMPTS = 3;
const CACHE_TTL = 20000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Short reason for any error thrown while fetching. */
export const describeFetchError = (e: unknown): string => {
  if (e instanceof FetchError) return e.reason;
  const err = e as { name?: string; message?: string } | null;
  if (err?.name === 'AbortError' || err?.name === 'TimeoutError') return 'timed out';
  // React Native reports DNS failures, refused connections, TLS failures and
  // no-network all as a TypeError "Network request failed".
  if (err?.name === 'TypeError') return 'could not connect';
  return err?.message || 'request failed';
};

/**
 * Only failures that can plausibly clear up within a second or two are worth
 * retrying straight away: rate limits, server errors, timeouts and dropped
 * connections. A 403 or 404 will say the same thing on the next attempt, and
 * retrying it only delays the moment the app can say so.
 */
const isRetryable = (e: unknown): boolean => {
  if (!(e instanceof FetchError)) return true;
  if (e.status == null) return !e.reason.startsWith('bad response');
  return e.status === 429 || e.status >= 500;
};

const attemptOnce = async <T>(url: string, timeout: number): Promise<T> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { accept: 'application/json' } });
    if (!res.ok) throw new FetchError(`HTTP ${res.status}`, res.status);
    const text = await res.text();
    try {
      return JSON.parse(text) as T;
    } catch {
      // Typically an HTML block or challenge page served with a 200.
      throw new FetchError('bad response (not JSON)');
    }
  } catch (e) {
    if (e instanceof FetchError) throw e;
    throw new FetchError(controller.signal.aborted ? `timed out after ${Math.round(timeout / 1000)}s` : describeFetchError(e));
  } finally {
    clearTimeout(timer);
  }
};

const doFetch = async <T>(url: string, timeout: number, attempts: number): Promise<T> => {
  let lastErr: unknown = new FetchError('request failed');
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await attemptOnce<T>(url, timeout);
    } catch (e) {
      lastErr = e;
      if (!isRetryable(e) || attempt === attempts - 1) break;
      const status = e instanceof FetchError ? e.status : undefined;
      await sleep(status === 429 ? 1200 * (attempt + 1) : 500 * (attempt + 1));
    }
  }
  throw lastErr;
};

// Short-lived cache + in-flight dedup so duplicate requests for the same URL
// (e.g. the Dashboard refresh and the Chart screen both wanting 1D OHLC) reuse
// a single network call instead of hitting the API twice.
const cache = new Map<string, { ts: number; data: unknown }>();
const inflight = new Map<string, Promise<unknown>>();

export const fetchJSON = async <T>(url: string, opts: FetchOptions = {}): Promise<T> => {
  const cached = cache.get(url);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.data as T;

  const existing = inflight.get(url);
  if (existing) return existing as Promise<T>;

  const p = doFetch<T>(url, opts.timeout ?? DEFAULT_TIMEOUT, opts.attempts ?? DEFAULT_ATTEMPTS)
    .then((data) => {
      cache.set(url, { ts: Date.now(), data });
      return data;
    })
    .finally(() => {
      inflight.delete(url);
    });
  inflight.set(url, p);
  return p;
};

/** Test hook: forget cached responses. */
export const clearHttpCache = (): void => {
  cache.clear();
  inflight.clear();
};
