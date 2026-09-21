# BTC Investment Dashboard

A deep, no-AI Bitcoin investment dashboard built with **React Native + Expo** (TypeScript). All technical analysis is computed **locally in JavaScript** — there are no AI runtime costs and no paid API keys. Live market data comes from **free, CORS-friendly public APIs**.

## Features

- **Live BTC price** in USD and GBP (Kraken public API)
- **Interactive candlestick / line chart** with multiple timeframes (1H, 4H, 1D, 1W)
- **Locally computed technical indicators**: RSI, MACD, EMA/SMA moving averages, Bollinger Bands, Stochastic, ATR, and more
- **Composite Buy / Hold / Sell signal** derived from the indicator stack
- **Market context**: BTC dominance, market cap, Fear & Greed Index
- **On-chain metrics** (mempool, fees, hashrate) via mempool.space — *native builds only* (blocked by CORS in the web preview)
- **Modern dark UI**, responsive across iOS / Android / Web

## Data Sources (all free, no keys)

| Data | Source |
|------|--------|
| Price (USD + GBP) & OHLC candles | Kraken public API (`api.kraken.com`) |
| BTC dominance | CoinPaprika (`api.coinpaprika.com`) |
| Fear & Greed Index | Alternative.me |
| On-chain (native only) | mempool.space |

Market cap is derived locally as `price × circulating supply`.

## Getting Started

```bash
yarn install
yarn expo start
```

- Press `w` for web, or run on a device/emulator.
- Note: on-chain metrics are gated to native (iOS/Android) because mempool.space blocks browser CORS. The On-Chain screen shows a notice in the web preview.

## Tech Notes

- **Frontend-only** — no backend, no database, no server costs.
- Data fetching lives in `src/services/api.ts` with a short-lived in-memory cache, in-flight request dedup, and retry-with-backoff.
- Market data orchestration is in `src/hooks/useMarketData.ts`.
- All indicator math is in `src/services/` (pure functions, no external services).

## License

See `LICENSE`.
