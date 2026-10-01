# BTC Analyst: notes for Claude

Read this first. It carries decisions and context from earlier sessions that are not obvious from the code. Keep it up to date: when a session makes a decision the owner will care about later, add it here in the same PR.

## The owner

- Based in the UK, buys Bitcoin in pounds on Coinbase, and is not a trader. Explain things in plain English, not trader jargon.
- Write UK English, and no em dashes, in chat replies and in text written into the app.
- Uses the app as an installed Android APK, not Expo Go.

## What the app is

A rules-based Bitcoin dashboard and allocation advisor: React Native + Expo (SDK 54), TypeScript, expo-router. No backend, no accounts, no API keys. The README explains the signal engine in depth.

Tabs: Home, Chart, Signals, Portfolio, On-Chain, Settings. The first tab is labelled "Home" because six tabs cut "Dashboard" off.

## Layout and conventions

- `src/services/`: pure logic, no React or React Native imports, so it can be tested directly. Put new logic here and test it. The one exception is `api.ts`, which adds the web-only rule on top of `marketApi.ts`.
- `src/hooks/`, `src/context/`: thin React wrappers. `src/components/`: shared UI.
- `__tests__/`: Node's built-in test runner. The tests need no dependencies (though Yarn itself wants `yarn install` first on a fresh clone; see below). `yarn typecheck` needs dependencies.
- Glossary text for the (i) buttons lives in `src/services/glossary.ts`. Every Signals reading carries a `plain` line and a `term` pointing at a glossary entry, and a test enforces both.

## Snapshot and /btc-brief

- `yarn snapshot` (or, with nothing installed, `node --experimental-strip-types --no-warnings --import ./backtest/register.mjs scripts/snapshot.ts`) prints the app's full reading from live data as plain text: UK time, price in USD and GBP, Fear & Greed, every indicator, each signal layer with the rule and threshold behind it, the overall advice, other timeframes and on-chain. Options: `--timeframe 1H|4H|1D|1W`, `--stretch-weight`, `--currency`. Exit code 1 when the price or the signal timeframe's candles failed; the report still prints what loaded.
- It must never calculate anything itself. `scripts/snapshot.ts` fetches through `src/services/marketApi.ts` (the app's fetchers, split out of `api.ts` so Node can import them without React Native) and `src/services/marketReport.ts` runs the app's own `dropIncompleteCandle`, `computeIndicators`, `computeSignal` and `describeMarket`. Thresholds it prints come from constants the engine exports (`STRETCH_RANGES`, `MOMENTUM_RANGES`, `ACTION_TIERS`, `READING_DEADBAND`), and the allocation breakdown from `SignalResult.allocationParts`. If you change a threshold in the engine, change it there, not in the report.
- It cannot read the phone's settings. Defaults match the app's defaults; pass flags if the owner has changed theirs.
- **The app can export the same report:** Settings > Share with Claude > Share snapshot (`src/components/SnapshotShareCard.tsx`). It fetches fresh data on the phone, with the phone's settings, and opens the share sheet with the text; the owner pastes it under `/btc-brief`. This exists because cloud sessions often cannot reach the data sources, and it is the most faithful copy of what the app shows. The phone export and the script both go through `collectSnapshot` in `marketReport.ts`, so they cannot drift apart. Text was chosen over screenshots or a zip: it carries every number exactly, pastes reliably into a Claude chat, and needs no new native modules. The status line under the button names any failed source with its reason, which should also finally show why Fear & Greed fails on the owner's phone.
- No source needs an API key. If one is ever added, read it from an environment variable (`.env` is git-ignored) and never commit it.
- Claude Code cloud sessions block all four data hosts by default (HTTP 403 from the egress proxy). To run the snapshot there, add `api.kraken.com`, `api.alternative.me`, `api.coinpaprika.com` and `mempool.space` to the environment's allowed domains (environment menu in the session title bar, Edit, Network access). It works anywhere else with ordinary internet access.
- `.claude/commands/btc-brief.md` is the owner's `/btc-brief [amount in GBP]` command: it uses a snapshot pasted from the app if there is one (checking its age against the current price), otherwise runs the snapshot, researches news, macro, ETF flows, derivatives and scheduled events, then gives a short-term call (verdict, entry, split and limit orders, probabilities, levels, invalidation, confidence). The owner asked for it to be direct and without disclaimers. It is a separate short-term view, and does not change the app's own stance that its signal is a long-term allocation, not a prediction.

## Checks before pushing

1. `yarn typecheck` and `yarn test`. In a cloud session Corepack cannot download Yarn from repo.yarnpkg.com; prefix commands with `COREPACK_NPM_REGISTRY=https://registry.npmjs.org` and it fetches Yarn from npm instead. On a fresh clone Yarn also refuses to run any script, `yarn test` included, until `yarn install` has run, because the committed lockfile is stale.
2. `yarn expo export --platform android` (the same bundling step CI runs; it catches missing modules that typecheck misses).
3. For UI changes: export the web build and drive it with Playwright at phone width (about 400px). The cloud sandbox cannot reach Kraken, CoinPaprika or Alternative.me, so intercept those requests and answer them with synthetic candles and prices. Chromium is at `/opt/pw-browsers`.

## Delivery

- Work on a branch and open a PR into `main`. The PR description is the record of what changed and why, for future sessions.
- CI (`.github/workflows/ci.yml`) runs typecheck, the Android bundle, tests, a live probe of every data source (informational only) and a backtest smoke test.
- The APK workflow builds on every push to `main` or `claude/**` and republishes the same link: https://github.com/tahae02/btc-dashboard/releases/download/apk-latest/btc-analyst.apk. It takes about 11 minutes. Installing over the top keeps the owner's data; uninstalling wipes it.

## Decisions already made (and why)

- **The engine does not retune itself from results or from the owner's trades.** Two years of daily data holds fewer than two dozen independent months, and a month's BTC move is routinely ±20%, so self-tuning would fit noise. The owner accepted this. Parameter changes go through `yarn backtest --split` on real data instead. The Track record (Signals tab) is how to spot when that is worth doing.
- **The signal is an allocation for a long-term buyer, not a price prediction.** The 24h and 7d "ranges" are volatility bands (ATR-based), not forecasts. Do not describe them as predictions.
- **Every trade records the full picture at that moment and never recomputes it:** advice, regime and score, conviction, target allocation, DCA multiplier, Fear & Greed value and label, RSI, volatility, the 200-day average and the distance from it, stretch, momentum, and the market price in both GBP and USD. Back-dated trades get this replayed from history (with that day's Fear & Greed from its full history) and are marked "replayed". The owner wants this kept for looking back later, so do not drop fields.
- **Starting balance:** a snapshot of what the owner already held (total put in and BTC held). Trades dated at or before it are already inside it and are not added to holdings again. That lets old orders be back-logged for signal tracking without double counting.
- **Trade entry mirrors Coinbase order details:** total, fee, BTC and price per BTC. Any two of total, BTC and price give the third. All three are cross-checked. Buy: total = BTC x price + fee. Sell: total = BTC x price - fee.
- **The Portfolio tab always shows GBP and USD, whatever the currency setting.** Holdings value and P&L sit side by side; cost of holdings, average cost, realised and total put in show GBP with USD underneath. The other currency is converted at today's rate (implied by the live BTC price in each), and the screen says so.
- **Data loads progressively.** Each source's result is shown as it arrives, and the last good data is shown instantly on launch. Do not go back to waiting for every source before rendering; that caused a 20-second blank screen.
- **A trade's "What happened next" shows money next to each percentage**, e.g. "+1.5% (+£50)". The money is the move applied to the BTC from that trade, valued at the price paid (total minus fee on a buy), so it always has the same sign as the percentage. The percentages stay BTC/USD market moves, as before. A final row, "Worth now, vs what you paid", gives the real difference today with the fee included, which can be lower. Logic is `moveInMoney` and `worthNow` in `journal.ts`.
- **"What if Bitcoin hits…" calculator** lives on the Portfolio tab, below the buy and sell buttons, not in a new tab (six tabs already cut labels). The owner asked for a price slider, dollars by default with a switch to pounds, and the result as money and a percentage. "My Bitcoin" values the BTC held against the cost of holdings (GBP); "An amount" assumes a buy at today's price before fees. Results always show pounds and dollars, converted at today's rate. The slider is a log scale from 10k to 1M, built on PanResponder so it needs no native module. Its choices are remembered under `btc_dashboard_calculator_v1`. It is arithmetic, not a forecast, and the card says so. Logic is in `src/services/calculator.ts`.
- Old trades, backups (v1 and v2) and settings must keep loading after any change. Storage parsers validate field by field and default missing fields.

## Open issues

- Fear & Greed (Alternative.me) fails on the owner's phone, although CI reaches it fine, including with the Android user agent. The app now shows the failure reason in brackets; the owner has not yet reported what it says. The likely causes are a DNS or ad blocker, or an IP block on their network.
