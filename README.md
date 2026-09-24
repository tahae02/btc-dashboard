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

### Install it on your phone

**Download:** <https://github.com/tahae02/btc-dashboard/releases/download/apk-latest/btc-analyst.apk>

Open that link on your Android phone, open the downloaded file, and install. Android will ask you to allow installing apps from your browser; allow it once. No computer, account or cable needed.

This is a normal, standalone app. It carries its own code, so it works whenever you open it, starts in a second or two, and keeps working when the phone sleeps.

**To update**, open the same link again and install over the top. Your settings are kept.

The link always points at the newest build. Every push that changes the app triggers the `Build Android APK` workflow, which compiles a fresh APK on GitHub's servers (about 15 to 25 minutes) and replaces the file. See the [release page](https://github.com/tahae02/btc-dashboard/releases/tag/apk-latest) for which commit it was built from.

The APK is built for 64-bit ARM, which covers every Android phone sold in recent years. It is signed with the Expo template's shared development key: fine for installing on your own phone, not suitable for publishing to the Play Store.

### For development: Expo Go

Expo Go streams the app from your computer over Wi-Fi, so edits show up on the phone within seconds. The catch is that it only works while your computer is running the development server: when the phone sleeps or loses the connection, the app stops until you scan the QR code again. Use it for changing the app, and the APK above for using it.

**Prerequisites**

```bash
corepack enable          # this project uses Yarn 4; corepack ships with Node
yarn install
```

Node 20+ is needed for the app, Node 22+ for the backtest scripts.

> **Windows:** in a normal PowerShell window, `corepack enable` fails with
> `EPERM: operation not permitted, open 'C:\Program Files\nodejs\pnpm'`.
> It is trying to write into Node's install folder, which needs administrator
> rights. The simplest fix is to skip it and put `corepack` in front of every
> yarn command instead, which needs no admin rights at all:
>
> ```powershell
> corepack yarn install
> corepack yarn start
> corepack yarn test
> ```
>
> Or run `corepack enable` once in a PowerShell opened with **Run as
> administrator**, after which plain `yarn` works. If plain `yarn` then says
> *running scripts is disabled on this system*, run
> `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` once.

`yarn install` will modify `yarn.lock` the first time you run it. That is
expected, not a fault: the lockfile still carries the dependencies that
were removed, and regenerating it is how they get pruned. Commit the result.
Once it is committed, drop `--no-immutable` from `.github/workflows/ci.yml`
so CI fails on dependency drift rather than silently absorbing it.

**Start it**

```bash
yarn start
```

Install **Expo Go** from the Play Store, then scan the QR code from the terminal. Both devices need to be on the same Wi-Fi; if that's awkward, use `yarn start --tunnel`.

> **"Project is incompatible with this version of Expo Go."** The Play Store
> version of Expo Go only runs the newest Expo SDK, and this project is on
> SDK 54. Tap *"Learn how to install Expo Go for SDK 54"* on that error screen
> and install that build instead. Uninstall the Play Store version first:
> Android refuses to install an older version of an app over a newer one.
> Then turn off Play Store auto-update for Expo Go, or it will quietly
> upgrade itself and the error comes back. The standalone APK above has no
> such problem, because it does not depend on Expo Go at all.

### Building the APK yourself

You shouldn't need to, since the workflow does it on every push. But if you want to:

- **On your own machine**, with Android Studio, the Android SDK and JDK 17 installed:
  ```bash
  npx expo prebuild --platform android    # generates the native android/ project
  cd android && ./gradlew assembleRelease
  # output: android/app/build/outputs/apk/release/app-release.apk
  ```
  `android/` and `ios/` are gitignored, so `prebuild` regenerates them. Don't hand-edit anything inside them.
- **With Expo's build service (EAS)**, which needs a free Expo account: `npx eas-cli build --profile preview --platform android`. The `preview` profile in `eas.json` produces an installable `.apk`; `production` produces an `.aab`, which is for Play Store upload only.

### Note on the On-Chain screen

mempool.space doesn't send browser CORS headers, so on-chain metrics are skipped on web and work only in native builds (Expo Go included). The screen explains this when you're on web.

---

## When the app says a data source is unavailable

```bash
yarn probe
```

Checks every external source the app uses, with the same URLs, and says for each one whether it responded and whether the response holds the data the app reads. Run it on the same network as your phone. It tells apart "the provider is down", "it's rate limiting or blocking you" and "it changed its response format", which the app on its own cannot.

The app's banner now gives the reason too, e.g. `(HTTP 403)`, `(timed out after 8s)` or `(could not connect)`. The probe also runs a second pass sending the same User-Agent as the Android app (`okhttp`), because some Cloudflare-fronted APIs let Node through but block that, so a source can pass the first pass and still fail on a phone.

## Testing

```bash
yarn test          # 123 tests, no install required
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
