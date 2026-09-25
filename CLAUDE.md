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

- `src/services/`: pure logic, no React or React Native imports, so it can be tested directly. Put new logic here and test it.
- `src/hooks/`, `src/context/`: thin React wrappers. `src/components/`: shared UI.
- `__tests__/`: Node's built-in test runner. `yarn test` needs no install. `yarn typecheck` needs dependencies.
- Glossary text for the (i) buttons lives in `src/services/glossary.ts`. Every Signals reading carries a `plain` line and a `term` pointing at a glossary entry, and a test enforces both.

## Checks before pushing

1. `yarn typecheck` and `yarn test`.
2. `yarn expo export --platform android` (the same bundling step CI runs; it catches missing modules that typecheck misses).
3. For UI changes: export the web build and drive it with Playwright at phone width (about 400px). The cloud sandbox cannot reach Kraken, CoinPaprika or Alternative.me, so intercept those requests and answer them with synthetic candles and prices. Chromium is at `/opt/pw-browsers`.

## Delivery

- Work on a branch and open a PR into `main`. The PR description is the record of what changed and why, for future sessions.
- CI (`.github/workflows/ci.yml`) runs typecheck, the Android bundle, tests, a live probe of every data source (informational only) and a backtest smoke test.
- The APK workflow builds on every push to `main` or `claude/**` and republishes the same link: https://github.com/tahae02/btc-dashboard/releases/download/apk-latest/btc-analyst.apk. It takes about 11 minutes. Installing over the top keeps the owner's data; uninstalling wipes it.
- The publish step updates the `apk-latest` release in place and then downloads the link to prove it serves the new build, failing the job if not. Do not go back to deleting and recreating the release: that once left it as an untagged draft, the link returned 404 for the owner, and the job still reported success. Only one APK build runs at a time across all branches, newest wins.
- After pushing, wait for the APK job and check its log says "Download verified" before telling the owner the link is ready.

## Decisions already made (and why)

- **The engine does not retune itself from results or from the owner's trades.** Two years of daily data holds fewer than two dozen independent months, and a month's BTC move is routinely ±20%, so self-tuning would fit noise. The owner accepted this. Parameter changes go through `yarn backtest --split` on real data instead. The Track record (Signals tab) is how to spot when that is worth doing.
- **The signal is an allocation for a long-term buyer, not a price prediction.** The 24h and 7d "ranges" are volatility bands (ATR-based), not forecasts. Do not describe them as predictions.
- **Every trade records the full picture at that moment and never recomputes it:** advice, regime and score, conviction, target allocation, DCA multiplier, Fear & Greed value and label, RSI, volatility, the 200-day average and the distance from it, stretch, momentum, and the market price in both GBP and USD. Back-dated trades get this replayed from history (with that day's Fear & Greed from its full history) and are marked "replayed". The owner wants this kept for looking back later, so do not drop fields.
- **Starting balance:** a snapshot of what the owner already held (total put in and BTC held). Trades dated at or before it are already inside it and are not added to holdings again. That lets old orders be back-logged for signal tracking without double counting.
- **Trade entry mirrors Coinbase order details:** total, fee, BTC and price per BTC. Any two of total, BTC and price give the third. All three are cross-checked. Buy: total = BTC x price + fee. Sell: total = BTC x price - fee.
- **The Portfolio tab always shows GBP and USD, whatever the currency setting.** Holdings value and P&L sit side by side; cost of holdings, average cost, realised and total put in show GBP with USD underneath. The other currency is converted at today's rate (implied by the live BTC price in each), and the screen says so.
- **Data loads progressively.** Each source's result is shown as it arrives, and the last good data is shown instantly on launch. Do not go back to waiting for every source before rendering; that caused a 20-second blank screen.
- Old trades, backups (v1 and v2) and settings must keep loading after any change. Storage parsers validate field by field and default missing fields.

## Open issues

- Fear & Greed (Alternative.me) fails on the owner's phone, although CI reaches it fine, including with the Android user agent. The app now shows the failure reason in brackets; the owner has not yet reported what it says. The likely causes are a DNS or ad blocker, or an IP block on their network.
