/**
 * Read Bitcoin buys and sells from a Coinbase transaction history export, so
 * past orders do not have to be typed in one by one.
 *
 * Coinbase's CSV starts with a few lines of account details, then a header row
 * such as:
 *
 *   ID,Timestamp,Transaction Type,Asset,Quantity Transacted,Price Currency,
 *   Price at Transaction,Subtotal,Total (inclusive of fees and/or spread),
 *   Fees and/or Spread,Notes
 *
 * Older exports say "Spot Price Currency" and "Spot Price at Transaction" and
 * have no ID column; amounts may carry a currency sign ("£1,234.56"). Columns
 * are found by name, not position, so either layout works. Only BTC buys and
 * sells in pounds or dollars are taken; sends, receives, converts and rewards
 * are counted as skipped, because they are not buys or sells at a price.
 */
import type { Currency } from '../types';
import type { TradeSide } from './journal';

export interface ImportedTrade {
  /** Coinbase's own ID when the export has one, so importing twice adds nothing twice. */
  sourceId: string | null;
  side: TradeSide;
  time: number;
  currency: Currency;
  /** Total paid on a buy, or received on a sell, fees included as Coinbase reports it. */
  fiat: number;
  btc: number;
  unitPrice: number | null;
  fee: number;
}

export interface ImportResult {
  trades: ImportedTrade[];
  /** Rows that were not a BTC buy or sell in pounds or dollars. */
  skipped: number;
  error: string | null;
}

/** Split one CSV line, honouring quotes. */
export const splitCsvLine = (line: string): string[] => {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out.map((c) => c.trim());
};

/** "£1,234.56", "-$12.00", "0.0012" -> number; null when there is no number. */
export const parseMoneyCell = (s: string | undefined): number | null => {
  if (s == null) return null;
  const cleaned = s.replace(/[£$€,\s]/g, '').replace(/^(GBP|USD|EUR)/i, '');
  if (cleaned === '' || !/^[-+]?\d*\.?\d+(e[-+]?\d+)?$/i.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
};

/** "2024-01-05 10:22:33 UTC" or ISO -> ms. */
export const parseCoinbaseTime = (s: string | undefined): number | null => {
  if (!s) return null;
  const iso = s.trim().replace(/\s*UTC$/i, 'Z').replace(/^(\d{4}-\d{2}-\d{2}) (\d)/, '$1T$2');
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
};

const col = (header: string[], ...names: string[]): number => {
  const lower = header.map((h) => h.toLowerCase());
  for (const n of names) {
    const i = lower.findIndex((h) => h === n);
    if (i >= 0) return i;
  }
  for (const n of names) {
    const i = lower.findIndex((h) => h.startsWith(n));
    if (i >= 0) return i;
  }
  return -1;
};

export const parseCoinbaseCsv = (text: string): ImportResult => {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
  const headerAt = lines.findIndex((l) => /timestamp/i.test(l) && /transaction type/i.test(l));
  if (headerAt < 0) {
    return { trades: [], skipped: 0, error: 'This does not look like a Coinbase transaction history: no "Timestamp" and "Transaction Type" header was found.' };
  }
  const header = splitCsvLine(lines[headerAt]!);
  const c = {
    id: col(header, 'id'),
    time: col(header, 'timestamp'),
    type: col(header, 'transaction type'),
    asset: col(header, 'asset'),
    qty: col(header, 'quantity transacted'),
    ccy: col(header, 'price currency', 'spot price currency'),
    price: col(header, 'price at transaction', 'spot price at transaction'),
    total: col(header, 'total (inclusive of fees and/or spread)', 'total'),
    fee: col(header, 'fees and/or spread', 'fees'),
  };
  if ([c.time, c.type, c.asset, c.qty, c.ccy, c.total].some((i) => i < 0)) {
    return { trades: [], skipped: 0, error: 'The header is missing a column the import needs (asset, quantity, currency or total).' };
  }

  const trades: ImportedTrade[] = [];
  let skipped = 0;
  for (const line of lines.slice(headerAt + 1)) {
    const r = splitCsvLine(line);
    const type = (r[c.type] ?? '').toLowerCase();
    const side: TradeSide | null = /\bbuy\b/.test(type) ? 'buy' : /\bsell\b/.test(type) ? 'sell' : null;
    const asset = (r[c.asset] ?? '').toUpperCase();
    const ccy = (r[c.ccy] ?? '').toUpperCase();
    const time = parseCoinbaseTime(r[c.time]);
    const btc = Math.abs(parseMoneyCell(r[c.qty]) ?? NaN);
    const total = Math.abs(parseMoneyCell(r[c.total]) ?? NaN);
    if (!side || asset !== 'BTC' || (ccy !== 'GBP' && ccy !== 'USD') || time == null || !(btc > 0) || !(total > 0)) {
      skipped++;
      continue;
    }
    const price = c.price >= 0 ? parseMoneyCell(r[c.price]) : null;
    const fee = c.fee >= 0 ? Math.abs(parseMoneyCell(r[c.fee]) ?? 0) : 0;
    trades.push({
      sourceId: c.id >= 0 && r[c.id] ? r[c.id]! : null,
      side,
      time,
      currency: ccy as Currency,
      fiat: total,
      btc,
      unitPrice: price != null && price > 0 ? price : null,
      fee,
    });
  }
  return { trades: trades.sort((a, b) => a.time - b.time), skipped, error: null };
};

/**
 * An ID for an imported trade that is the same every time the same row is
 * imported, so a second import of the same file merges instead of doubling.
 */
export const importedTradeId = (t: ImportedTrade): string =>
  t.sourceId ? `cb-${t.sourceId}` : `cb-${t.time.toString(36)}-${t.side}-${Math.round(t.btc * 1e8).toString(36)}`;

/** Already logged by hand: same side, within two minutes, and the same BTC to within 0.5%. */
export const isAlreadyLogged = (t: ImportedTrade, existing: { side: TradeSide; time: number; btc: number; id: string }[]): boolean =>
  existing.some(
    (e) => e.id === importedTradeId(t) || (e.side === t.side && Math.abs(e.time - t.time) <= 2 * 60000 && Math.abs(e.btc - t.btc) <= t.btc * 0.005)
  );
