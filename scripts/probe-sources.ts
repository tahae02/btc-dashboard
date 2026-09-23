/**
 * Check every external data source the app depends on.
 *
 *   yarn probe
 *
 * Calls exactly the URLs the app ships with (from src/services/endpoints) and
 * checks each response contains the field the app actually reads, since a
 * server returning 200 with an error body is still a failure as far as the app
 * is concerned.
 *
 * Useful when the app says a source is unavailable: run this on the same
 * network as the phone and it tells you whether the provider is down, rate
 * limiting, blocking, or has changed its response shape.
 *
 * CI runs it too, but read those results with care: GitHub's runners sit in
 * cloud IP ranges that some free APIs throttle or block, so a CI failure does
 * not prove a phone on home broadband would fail, and vice versa.
 */
import { SOURCE_CHECKS } from '../src/services/endpoints';

const TIMEOUT_MS = 15000;

interface Result {
  label: string;
  essential: boolean;
  ok: boolean;
  status: string;
  ms: number;
  detail: string;
}

const probe = async (label: string, url: string, essential: boolean, validate: (b: any) => string | null): Promise<Result> => {
  const started = Date.now();
  try {
    const res = await fetch(url, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const ms = Date.now() - started;
    const text = await res.text();
    if (!res.ok) {
      return { label, essential, ok: false, status: `HTTP ${res.status}`, ms, detail: text.slice(0, 160).replace(/\s+/g, ' ') };
    }
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      return { label, essential, ok: false, status: 'bad JSON', ms, detail: text.slice(0, 160).replace(/\s+/g, ' ') };
    }
    const problem = validate(body);
    return problem
      ? { label, essential, ok: false, status: 'bad shape', ms, detail: problem }
      : { label, essential, ok: true, status: `HTTP ${res.status}`, ms, detail: '' };
  } catch (e) {
    const err = e as Error & { cause?: { code?: string } };
    const reason = err.name === 'TimeoutError' ? `timed out after ${TIMEOUT_MS / 1000}s` : err.cause?.code ?? err.message;
    return { label, essential, ok: false, status: 'no response', ms: Date.now() - started, detail: reason };
  }
};

const main = async (): Promise<void> => {
  console.log(`Probing ${SOURCE_CHECKS.length} data sources...\n`);
  const results = await Promise.all(SOURCE_CHECKS.map((s) => probe(s.label, s.url, s.essential, s.validate)));

  const w = Math.max(...results.map((r) => r.label.length));
  for (const r of results) {
    const mark = r.ok ? 'OK  ' : 'FAIL';
    console.log(`${mark}  ${r.label.padEnd(w)}  ${r.status.padEnd(12)} ${String(r.ms).padStart(5)}ms${r.detail ? `  ${r.detail}` : ''}`);
  }

  const failed = results.filter((r) => !r.ok);
  console.log('');
  if (failed.length === 0) {
    console.log('All sources responded with the data the app expects.');
    return;
  }
  const essentialDown = failed.some((r) => r.essential);
  console.log(
    essentialDown
      ? 'An ESSENTIAL source is failing, so the app cannot show prices or signals.'
      : 'Only non-essential sources are failing. The app still works, with those panels blank.'
  );
  process.exitCode = 1;
};

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
