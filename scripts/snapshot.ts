/**
 * Headless market snapshot: fetch live data and print the app's full reading.
 *
 *   yarn snapshot                        app defaults (1D signal)
 *   yarn snapshot --timeframe 4H         signal on another timeframe
 *   yarn snapshot --stretch-weight 0.2   match a changed setting in the app
 *
 * Uses the app's own fetchers (src/services/marketApi) and the report in
 * src/services/marketReport, which runs the app's indicator and signal code.
 * With the same settings, the numbers match what the app shows (allowing for
 * the seconds between the two fetches).
 *
 * Exit code: 0 when the price and the signal timeframe's candles loaded, 1
 * when they did not (the report still prints whatever did load).
 */
import { fetchPriceData, fetchOHLCV, fetchBTCDominance, fetchFearGreed, fetchOnChainData } from '../src/services/marketApi';
import { describeFetchError } from '../src/services/http';
import { sanitiseSettings } from '../src/services/settings';
import { buildReport, REPORT_TIMEFRAMES, SOURCE_HOSTS, type SourceOutcome } from '../src/services/marketReport';
import type { OHLCVCandle, Settings, Timeframe } from '../src/types';

const USAGE = `Usage: yarn snapshot [--timeframe 1H|4H|1D|1W] [--currency GBP|USD] [--stretch-weight 0..0.5]

Prints a plain-text snapshot of live Bitcoin data run through the app's own
indicators and signal engine. Defaults match the app's default settings, with
the plain-English example amounts in pounds.`;

const parseArgs = (argv: string[]): Settings => {
  const input: Partial<Settings> = { currency: 'GBP' };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (flag === '--help' || flag === '-h') {
      console.log(USAGE);
      process.exit(0);
    }
    if (value == null) throw new Error(`${flag} needs a value\n\n${USAGE}`);
    if (flag === '--timeframe') input.signalTimeframe = value.toUpperCase() as Timeframe;
    else if (flag === '--currency') input.currency = value.toUpperCase() as Settings['currency'];
    else if (flag === '--stretch-weight') input.stretchWeight = Number(value);
    else throw new Error(`Unknown option ${flag}\n\n${USAGE}`);
    i++;
  }
  const settings = sanitiseSettings(input);
  if (input.signalTimeframe && settings.signalTimeframe !== input.signalTimeframe) {
    throw new Error(`Unknown timeframe ${input.signalTimeframe}. Use one of ${REPORT_TIMEFRAMES.join(', ')}.`);
  }
  return settings;
};

const main = async (): Promise<void> => {
  const settings = parseArgs(process.argv.slice(2));

  // Everything at once, as the app does on refresh.
  const [price, dominance, fearGreed, onChain, ...ohlc] = await Promise.allSettled([
    fetchPriceData(),
    fetchBTCDominance(),
    fetchFearGreed(),
    fetchOnChainData(),
    ...REPORT_TIMEFRAMES.map((tf) => fetchOHLCV(tf)),
  ]);

  const outcome = (label: string, host: string, r: PromiseSettledResult<unknown>): SourceOutcome => ({
    label,
    host,
    error: r.status === 'rejected' ? describeFetchError(r.reason) : null,
  });
  const value = <T>(r: PromiseSettledResult<T>): T | null => (r.status === 'fulfilled' ? r.value : null);

  const candles: Partial<Record<Timeframe, OHLCVCandle[]>> = {};
  REPORT_TIMEFRAMES.forEach((tf, i) => {
    const r = ohlc[i] as PromiseSettledResult<OHLCVCandle[]>;
    candles[tf] = r.status === 'fulfilled' ? r.value : [];
  });

  const sources: SourceOutcome[] = [
    outcome('Live price (Kraken)', SOURCE_HOSTS.kraken, price),
    ...REPORT_TIMEFRAMES.map((tf, i) => outcome(`Price history ${tf} (Kraken)`, SOURCE_HOSTS.kraken, ohlc[i]!)),
    outcome('Fear & Greed (Alternative.me)', SOURCE_HOSTS.alternative, fearGreed),
    outcome('BTC dominance (CoinPaprika)', SOURCE_HOSTS.paprika, dominance),
    outcome('On-chain (mempool.space)', SOURCE_HOSTS.mempool, onChain),
  ];

  process.stdout.write(
    buildReport({
      now: Date.now(),
      settings,
      price: value(price),
      candles,
      fearGreed: value(fearGreed),
      btcDominance: value(dominance),
      onChain: value(onChain),
      sources,
      proxied: Boolean(process.env.HTTPS_PROXY || process.env.https_proxy || process.env.CCR_AGENT_PROXY_ENABLED),
    })
  );

  const tfIndex = REPORT_TIMEFRAMES.indexOf(settings.signalTimeframe);
  if (price.status === 'rejected' || ohlc[tfIndex]?.status === 'rejected') process.exitCode = 1;
};

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
