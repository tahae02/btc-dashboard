# ₿ BTC Dashboard — Bitcoin Investment Helper

A deep, professional-grade Bitcoin technical-analysis dashboard built with **React Native + Expo**. It pulls live market, sentiment, and on-chain data from **free public APIs (no API keys)** and computes all technical indicators and buy/sell signals **locally in JavaScript** — **no AI, no backend, no ongoing costs**.

> Built for personal use as a decision-support tool. Not financial advice.

---

## ✨ Features

### 📊 Dashboard
- Live BTC price, 24h change, market cap, volume, BTC dominance
- Overall signal badge: **STRONG BUY / BUY / NEUTRAL / SELL / STRONG SELL** with a confidence %
- Key-stats grid (Market Cap, Volume, Dominance, ATR volatility)
- Fear & Greed Index gauge

### 📈 Chart
- Interactive candlestick chart with **1H / 4H / 1D / 1W** timeframes
- Overlay toggles: EMA 9/21, SMA 50/200, Bollinger Bands, Volume
- Dedicated **RSI** and **MACD** sub-charts

### 🎯 Signals
- Rule-based signal engine combining **9 indicators** into one score
- Per-indicator status badge **with a plain-English explanation of *why*** it is bullish/bearish
- Bullish-vs-bearish breakdown, entry/exit suggestions from support & resistance

### ⛓️ On-Chain
- Network hash rate, difficulty, mempool congestion, fee estimates (via mempool.space)
- Fear & Greed deep dive, exchange volume

### ⚙️ Settings
- Refresh interval (manual / 1 min / 5 min)
- Currency toggle (USD / GBP)
- Adjustable RSI & volume alert thresholds
- Persisted with AsyncStorage

---

## 🧮 Technical Indicators (all computed locally)

| Indicator | Purpose |
|---|---|
| RSI (14) | Overbought (>70) / oversold (<30) |
| MACD (12/26/9) | Momentum & signal-line crossovers |
| Bollinger Bands (20, 2σ) | Volatility & squeeze detection |
| EMA 9 / 21, SMA 50 / 200 | Trend & Golden/Death Cross |
| Stochastic RSI | Momentum extremes |
| ATR | Volatility measure |
| Volume analysis | Above/below average volume |
| Support & Resistance | Auto-detected from recent highs/lows |

All math lives in `src/hooks/useIndicators.ts`; the signal scoring lives in `src/hooks/useSignalEngine.ts`.

---

## 🌐 Data Sources (free, no keys)

- **CoinGecko** — price, market data, historical OHLC
- **Alternative.me** — Fear & Greed Index
- **mempool.space** — on-chain network metrics & fees

All API calls are centralized in `src/services/api.ts`.

---

## 🛠️ Tech Stack

- React Native + Expo (managed workflow), TypeScript
- Expo Router (file-based routing under `app/`)
- react-native-gifted-charts for charts
- axios for networking
- AsyncStorage for settings persistence
- Context API for global state (`DataContext`, `SettingsContext`)

---

## 🚀 Getting Started

```bash
# install
yarn install

# run in the browser (web preview)
yarn expo start --web

# run on a device/emulator
yarn expo start
```

> Requires Node 18+ and Yarn. Uses the Expo SDK pinned in `package.json` — do not change the Expo major version.

---

## 📁 Project Structure

```
app/                     # Expo Router routes
  _layout.tsx            # root layout
  index.tsx              # entry redirect
  tabs/                  # bottom-tab screens
    index.tsx            # Dashboard
    chart.tsx            # Chart
    signals.tsx          # Signals
    onchain.tsx          # On-Chain
    settings.tsx         # Settings
src/
  components/            # GlassCard, SignalBadge, FearGreedGauge, SkeletonLoader, ...
  context/               # DataContext, SettingsContext
  hooks/                 # useIndicators, useSignalEngine, useMarketData
  services/              # api.ts (all external calls)
  constants/             # theme.ts
  types/                 # shared TypeScript types
assets/                  # icons & splash
```

---

## 🤖 Notes for AI agents / contributors

- **No backend.** Everything runs on-device. Do not introduce paid APIs or server dependencies without asking the owner.
- Indicator math and signal rules are intentionally transparent and local — extend them in `src/hooks/`.
- Keep the dark trading-terminal aesthetic defined in `src/constants/theme.ts`.
- See `UX_DESIGN.md` for the full design spec.

---

## ⚠️ Disclaimer

This app is a personal decision-support tool. It does **not** constitute financial advice. Crypto markets are volatile — do your own research.
