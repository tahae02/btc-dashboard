/**
 * Download real daily BTC/USD history into backtest/data/btc-daily.csv.
 *
 *   yarn backtest:fetch              as far back as the source allows
 *   yarn backtest:fetch --days 1500
 *
 * Primary source is CryptoCompare's free daily endpoint, which needs no key
 * and pages backwards 2,000 bars at a time. Kraken is the fallback, but its
 * OHLC endpoint caps at 720 bars, so it gives about two years rather than ten.
 *
 * Run this before trusting any backtest number. The bundled synthetic series
 * exists only so the harness runs offline.
 */
import * as fs from 'fs';
import * as path from 'path';
import type { OHLCVCandle } from '../src/types';
import { normaliseCandles } from '../src/services/candles';
import { toCsv, DATA_DIR, REAL_CSV } from './data';

const CRYPTOCOMPARE = 'https://min-api.cryptocompare.com/data/v2/histoday';
const KRAKEN = 'https://api.kraken.com/0/public/OHLC';

const arg = (flag: string): string | undefined => {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

const getJson = async (url: string): Promise<any> => {
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).host}`);
  return res.json();
};

const fetchCryptoCompare = async (targetDays: number): Promise<OHLCVCandle[]> => {
  const all: OHLCVCandle[] = [];
  let toTs = Math.floor(Date.now() / 1000);

  while (all.length < targetDays) {
    const url = `${CRYPTOCOMPARE}?fsym=BTC&tsym=USD&limit=2000&toTs=${toTs}`;
    const json = await getJson(url);
    if (json?.Response === 'Error') throw new Error(json?.Message ?? 'CryptoCompare error');
    const rows: any[] = json?.Data?.Data ?? [];
    const usable = rows.filter((r) => Number(r?.close) > 0);
    if (usable.length === 0) break;

    for (const r of usable) {
      all.push({
        time: Number(r.time) * 1000,
        open: Number(r.open),
        high: Number(r.high),
        low: Number(r.low),
        close: Number(r.close),
        volume: Number(r.volumeto ?? r.volumefrom ?? 0),
      });
    }

    const earliest = Math.min(...usable.map((r) => Number(r.time)));
    if (!Number.isFinite(earliest) || earliest >= toTs) break;
    toTs = earliest - 86400;
    process.stdout.write(`\r  fetched ${all.length} bars…`);
  }
  process.stdout.write('\n');
  return normaliseCandles(all);
};

const fetchKraken = async (): Promise<OHLCVCandle[]> => {
  const json = await getJson(`${KRAKEN}?pair=XBTUSD&interval=1440`);
  const result = json?.result ?? {};
  const key = Object.keys(result).find((k) => k !== 'last');
  const rows: any[][] = key ? result[key] : [];
  return normaliseCandles(
    rows.map((c) => ({
      time: Number(c[0]) * 1000,
      open: Number(c[1]),
      high: Number(c[2]),
      low: Number(c[3]),
      close: Number(c[4]),
      volume: Number(c[6]),
    }))
  );
};

const main = async (): Promise<void> => {
  const targetDays = Number(arg('--days') ?? 4000);
  let candles: OHLCVCandle[] = [];

  try {
    console.log('Fetching daily BTC/USD from CryptoCompare…');
    candles = await fetchCryptoCompare(targetDays);
  } catch (e) {
    console.warn(`  CryptoCompare failed: ${(e as Error).message}`);
    console.log('Falling back to Kraken (about 2 years of daily bars)…');
    try {
      candles = await fetchKraken();
    } catch (e2) {
      console.error(`  Kraken failed too: ${(e2 as Error).message}`);
    }
  }

  if (candles.length < 250) {
    console.error(
      `\nOnly got ${candles.length} bars, which is not enough to backtest.\n` +
        'Check your connection, or download a daily BTC/USD OHLCV CSV manually and run:\n' +
        '  yarn backtest --csv /path/to/your.csv\n' +
        'The CSV needs columns: time,open,high,low,close,volume (time as epoch or ISO date).'
    );
    process.exitCode = 1;
    return;
  }

  // Drop today's still-forming bar so the file contains closed days only.
  const todayStart = new Date().setUTCHours(0, 0, 0, 0);
  const closed = candles.filter((c) => c.time < todayStart);

  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(REAL_CSV, toCsv(closed));

  const fmt = (t: number) => new Date(t).toISOString().slice(0, 10);
  console.log(
    `\nSaved ${closed.length} closed daily bars to ${path.relative(process.cwd(), REAL_CSV)}\n` +
      `  ${fmt(closed[0]!.time)} to ${fmt(closed[closed.length - 1]!.time)}\n\n` +
      'Now run:  yarn backtest'
  );
};

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
