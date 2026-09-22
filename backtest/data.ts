/**
 * Historical candle sources for the backtester.
 *
 * Three ways to get data, in order of preference:
 *
 *   1. `yarn backtest:fetch`  downloads real daily BTC/USD history to
 *      backtest/data/btc-daily.csv. Do this before trusting any number.
 *   2. `--csv <path>`         uses a CSV you supply (time,open,high,low,close,volume).
 *   3. bundled synthetic      a deterministic BTC-shaped series so the harness
 *      and the tests run offline. USEFUL FOR CHECKING THE PLUMBING, USELESS
 *      FOR JUDGING A STRATEGY. Every report says which source it used.
 */
import * as fs from 'fs';
import * as path from 'path';
import type { OHLCVCandle } from '../src/types';
import { normaliseCandles } from '../src/services/candles';

export type DataSource = 'real-csv' | 'synthetic';

export interface Dataset {
  candles: OHLCVCandle[];
  source: DataSource;
  label: string;
}

/**
 * Resolved from the working directory rather than `import.meta.dirname`, so
 * this file stays valid under the app's CommonJS-flavoured tsconfig. The yarn
 * scripts always run from the repo root; if you invoke the runner by hand from
 * somewhere else, pass `--csv` explicitly.
 */
const repoRoot = (): string => {
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    if (fs.existsSync(path.join(dir, 'package.json'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
};

export const DATA_DIR = path.join(repoRoot(), 'backtest', 'data');
export const REAL_CSV = path.join(DATA_DIR, 'btc-daily.csv');

// ===== CSV =====

export const parseCsv = (text: string): OHLCVCandle[] => {
  const out: OHLCVCandle[] = [];
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  for (const line of lines) {
    const parts = line.split(',');
    if (parts.length < 5) continue;
    // Accept either an epoch (s or ms) or an ISO date in column 0.
    const rawTime = (parts[0] ?? '').trim();
    if (!rawTime || /^(time|date|timestamp)$/i.test(rawTime)) continue;
    let time: number;
    if (/^\d+$/.test(rawTime)) {
      const n = Number(rawTime);
      time = n > 1e12 ? n : n * 1000;
    } else {
      time = Date.parse(rawTime);
    }
    if (!Number.isFinite(time)) continue;
    const [open, high, low, close] = parts.slice(1, 5).map((p) => Number(p));
    const volume = parts[5] != null ? Number(parts[5]) : 0;
    if (![open, high, low, close].every((n) => Number.isFinite(n) && n > 0)) continue;
    out.push({ time, open, high, low, close, volume: Number.isFinite(volume) ? volume : 0 });
  }
  return normaliseCandles(out);
};

export const toCsv = (candles: OHLCVCandle[]): string =>
  'time,open,high,low,close,volume\n' +
  candles.map((c) => [c.time, c.open, c.high, c.low, c.close, c.volume ?? 0].join(',')).join('\n');

export const loadCsvFile = (file: string): OHLCVCandle[] => parseCsv(fs.readFileSync(file, 'utf8'));

// ===== Synthetic fallback =====

/**
 * A deterministic, BTC-shaped daily series.
 *
 * Built as a regime-switching model rather than a plain random walk, because
 * a plain random walk would flatter any trend-following rule: real Bitcoin has
 * multi-month trends, 70-85% drawdowns and long flat stretches, and a strategy
 * must be judged against that shape. Parameters are hand-set to resemble
 * Bitcoin's historical behaviour; they are NOT fitted to it.
 *
 * Same seed always yields the same series, so tests and reports are stable.
 */
export const generateSyntheticSeries = (days = 2600, seed = 20240117, start = 600): OHLCVCandle[] => {
  let s = seed >>> 0;
  const rnd = (): number => {
    // xorshift32: small, deterministic, adequate for shaping test data.
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 0xffffffff;
  };
  const gauss = (): number => {
    let u = 0;
    let v = 0;
    while (u === 0) u = rnd();
    while (v === 0) v = rnd();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };

  // drift per day, daily vol, expected regime length in days
  const REGIMES = [
    { name: 'bull',     drift:  0.0042, vol: 0.038, mean: 300 },
    { name: 'blowoff',  drift:  0.0115, vol: 0.060, mean: 60 },
    { name: 'crash',    drift: -0.0125, vol: 0.070, mean: 70 },
    { name: 'bear',     drift: -0.0022, vol: 0.040, mean: 260 },
    { name: 'chop',     drift:  0.0004, vol: 0.030, mean: 200 },
  ];
  // Rough historical ordering: accumulation -> bull -> blowoff -> crash -> bear -> chop
  const ORDER = [4, 0, 1, 2, 3, 4, 0, 1, 2, 3];

  const candles: OHLCVCandle[] = [];
  let price = start;
  let day = 0;
  let orderIdx = 0;
  const startTime = Date.UTC(2017, 0, 1);

  while (day < days) {
    const r = REGIMES[ORDER[orderIdx % ORDER.length] ?? 4]!;
    const length = Math.max(25, Math.round(r.mean * (0.6 + 0.8 * rnd())));
    for (let i = 0; i < length && day < days; i++, day++) {
      const open = price;
      const ret = r.drift + r.vol * gauss();
      price = Math.max(price * Math.exp(ret), 1);
      const close = price;
      const wick = Math.abs(gauss()) * r.vol * close * 0.45;
      candles.push({
        time: startTime + day * 86400000,
        open,
        high: Math.max(open, close) + wick,
        low: Math.max(Math.min(open, close) - wick, 0.5),
        close,
        // Volume rises with volatility and on down days, as it does in practice.
        volume: Math.round(1000 * (1 + 3 * Math.abs(ret) / r.vol) * (ret < 0 ? 1.25 : 1)),
      });
    }
    orderIdx++;
  }
  return candles;
};

// ===== Entry point =====

export const loadDataset = (csvPath?: string): Dataset => {
  const explicit = csvPath ? path.resolve(csvPath) : null;
  if (explicit) {
    if (!fs.existsSync(explicit)) throw new Error(`CSV not found: ${explicit}`);
    const candles = loadCsvFile(explicit);
    if (candles.length < 250) throw new Error(`Only ${candles.length} usable rows in ${explicit}; need 250+.`);
    return { candles, source: 'real-csv', label: path.basename(explicit) };
  }
  if (fs.existsSync(REAL_CSV)) {
    const candles = loadCsvFile(REAL_CSV);
    if (candles.length >= 250) {
      return { candles, source: 'real-csv', label: 'btc-daily.csv' };
    }
  }
  return {
    candles: generateSyntheticSeries(),
    source: 'synthetic',
    label: 'synthetic BTC-shaped series (seed 20240117)',
  };
};

export const describeDataset = (d: Dataset): string => {
  const first = d.candles[0];
  const last = d.candles[d.candles.length - 1];
  const fmt = (t: number) => new Date(t).toISOString().slice(0, 10);
  return `${d.label} — ${d.candles.length} daily bars, ${fmt(first!.time)} to ${fmt(last!.time)}`;
};
