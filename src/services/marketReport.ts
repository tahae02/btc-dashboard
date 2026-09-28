/**
 * The plain-text market snapshot printed by `yarn snapshot`.
 *
 * Pure, so it can be tested against synthetic data. It takes what the app's
 * own fetchers returned and runs it through the app's own code: candles are
 * trimmed with dropIncompleteCandle, indicators come from computeIndicators,
 * the layer scores from detectRegime / computeStretch / computeMomentum, and
 * the advice from computeSignal and describeMarket. Nothing here calculates a
 * market number of its own; it only formats, converts USD to GBP at the rate
 * implied by the live price (as the Portfolio tab does), and states the fixed
 * thresholds the engine exports.
 */
import type {
  Currency,
  FearGreedData,
  Indicators,
  OHLCVCandle,
  OnChainData,
  PriceData,
  Settings,
  SignalConfig,
  SignalResult,
  Timeframe,
} from '../types';
import { computeIndicators } from './indicators';
import { dropIncompleteCandle, TIMEFRAME_MS } from './candles';
import {
  computeSignal,
  computeStretch,
  computeMomentum,
  configFromSettings,
  ACTION_LABEL,
  ACTION_TIERS,
  STRETCH_RANGES,
  MOMENTUM_RANGES,
  READING_DEADBAND,
  REGIME_READING_DEADBAND,
} from './signalEngine';
import { describeMarket, ACTION_PLAIN } from './plainEnglish';
import { isFearGreedFresh } from './snapshot';
import { ENDPOINTS } from './endpoints';

export const REPORT_TIMEFRAMES: Timeframe[] = ['1H', '4H', '1D', '1W'];

/** A data source and what happened when it was fetched. */
export interface SourceOutcome {
  label: string;
  /** Host the request went to, for the "how to fix" advice. */
  host: string;
  /** null when it worked. */
  error: string | null;
}

export interface ReportInput {
  now: number;
  settings: Settings;
  price: PriceData | null;
  candles: Partial<Record<Timeframe, OHLCVCandle[]>>;
  fearGreed: FearGreedData | null;
  btcDominance: number | null;
  onChain: OnChainData | null;
  sources: SourceOutcome[];
  /** Whether requests go through an egress proxy (a Claude Code cloud session). */
  proxied?: boolean;
}

/** One timeframe run through the app's pipeline. */
export interface TimeframeAnalysis {
  timeframe: Timeframe;
  /** Candles as fetched, including the still-forming bar. */
  rawCount: number;
  closed: OHLCVCandle[];
  indicators: Indicators;
  /** Null without a live price or with under 200 bars (the app's own cut-off). */
  signal: SignalResult | null;
}

/** The app shows a signal only with 200+ bars; see app/tabs/signals.tsx. */
export const MIN_BARS_FOR_SIGNAL = 200;

export const analyseTimeframe = (
  timeframe: Timeframe,
  candles: OHLCVCandle[],
  livePrice: number,
  fearGreed: number | null,
  config: SignalConfig,
  now: number
): TimeframeAnalysis => {
  const closed = dropIncompleteCandle(candles, timeframe, now);
  const indicators = computeIndicators(closed);
  const signal =
    livePrice > 0 && candles.length >= MIN_BARS_FOR_SIGNAL
      ? computeSignal({ indicators, currentPrice: livePrice, fearGreed, config })
      : null;
  return { timeframe, rawCount: candles.length, closed, indicators, signal };
};

// ===== Formatting =====

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Sun 28 Sep 2026, 09:31 BST", always in UK time whatever the machine's zone. */
export const formatUkTime = (ms: number): string => {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/London',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
      timeZoneName: 'short',
    })
      .formatToParts(new Date(ms))
      .map((p) => [p.type, p.value])
  );
  // weekday from the parts is locale text; derive it from the London date instead.
  const y = Number(parts.year);
  const m = Number(parts.month);
  const d = Number(parts.day);
  const dow = DAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  // en-GB names the zone "GMT" in winter and "BST" in summer; older ICU says "GMT+1".
  const zone = parts.timeZoneName === 'GMT+1' ? 'BST' : parts.timeZoneName;
  return `${dow} ${d} ${MONTHS[m - 1]} ${y}, ${parts.hour}:${parts.minute} ${zone}`;
};

const group = (s: string): string => s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');

/** Money with thousands separators; whole units at or above 1,000. */
const money = (n: number | null | undefined, c: Currency): string => {
  if (n == null || !Number.isFinite(n)) return 'n/a';
  const sym = c === 'GBP' ? '£' : '$';
  const abs = Math.abs(n);
  const body = abs >= 1000 ? group(abs.toFixed(0)) : abs.toFixed(2);
  return `${n < 0 ? '-' : ''}${sym}${body}`;
};

/** Large amounts as "$1.23bn" / "$1.87tn". */
const bigMoney = (n: number | null | undefined): string => {
  if (n == null || !Number.isFinite(n) || n <= 0) return 'n/a';
  if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}tn`;
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}bn`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}m`;
  return money(n, 'USD');
};

const num = (n: number | null | undefined, dp = 1): string =>
  n == null || !Number.isFinite(n) ? 'n/a' : n.toFixed(dp);

const signed = (n: number | null | undefined, dp = 1, suffix = ''): string =>
  n == null || !Number.isFinite(n) ? 'n/a' : `${n > 0 ? '+' : ''}${n.toFixed(dp)}${suffix}`;

/** Fraction -> "+12%". */
const pctOf = (fraction: number, dp = 0): string => signed(fraction * 100, dp, '%');

const pad = (s: string, w: number): string => (s.length >= w ? s : s + ' '.repeat(w - s.length));

const hostOf = (url: string): string => url.replace(/^https?:\/\//, '').split('/')[0] ?? url;

export const SOURCE_HOSTS = {
  kraken: hostOf(ENDPOINTS.ticker),
  paprika: hostOf(ENDPOINTS.dominance),
  alternative: hostOf(ENDPOINTS.fearGreed),
  mempool: hostOf(ENDPOINTS.fees),
} as const;

const isRefusal = (e: string | null): boolean => /HTTP 40[37]/.test(e ?? '');

/**
 * What to do about a failed source. None of the app's sources need an API
 * key, so a failure is always the network, the provider, or a block.
 */
export const fixFor = (s: SourceOutcome): string => {
  const e = s.error ?? '';
  if (isRefusal(e)) {
    return `${s.host} refused the request (${e}). Usually a firewall, VPN, ad or DNS blocker, or the provider blocking this IP range. Try another network, or run \`yarn probe\` for detail.`;
  }
  if (/HTTP 429/.test(e)) return `${s.host} is rate limiting (${e}). Wait a minute and run it again.`;
  if (/HTTP 5\d\d/.test(e)) return `${s.host} is having an outage (${e}). Try again later.`;
  if (/timed out|could not connect|fetch failed|ENOTFOUND|ECONN/.test(e)) {
    return `${s.host} could not be reached (${e}). Check the connection, DNS or any blocker; \`yarn probe\` tests each source on its own.`;
  }
  return `${s.host} failed (${e}). Run \`yarn probe\` to see what it returned.`;
};

// ===== Sections =====

const statusSection = (input: ReportInput): string[] => {
  const out = ['DATA SOURCES (no API keys needed)'];
  const w = Math.max(...input.sources.map((s) => s.label.length));
  for (const s of input.sources) {
    out.push(s.error ? `  FAIL ${pad(s.label, w)}  ${s.error}` : `  OK   ${s.label}`);
  }
  const failed = input.sources.filter((s) => s.error);
  if (failed.length) {
    out.push('', '  How to fix:');
    const fixes = new Set<string>();
    // Behind an egress proxy (a Claude Code cloud session), a 403 is almost
    // always the proxy's allowlist rather than the provider, and one setting
    // fixes every host at once.
    const blocked = input.proxied ? [...new Set(failed.filter((s) => isRefusal(s.error)).map((s) => s.host))] : [];
    if (blocked.length) {
      fixes.add(
        `Blocked by this machine's egress proxy allowlist: ${blocked.join(', ')}. In a Claude Code cloud session, open the ` +
          'environment menu in the session title bar > Edit > Network access, and add those hosts to the allowed domains ' +
          '(or choose a broader access level).'
      );
    }
    for (const s of failed) if (!blocked.includes(s.host)) fixes.add(fixFor(s));
    for (const f of fixes) out.push(`  - ${f}`);
  }
  return out;
};

const priceSection = (p: PriceData | null, dominance: number | null): string[] => {
  if (!p) return ['PRICE', '  Unavailable: the live price did not load, so nothing below uses a live price.'];
  const fx = p.price > 0 && p.price_gbp > 0 ? p.price_gbp / p.price : null;
  return [
    'PRICE (Kraken)',
    `  BTC/USD ${money(p.price, 'USD')}    BTC/GBP ${p.price_gbp > 0 ? money(p.price_gbp, 'GBP') : 'n/a'}` +
      (fx ? `    (implied GBP/USD ${(1 / fx).toFixed(4)})` : ''),
    `  24h change ${signed(p.change_24h_pct, 2, '%')} (${p.change_24h >= 0 ? '+' : ''}${money(p.change_24h, 'USD')})`,
    `  24h high ${money(p.high_24h, 'USD')}${fx ? ` / ${money(p.high_24h * fx, 'GBP')}` : ''}    ` +
      `24h low ${money(p.low_24h, 'USD')}${fx ? ` / ${money(p.low_24h * fx, 'GBP')}` : ''}`,
    `  24h volume ${bigMoney(p.volume_24h)}    Market cap ${bigMoney(p.market_cap)}    BTC dominance ${dominance != null ? `${dominance.toFixed(1)}%` : 'n/a'}`,
  ];
};

const fearGreedSection = (fg: FearGreedData | null, now: number): string[] => {
  if (!fg) return ['FEAR & GREED (Alternative.me)', '  Unavailable. The engine runs without it, as the app does.'];
  const h = fg.history ?? [];
  const at = (i: number) => (h[i] ? `${h[i]!.value} (${h[i]!.value_classification})` : 'n/a');
  const ts = Number(fg.current.timestamp) * 1000;
  const stale = !isFearGreedFresh(fg, now);
  return [
    'FEAR & GREED (Alternative.me, daily)',
    `  Now ${fg.current.value} (${fg.current.value_classification}), reading dated ${ts > 0 ? formatUkTime(ts) : 'unknown'}` +
      (stale ? '  [STALE: older than 36h]' : ''),
    `  Yesterday ${at(1)}    7 days ago ${at(7)}    30 days ago ${h[30] ? at(30) : at(h.length - 1)}`,
  ];
};

const indicatorSection = (a: TimeframeAnalysis, price: PriceData | null, now: number): string[] => {
  const ind = a.indicators;
  const last = a.closed[a.closed.length - 1];
  const fx = price && price.price > 0 && price.price_gbp > 0 ? price.price_gbp / price.price : null;
  const both = (n: number | null | undefined) =>
    n == null ? 'n/a' : fx ? `${money(n, 'USD')} / ${money(n * fx, 'GBP')}` : money(n, 'USD');
  const out = [`INDICATORS (${a.timeframe} candles, closed bars only, as the app computes them)`];
  if (!last) return [...out, '  No candles.'];

  const barEnd = last.time + TIMEFRAME_MS[a.timeframe];
  const lagBars = (now - barEnd) / TIMEFRAME_MS[a.timeframe];
  out.push(
    `  ${a.closed.length} closed bars; last closed bar opened ${formatUkTime(last.time)}, close ${money(last.close, 'USD')}` +
      (a.rawCount > a.closed.length ? ' (the still-forming bar is left out)' : '') +
      (lagBars > 1.5 ? `  [STALE: ${lagBars.toFixed(1)} bars behind]` : '')
  );

  const rows: [string, string][] = [];
  rows.push(['RSI (14)', num(ind.rsi?.value)]);
  if (ind.macd) {
    const lp = price?.price ?? last.close;
    rows.push([
      'MACD (12, 26, 9)',
      `line ${num(ind.macd.macdLine, 0)}  signal ${num(ind.macd.signalLine, 0)}  histogram ${signed(ind.macd.histogram, 0)}` +
        ` (${signed((ind.macd.histogram / lp) * 100, 2, '%')} of price)` +
        `  line ${ind.macd.macdLine >= ind.macd.signalLine ? 'above' : 'below'} signal`,
    ]);
  } else rows.push(['MACD (12, 26, 9)', 'n/a']);
  if (ind.stochRSI) rows.push(['StochRSI (14, 14, 3, 3)', `K ${num(ind.stochRSI.k)}  D ${num(ind.stochRSI.d)}`]);
  else rows.push(['StochRSI', 'n/a']);
  if (ind.bollingerBands) {
    const bb = ind.bollingerBands;
    rows.push([
      'Bollinger (20, 2)',
      `upper ${money(bb.upper, 'USD')}  middle ${money(bb.middle, 'USD')}  lower ${money(bb.lower, 'USD')}  width ${(bb.bandwidth * 100).toFixed(1)}%`,
    ]);
  } else rows.push(['Bollinger (20, 2)', 'n/a']);
  rows.push(['EMA 9 / EMA 21', `${money(ind.ema9, 'USD')} / ${money(ind.ema21, 'USD')}`]);
  rows.push(['SMA 50 / SMA 200', `${money(ind.sma50, 'USD')} / ${money(ind.sma200, 'USD')}`]);
  rows.push(['200 SMA slope', `${signed(ind.sma200Slope, 2, '%')} over the last 20 bars`]);
  rows.push(['Last close vs 200 SMA', signed(ind.priceVsSma200Pct, 1, '%')]);
  rows.push(['ATR (14)', ind.atr != null ? `${money(ind.atr, 'USD')} (${num(ind.atrPct)}% of price)` : 'n/a']);
  rows.push([
    'Volume, last bar',
    ind.currentVolume != null && ind.volumeAvg20
      ? `${num(ind.currentVolume, 0)} BTC vs 20-bar average ${num(ind.volumeAvg20, 0)} BTC (${(ind.currentVolume / ind.volumeAvg20).toFixed(2)}x)`
      : 'n/a',
  ]);
  rows.push(['50/200 cross on last bar', ind.goldenCross ? 'GOLDEN CROSS' : ind.deathCross ? 'DEATH CROSS' : 'none']);
  rows.push(['Supports, nearest first', ind.supportResistance.supports.map((v) => both(v)).join(';  ') || 'none found']);
  rows.push(['Resistances, nearest first', ind.supportResistance.resistances.map((v) => both(v)).join(';  ') || 'none found']);

  const w = Math.max(...rows.map((r) => r[0].length));
  for (const [k, v] of rows) out.push(`  ${pad(k, w)}  ${v}`);
  return out;
};

const range = (r: readonly [number, number], unit = ''): string => `${r[0]}${unit}..${r[1]}${unit}`;

const signalSection = (a: TimeframeAnalysis, input: ReportInput, config: SignalConfig): string[] => {
  const s = a.signal!;
  const livePrice = input.price!.price;
  const fg = input.fearGreed?.current?.value ?? null;
  const reading = (name: string) => s.readings.find((r) => r.name === name);
  const stretch = computeStretch(a.indicators, livePrice);
  const momentum = computeMomentum(a.indicators, livePrice);
  const dead = config.regimeDeadbandPct;

  const out = [
    `SIGNALS (${a.timeframe}, the engine the Signals tab runs; BULLISH = supports buying, BEARISH = argues for buying less)`,
    '',
    `  1. Long-term trend (regime): ${s.regime}, score ${signed(s.regimeScore, 0)} of 3  [${reading('Market regime')?.signal ?? 'n/a'}]`,
    `     Rule: BULL at ${signed(config.regimeBullScore, 0)} or more, BEAR at ${config.regimeBearScore} or less, otherwise NEUTRAL.`,
  ];
  const regimeRules: Record<string, string> = {
    'Price vs 200 SMA': `+1 if last close is over ${dead}% above the 200 SMA, -1 if over ${dead}% below`,
    '50 vs 200 SMA': `+1 if the 50 SMA is over ${dead}% above the 200 SMA, -1 if over ${dead}% below`,
    '200 SMA slope': `+1 above ${signed(config.sma200SlopeBullPct, 1, '%')} over 20 bars, -1 below ${signed(config.sma200SlopeBearPct, 1, '%')}`,
  };
  for (const c of s.regimeComponents) {
    out.push(`     [${signed(c.value, 0).padStart(2)}] ${c.label}: ${c.detail}  (rule: ${regimeRules[c.label] ?? 'see engine'})`);
  }

  const partRule: Record<string, string> = {
    RSI: `RSI ${range(STRETCH_RANGES.rsi)} maps to -1..+1`,
    StochRSI: `StochRSI K ${range(STRETCH_RANGES.stochRSI)} maps to -1..+1`,
    'Bollinger %B': `%B 0 (lower band)..100 (upper band) maps to -1..+1`,
    'MACD histogram': `histogram ${range(MOMENTUM_RANGES.macdHistPctOfPrice, '%')} of price maps to -1..+1`,
    'EMA 9/21 spread': `spread ${range(MOMENTUM_RANGES.emaSpreadPct, '%')} maps to -1..+1`,
  };
  const partValue = (name: string, raw: number): string =>
    name === 'MACD histogram' ? `${signed(raw, 0)}` : name === 'EMA 9/21 spread' ? signed(raw, 2, '%') : num(raw);

  const dz = `${Math.round(READING_DEADBAND * 100)}%`;
  out.push(
    '',
    `  2. Price stretch: ${pctOf(s.stretchScore)}  [${reading('Price stretch')?.signal ?? 'n/a'}]  moves allocation by ${pctOf(s.allocationParts.stretch, 1)}`,
    `     Rule: average of the parts below. Below -${dz} (oversold) reads BULLISH, above +${dz} (overbought) BEARISH. Weight ±${Math.round(config.stretchWeight * 100)}% allocation.`
  );
  for (const p of stretch.parts) {
    out.push(`     ${p.name} ${partValue(p.name, p.raw)} -> ${signed(p.normalised, 2)}  (${partRule[p.name] ?? ''})`);
  }

  out.push(
    '',
    `  3. Momentum: ${pctOf(s.momentumScore)}  [${reading('Momentum')?.signal ?? 'n/a'}]  moves allocation by ${pctOf(s.allocationParts.momentum, 1)}`,
    `     Rule: average of the parts below. Above +${dz} reads BULLISH, below -${dz} BEARISH. Weight ±${Math.round(config.momentumWeight * 100)}% allocation.`
  );
  for (const p of momentum.parts) {
    out.push(`     ${p.name} ${partValue(p.name, p.raw)} -> ${signed(p.normalised, 2)}  (${partRule[p.name] ?? ''})`);
  }

  const fgReading = reading('Fear & Greed');
  out.push(
    '',
    fg == null
      ? '  4. Market mood (Fear & Greed): unavailable, so not applied.'
      : `  4. Market mood (Fear & Greed): ${fg}  [${fgReading?.signal ?? 'n/a'}]  ${fgReading?.weight === 'Inactive' ? 'inactive' : `moves allocation by ${pctOf(s.allocationParts.sentiment, 1)}`}`,
    `     Rule: only at extremes and against the crowd. ${config.sentimentExtremeFear} or below adds ${Math.round(config.sentimentWeight * 100)}% allocation (BULLISH); ${config.sentimentExtremeGreed} or above takes ${Math.round(config.sentimentWeight * 100)}% off (BEARISH).`
  );

  const tiers = ACTION_TIERS.map((t) =>
    t.minAllocation > 0 ? `${ACTION_LABEL[t.action]} at ${Math.round(t.minAllocation * 100)}%+` : `${ACTION_LABEL[t.action]} below`
  ).join(', ');
  out.push(
    '',
    `  Signal events on the last bar: ${a.indicators.goldenCross ? 'golden cross (50 SMA crossed above 200 SMA)' : a.indicators.deathCross ? 'death cross (50 SMA crossed below 200 SMA)' : 'no 50/200 cross'}.` +
      ' Crosses are shown for information; the engine uses the 50/200 gap above, not the cross itself.',
    `  Advice tiers by target allocation: ${tiers}.`,
    `  Not used by the engine: RSI overbought/oversold settings (${config.rsiOverbought}/${config.rsiOversold}) are display only; volatility and support/resistance are context only.`
  );
  return out;
};

const overallSection = (a: TimeframeAnalysis, input: ReportInput): string[] => {
  const s = a.signal!;
  const p = input.price!;
  const fx = p.price > 0 && p.price_gbp > 0 ? p.price_gbp / p.price : null;
  const both = (n: number) => (fx ? `${money(n, 'USD')} / ${money(n * fx, 'GBP')}` : money(n, 'USD'));
  const parts = s.allocationParts;
  const fg = input.fearGreed?.current ?? null;

  const out = [
    `THE APP'S OVERALL ANALYSIS (${a.timeframe})`,
    `  Advice: ${s.actionLabel}. ${ACTION_PLAIN[s.action]}`,
    `  Target Bitcoin allocation ${Math.round(s.targetAllocation * 100)}% = base ${Math.round(parts.base * 100)}% (${s.regime}) ` +
      `${pctOf(parts.stretch, 1)} stretch ${pctOf(parts.momentum, 1)} momentum ${pctOf(parts.sentiment, 1)} mood` +
      (parts.base + parts.stretch + parts.momentum + parts.sentiment !== s.targetAllocation ? ' (capped to 0..100%)' : ''),
    `  Conviction ${s.conviction}% (agreement between layers)    DCA multiplier ${s.dcaMultiplier}x your usual amount`,
    '',
    '  In plain English (Home tab):',
    ...describeMarket(s, fg?.value ?? null, fg?.value_classification ?? null, input.settings.currency).map((l) => `  - ${l}`),
    '',
    '  Signals tab readings:',
  ];
  for (const r of s.readings) {
    out.push(`  - ${r.name}: ${r.value} [${r.signal}] (${r.weight}). ${r.plain}`);
  }
  if (s.projections) {
    const pr = s.projections;
    out.push(
      '',
      '  Levels and expected range (volatility bands from ATR, not forecasts):',
      `    Nearest support    ${pr.nextSupport != null ? `${both(pr.nextSupport)} (${(((p.price - pr.nextSupport) / p.price) * 100).toFixed(1)}% below)` : 'n/a'}` +
        // Levels come from closed bars, so the live price can already be through them.
        (pr.nextSupport != null && p.price < pr.nextSupport ? '  [live price is already below this level]' : ''),
      `    Nearest resistance ${pr.nextResistance != null ? `${both(pr.nextResistance)} (${(((pr.nextResistance - p.price) / p.price) * 100).toFixed(1)}% above)` : 'n/a'}` +
        (pr.nextResistance != null && p.price > pr.nextResistance ? '  [live price is already above this level]' : ''),
      `    Next 24h range     ${both(Math.max(0, pr.range1d.low))} to ${both(pr.range1d.high)}`,
      `    Next 7d range      ${both(Math.max(0, pr.range7d.low))} to ${both(pr.range7d.high)}`,
      `    ${pr.note}`
    );
  }
  return out;
};

const timeframeTable = (analyses: TimeframeAnalysis[], main: Timeframe, livePrice: number): string[] => {
  const others = analyses.filter((a) => a.timeframe !== main && a.closed.length);
  if (!others.length) return [];
  const out = [
    `OTHER TIMEFRAMES (same code on ${others.map((a) => a.timeframe).join(', ')} candles; the app's advice above uses ${main})`,
  ];
  for (const a of others) {
    const i = a.indicators;
    // The same parts the engine scores, so %B is measured at the live price as it is there.
    const pctB = computeStretch(i, livePrice).parts.find((p) => p.name === 'Bollinger %B')?.raw ?? null;
    const spread = computeMomentum(i, livePrice).parts.find((p) => p.name === 'EMA 9/21 spread')?.raw ?? null;
    out.push(
      `  ${a.timeframe}: RSI ${num(i.rsi?.value)} | StochRSI K ${num(i.stochRSI?.k)} | MACD hist ${signed(i.macd?.histogram, 0)}` +
        ` | %B ${num(pctB, 0)} | EMA9/21 ${signed(spread, 2, '%')} | ATR ${num(i.atrPct)}%` +
        ` | S ${i.supportResistance.supports[0] != null ? money(i.supportResistance.supports[0], 'USD') : 'n/a'}` +
        ` R ${i.supportResistance.resistances[0] != null ? money(i.supportResistance.resistances[0], 'USD') : 'n/a'}` +
        (a.signal
          ? ` | engine: ${a.signal.regime} ${signed(a.signal.regimeScore, 0)}/3, stretch ${pctOf(a.signal.stretchScore)}, momentum ${pctOf(a.signal.momentumScore)}, ${a.signal.actionLabel}`
          : ` | engine: n/a (${a.rawCount} bars)`)
    );
  }
  return out;
};

const onChainSection = (oc: OnChainData | null): string[] => {
  if (!oc || (!oc.fees && !oc.mempool && !oc.difficulty && !oc.hashRate)) {
    return ['ON-CHAIN (mempool.space)', '  Unavailable.'];
  }
  const out = ['ON-CHAIN (mempool.space)'];
  if (oc.fees) {
    out.push(`  Fees (sat/vB): next block ${oc.fees.fastestFee}, 30 min ${oc.fees.halfHourFee}, 1 hour ${oc.fees.hourFee}, minimum ${oc.fees.minimumFee}`);
  }
  if (oc.mempool) {
    out.push(`  Mempool: ${group(String(oc.mempool.count))} unconfirmed transactions, ${(oc.mempool.vsize / 1e6).toFixed(1)} MvB`);
  }
  if (oc.hashRate) out.push(`  Hashrate: ${(oc.hashRate / 1e18).toFixed(0)} EH/s`);
  if (oc.difficulty) {
    const d = oc.difficulty;
    out.push(
      `  Next difficulty adjustment: ${signed(d.difficultyChange, 2, '%')} expected in ${group(String(d.remainingBlocks))} blocks` +
        (d.estimatedRetargetDate ? ` (about ${formatUkTime(d.estimatedRetargetDate)})` : '')
    );
  }
  return out;
};

/** The whole report as plain text. */
export const buildReport = (input: ReportInput): string => {
  const config = configFromSettings(input.settings);
  const tf = input.settings.signalTimeframe;
  const livePrice = input.price?.price ?? 0;
  const fg = input.fearGreed?.current?.value ?? null;

  const analyses = REPORT_TIMEFRAMES.filter((t) => input.candles[t]).map((t) =>
    analyseTimeframe(t, input.candles[t] ?? [], livePrice, fg, config, input.now)
  );
  const main = analyses.find((a) => a.timeframe === tf) ?? null;

  const lines: string[] = [
    `BTC SNAPSHOT  ${formatUkTime(input.now)} (UK time)`,
    `Computed by the BTC Analyst app's own fetchers, indicators and signal engine. ` +
      `Settings: signal timeframe ${tf}, stretch weight ${input.settings.stretchWeight}, currency ${input.settings.currency}.`,
    '',
    ...statusSection(input),
    '',
    ...priceSection(input.price, input.btcDominance),
    '',
    ...fearGreedSection(input.fearGreed, input.now),
    '',
  ];

  if (!main || !main.closed.length) {
    lines.push(`INDICATORS AND SIGNALS`, `  Unavailable: no ${tf} price history loaded.`);
  } else {
    lines.push(...indicatorSection(main, input.price, input.now), '');
    if (!main.signal) {
      lines.push(
        'SIGNALS',
        !input.price
          ? '  Not computed: the engine needs the live price.'
          : `  Not enough history: the engine needs ${MIN_BARS_FOR_SIGNAL} ${tf} bars and there are ${main.rawCount} (the app says "Not enough history yet").`
      );
    } else {
      lines.push(...signalSection(main, input, config), '', ...overallSection(main, input));
    }
  }

  const table = timeframeTable(analyses, tf, livePrice);
  if (table.length) lines.push('', ...table);
  lines.push('', ...onChainSection(input.onChain));
  return lines.join('\n') + '\n';
};
