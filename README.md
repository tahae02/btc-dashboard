# BTC Analyst

A deterministic, rules-based Bitcoin dashboard and allocation advisor. React Native + Expo, TypeScript. No AI, no backend, no API keys, no accounts. Every indicator is computed on-device from public price data.

The app answers one question: **how much of my intended Bitcoin position should I be holding right now, and should this month's contribution be bigger or smaller than usual?**

---

## The honest disclaimer, first

This applies fixed rules to past prices. It cannot know anything about the future, it cannot react to news, and a composite of classic technical indicators is not a proven edge. Bitcoin has repeatedly fallen more than 70% from its peak, and every strategy in here would have sat through those falls.

**Before you trust a single number in this app, run the backtest on real data.** That is what `yarn backtest` is for, and it is the most important part of this repository.

---

## How the signal works

Readings are grouped into layers, and the layers apply in a fixed order. Each layer can only do a bounded amount of work.

```
  REGIME          Where are we in the cycle?              sets the BASE allocation
  (slow, primary) price vs SMA200, SMA50 vs SMA200,       BULL  1.00
                  slope of the SMA200                      NEUTRAL 0.60
                                                           BEAR  0.25
       |
       v
  STRETCH         How extended is price right now?        ±0.15 allocation
  (fast)          RSI, StochRSI, Bollinger %B
                  -> collapsed into ONE score
       |
       v
  MOMENTUM        Is the move accelerating or fading?     ±0.10 allocation
  (confirming)    MACD histogram, EMA 9/21 spread
                  -> collapsed into ONE score
       |
       v
  SENTIMENT       Fear & Greed, contrarian                ±0.10, extremes only
       |
       v
  TARGET ALLOCATION (0-100%), plus a DCA multiplier and a conviction score
```

Two design rules matter more than the individual numbers:

**Correlated readings are collapsed, not counted separately.** RSI, StochRSI and Bollinger %B all measure the same thing. Treating them as three independent votes counts one opinion three times.

**Mean reversion can never flip the regime, only temper it.** An overbought RSI in a healthy uptrend means "don't chase here", not "sell". The previous engine scored RSI ≥ 60 as bearish, so it called a bull market bearish for weeks at a time.

Volatility (ATR) and support/resistance are shown as **context** and explicitly do not vote.

---

## Running the backtest

This is the part that tells you whether any of it works.

```bash
yarn backtest:fetch     # download real daily BTC/USD history (do this first)
yarn backtest           # compare the engine against buy & hold, DCA, SMA200
yarn backtest --sweep   # sweep the main parameters
yarn backtest --split   # in-sample vs out-of-sample
yarn backtest --mode lump
yarn backtest --csv /path/to/your.csv
```

Needs nothing installed — it runs on Node 22's built-in TypeScript support.

What the harness guarantees:

- **No lookahead.** A strategy sees a trailing window ending at bar `i` and trades at the **open of bar `i+1`**. This is enforced by a test that rewrites all future bars and asserts past decisions don't move. Getting this wrong is the single most common reason a backtest looks brilliant and then loses money.
- **Costs are charged.** 0.26% fee plus 0.05% slippage each way, by default. Plenty of strategies that beat buy-and-hold on paper are net losers after fees.
- **Contributions are identical across strategies.** In DCA mode the same money arrives on the same schedule for everyone. Only the speed of deployment differs, so nobody wins by contributing more.

### Benchmarks it must beat

| Benchmark | Why it's there |
|---|---|
| Buy & hold | If the engine can't beat simply buying, the machinery is costing you money and attention for nothing. |
| SMA200 filter / graded | A one-line rule. If the full engine can't beat it, the extra complexity isn't earning its keep. |
| Regime only | Shows how much the faster layers actually add. Sometimes the answer is "less than nothing". |

### Reading the output

- **IRR** — money-weighted annual return. The honest number when you contribute over time.
- **Max DD** — worst peak-to-trough fall. This decides whether you actually hold on.
- **Calmar** — return per unit of drawdown.
- **vs B&H** — the only column that decides whether any of this beat simply buying.

### On the bundled data

If you haven't run `backtest:fetch`, the harness falls back to a deterministic synthetic BTC-shaped series and says so loudly. **Those numbers demonstrate that the plumbing works. They say nothing about whether the strategy makes money.** Real data first, always.

One default was changed based on that synthetic run: `stretchWeight` went from 0.25 to 0.15, because a heavier mean-reversion weight dragged the allocation across the rebalance band constantly and paid a fee every time (500+ trades versus 72 for the regime layer alone). That's a cost-of-churn effect rather than a curve fit, which is why it was trusted enough to change a default. Re-run `--sweep` on your own data and change it back if your data disagrees.

---

## Running the app

### Prerequisites

```bash
corepack enable          # this project uses Yarn 4; corepack ships with Node
yarn install
```

Node 20+ is needed for the app, Node 22+ for the backtest scripts.

### Option 1 — Expo Go (fastest, no build)

```bash
yarn start
```

Install **Expo Go** from the Play Store, then scan the QR code from the terminal. The app loads over your network in a few seconds. Both devices need to be on the same Wi-Fi; if that's awkward, use `yarn start --tunnel`.

Good for: checking screens and signals immediately. This is the quickest way to see whether the changes look right.

### Option 2 — Preview APK (a real, installable app)

A standalone `.apk` you can sideload and keep, with no laptop involved.

```bash
npm install -g eas-cli
eas login                                        # free Expo account
eas build:configure                              # once per project
eas build --profile preview --platform android
```

The build runs on Expo's servers (the free tier queues but works). When it finishes you get a download link and a QR code. Open it on the phone, download the APK, and allow "install from unknown sources" when prompted.

The `preview` profile in `eas.json` is already set to `buildType: apk` for exactly this — the `production` profile builds an `.aab`, which is for Play Store upload and cannot be sideloaded.

### Option 3 — Build locally

Needs Android Studio, the Android SDK and a JDK.

```bash
npx expo prebuild --platform android    # generates the native android/ project
cd android && ./gradlew assembleRelease
# output: android/app/build/outputs/apk/release/app-release.apk
```

`android/` and `ios/` are gitignored, so `prebuild` regenerates them. Don't hand-edit anything inside them.

### Which should you use?

Start with **Expo Go** to check it works. Move to the **preview APK** once you want it on your phone properly — Expo Go can't do the on-chain screen's background behaviour and won't survive a phone restart as a standalone app.

### Note on the On-Chain screen

mempool.space doesn't send browser CORS headers, so on-chain metrics are skipped on web and work only in native builds (Expo Go included). The screen explains this when you're on web.

---

## Testing

```bash
yarn test          # 83 tests, no install required
yarn test:watch
yarn typecheck
```

Tests run on Node's built-in runner, so they need no dependencies at all. They cover:

- every indicator against **Wilder's published RSI reference values** and known-good cases
- regression tests for the specific bugs this rewrite fixed
- signal engine behaviour (regime dominance, all tiers reachable, conviction is real information)
- the no-lookahead guarantee in the backtester
- metrics (IRR, drawdown, contributions not counted as performance)

There are no component tests, and therefore no jest. Adding them later means adding `jest-expo` and `@testing-library/react-native` back.

---

## Project layout

```
src/services/      pure logic, no React — indicators, signal engine, candles, supply, settings
src/hooks/         thin React wrappers over the above
src/context/       settings + market data providers
app/tabs/          the four screens
backtest/          harness, strategies, metrics, data loading, CLI
__tests__/         logic tests (node:test)
```

The split matters: **everything in `src/services/` is framework-free**, which is what lets the backtest and the tests exercise exactly the code the app ships. If the backtest ran on a reimplementation, it would be testing the wrong thing.

---

## Data sources

| Data | Source | Notes |
|---|---|---|
| Price + OHLC candles | Kraken public API | No key, CORS-friendly |
| BTC dominance | CoinPaprika | No key |
| Fear & Greed | Alternative.me | No key |
| On-chain (mempool, fees, hashrate) | mempool.space | Native builds only |
| Backtest history | CryptoCompare, Kraken fallback | `yarn backtest:fetch` |

Market cap is derived as `price × supply`, where supply is extrapolated from the 2024 halving checkpoint rather than hardcoded.

---

## Things worth knowing before you rely on this

- **The simple benchmark sometimes wins.** On the bundled synthetic data, "SMA200 graded" beat the full engine out-of-sample. If that holds on your real data, use the simpler rule. The benchmarks exist to tell you this, not to flatter the engine.
- **A parameter sweep finds what fit the past.** That is not the same as what will work next year. Use `--split` and look for settings that are stable across neighbours, not the single best row.
- **Fees compound against you.** Trading more is almost always worse. The default rebalance band is deliberately wide.
- **DCA is hard to beat.** For most people, buying a fixed amount on a schedule and ignoring the chart beats discretionary timing. This app's most defensible use is deciding whether to lean slightly into or out of that schedule, not replacing it.

## Licence

MIT. See `LICENSE`.
