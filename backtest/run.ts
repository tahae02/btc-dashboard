/**
 * Backtest CLI.
 *
 *   yarn backtest                      compare the engine against benchmarks
 *   yarn backtest --csv data.csv       use your own OHLCV data
 *   yarn backtest --mode lump          lump-sum instead of DCA
 *   yarn backtest --sweep              sweep the main parameters
 *   yarn backtest --split              in-sample / out-of-sample check
 *
 * The report deliberately leads with the comparison against buy-and-hold
 * rather than with the strategy's own return, because "did this beat simply
 * buying?" is the only question that decides whether the engine is worth using.
 */
import type { Dataset } from './data';
import { loadDataset, describeDataset } from './data';
import type { BacktestResult, Strategy } from './engine';
import { runBacktest, DEFAULT_OPTIONS } from './engine';
import { BENCHMARKS, signalEngineStrategy, regimeOnlyStrategy } from './strategies';
import { DEFAULT_CONFIG } from '../src/services/signalEngine';
import type { SignalConfig, OHLCVCandle } from '../src/types';

const arg = (flag: string): string | undefined => {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const has = (flag: string): boolean => process.argv.includes(flag);

const pct = (n: number, dp = 1): string => `${n >= 0 ? '+' : ''}${n.toFixed(dp)}%`;
const money = (n: number): string =>
  n >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : `$${Math.round(n).toLocaleString('en-GB')}`;

const table = (rows: string[][], headers: string[]): string => {
  const all = [headers, ...rows];
  const widths = headers.map((_, c) => Math.max(...all.map((r) => (r[c] ?? '').length)));
  const line = (r: string[], pad = ' ') =>
    r.map((cell, c) => (c === 0 ? (cell ?? '').padEnd(widths[c]!, pad) : (cell ?? '').padStart(widths[c]!, pad))).join('  ');
  return [line(headers), widths.map((w) => '-'.repeat(w)).join('  '), ...rows.map((r) => line(r))].join('\n');
};

const resultRow = (r: BacktestResult, baseline?: BacktestResult): string[] => {
  const m = r.metrics;
  const vs = baseline ? ((m.finalValue / baseline.metrics.finalValue - 1) * 100) : 0;
  return [
    r.strategy,
    money(m.finalValue),
    `${m.multiple.toFixed(2)}x`,
    pct(m.irrPct),
    pct(m.maxDrawdownPct),
    m.sharpe.toFixed(2),
    m.calmar.toFixed(2),
    `${m.avgAllocationPct.toFixed(0)}%`,
    String(m.rebalances),
    money(m.feesPaid),
    baseline ? pct(vs) : '—',
  ];
};

const HEADERS = ['Strategy', 'Final', 'Multiple', 'IRR', 'Max DD', 'Sharpe', 'Calmar', 'Avg alloc', 'Trades', 'Fees', 'vs B&H'];

const runSet = (candles: OHLCVCandle[], strategies: Strategy[], mode: 'lump' | 'dca'): BacktestResult[] =>
  strategies.map((s) =>
    runBacktest({
      ...DEFAULT_OPTIONS,
      mode,
      // In lump mode all the money goes in at the start, so the comparison is
      // purely about allocation timing rather than contribution scheduling.
      initialCapital: mode === 'lump' ? 10000 : 1000,
      contribution: mode === 'lump' ? 0 : 250,
      candles,
      strategy: s,
    })
  );

const report = (title: string, results: BacktestResult[]): void => {
  const baseline = results.find((r) => r.strategy === 'Buy & hold');
  console.log(`\n${title}`);
  console.log('='.repeat(title.length));
  console.log(table(results.map((r) => resultRow(r, baseline)), HEADERS));

  const engine = results.find((r) => r.strategy === 'Signal engine');
  if (engine && baseline) {
    const d = (engine.metrics.finalValue / baseline.metrics.finalValue - 1) * 100;
    const ddBetter = Math.abs(engine.metrics.maxDrawdownPct) < Math.abs(baseline.metrics.maxDrawdownPct);
    console.log('\nVerdict:');
    console.log(
      `  Return: signal engine finished ${pct(d)} vs buy & hold` +
        (d > 0 ? ' (ahead).' : ' (behind).')
    );
    console.log(
      `  Risk:   max drawdown ${pct(engine.metrics.maxDrawdownPct)} vs ${pct(baseline.metrics.maxDrawdownPct)}` +
        (ddBetter ? ' (shallower, easier to actually hold).' : ' (deeper).')
    );
    if (d <= 0 && ddBetter) {
      console.log('  Read:   gave up return to cut drawdown. Worth it only if the deeper hole would have shaken you out.');
    } else if (d <= 0 && !ddBetter) {
      console.log('  Read:   worse on both counts. On this data the engine is not earning its keep.');
    } else if (d > 0 && ddBetter) {
      console.log('  Read:   better on both counts on this sample. Check it holds out-of-sample before believing it.');
    } else {
      console.log('  Read:   more return, deeper hole. Judge against your own tolerance for drawdown.');
    }
  }
};

const sweep = (candles: OHLCVCandle[]): void => {
  console.log('\nParameter sweep (DCA mode)');
  console.log('==========================');
  const rows: string[][] = [];
  const variants: { label: string; config: SignalConfig }[] = [];

  for (const bear of [0, 0.25, 0.5]) {
    for (const stretch of [0, 0.15, 0.25, 0.4]) {
      for (const band of [0.1, 0.2]) {
        variants.push({
          label: `bear=${bear} stretch=${stretch} band=${band}`,
          config: { ...DEFAULT_CONFIG, baseAllocationBear: bear, stretchWeight: stretch, rebalanceBand: band },
        });
      }
    }
  }

  const baseline = runBacktest({ ...DEFAULT_OPTIONS, candles, strategy: BENCHMARKS[0]! });
  for (const v of variants) {
    const r = runBacktest({ ...DEFAULT_OPTIONS, candles, strategy: signalEngineStrategy(v.config) });
    rows.push([
      v.label,
      money(r.metrics.finalValue),
      pct(r.metrics.irrPct),
      pct(r.metrics.maxDrawdownPct),
      r.metrics.sharpe.toFixed(2),
      String(r.metrics.rebalances),
      pct((r.metrics.finalValue / baseline.metrics.finalValue - 1) * 100),
    ]);
  }
  rows.sort((a, b) => parseFloat(b[6]!.replace('%', '')) - parseFloat(a[6]!.replace('%', '')));
  console.log(table(rows, ['Config', 'Final', 'IRR', 'Max DD', 'Sharpe', 'Trades', 'vs B&H']));
  console.log(
    '\nCaution: the best row here is the one that best fit THIS history. That is not\n' +
      'the same as the one that will do best next year. Treat a sweep as a check that\n' +
      'results are stable across nearby settings, not as a way to pick the winner.\n' +
      'If the top rows differ wildly from their neighbours, the edge is noise.'
  );
};

const split = (candles: OHLCVCandle[]): void => {
  const cut = Math.floor(candles.length * 0.6);
  const inSample = candles.slice(0, cut);
  const outSample = candles.slice(cut - DEFAULT_OPTIONS.windowSize);
  console.log('\nIn-sample vs out-of-sample');
  console.log('==========================');
  console.log(`In-sample:     ${inSample.length} bars`);
  console.log(`Out-of-sample: ${outSample.length} bars (strategy unchanged between the two)\n`);

  for (const [label, data] of [['IN-SAMPLE', inSample], ['OUT-OF-SAMPLE', outSample]] as const) {
    if (data.length < DEFAULT_OPTIONS.warmup + 30) {
      console.log(`${label}: not enough bars, skipped.`);
      continue;
    }
    const results = runSet(data as OHLCVCandle[], [...BENCHMARKS, signalEngineStrategy()], 'dca');
    report(label, results);
  }
  console.log(
    '\nIf the engine looks good in-sample and ordinary out-of-sample, the in-sample\n' +
      'result was luck or fitting. Only the out-of-sample column is evidence.'
  );
};

const main = (): void => {
  const dataset: Dataset = loadDataset(arg('--csv'));
  console.log(`Data: ${describeDataset(dataset)}`);

  if (dataset.source === 'synthetic') {
    console.log(
      '\n' + '!'.repeat(72) + '\n' +
        '!! SYNTHETIC DATA. These numbers say the harness works. They say NOTHING\n' +
        '!! about whether this strategy makes money. Run `yarn backtest:fetch` to\n' +
        '!! download real BTC history, then run this again.\n' +
        '!'.repeat(72)
    );
  }

  const costs = `Costs applied: ${DEFAULT_OPTIONS.feePct}% fee per trade + ${DEFAULT_OPTIONS.slippagePct}% slippage each way.`;
  console.log(costs);

  if (has('--sweep')) return sweep(dataset.candles);
  if (has('--split')) return split(dataset.candles);

  const mode = (arg('--mode') as 'lump' | 'dca') ?? 'dca';
  const strategies = [...BENCHMARKS, regimeOnlyStrategy(), signalEngineStrategy()];
  const results = runSet(dataset.candles, strategies, mode);

  report(
    mode === 'dca'
      ? 'DCA mode — £250 every 30 days, identical contributions for every strategy'
      : 'Lump-sum mode — all capital available from day one',
    results
  );

  console.log(
    '\nReading the columns:\n' +
      '  IRR      money-weighted annual return. The honest one when you contribute over time.\n' +
      '  Max DD   worst peak-to-trough fall. This is the number that decides whether you hold on.\n' +
      '  Calmar   return per unit of drawdown. Higher is a smoother ride for the same return.\n' +
      '  vs B&H   the only column that decides whether any of this beat simply buying.\n'
  );
};

main();
