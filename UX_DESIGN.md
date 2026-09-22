# UX Specification — BTC Analyst

This describes what the app **currently does**. Anything not built yet is listed at the bottom under "Not implemented", rather than written in the present tense alongside things that exist. The previous version of this document specified a chart crosshair, pinch-to-zoom, panning and multi-series overlays, none of which were built — which made the spec worse than useless, because it read as a description of the app.

---

## Design language

Dark throughout (`#0A0A0F` background), glass-effect cards, monospace for all numeric data so figures line up between rows. Accent `#00D2FF`.

Colour carries meaning and is never the only carrier:

| Meaning | Colour | Also signalled by |
|---|---|---|
| Accumulate | green | the action label, the allocation bar |
| Hold | amber | the action label |
| Reduce / stand aside | red | the action label |
| Regime | separate amber-to-orange scale | an explicit `BULL +3/3` pill |

Regime uses its own scale rather than the buy/sell greens and reds, because a bear regime is a description of the market, not an instruction to panic.

---

## 1. Dashboard (`app/tabs/index.tsx`)

At-a-glance state. Scrollable, pull-to-refresh.

- **Header** — title, relative last-updated timestamp, manual refresh button.
- **Price card** — price in the selected currency, 24h change (absolute and %, green/red with ▲/▼), 24h high/low.
- **Advice card** — the centre of the screen, tappable through to Signals:
  - Market regime pill, with the score out of 3
  - Action label (`ACCUMULATE HARD` / `ACCUMULATE` / `HOLD` / `REDUCE` / `STAND ASIDE`) and conviction %
  - **Target Bitcoin allocation** as a percentage and a filled bar
  - A plain-English line about this period's contribution ("Consider 1.4× your usual contribution")
  - Before 200 closed bars exist, this card explains what it's waiting for instead of showing a signal computed from too little history
- **Disclaimer** — immediately below the advice, not buried in Settings. A user seeing an allocation recommendation should see the caveat in the same glance.
- **Stats grid** — market cap, 24h volume, BTC dominance, ATR volatility as a % of price.
- **Fear & Greed gauge** — semi-circular, red → amber → green, current value and classification.
- **Expected range** — 24h and 7d volatility bands, labelled as volatility rather than forecast.

## 2. Chart (`app/tabs/chart.tsx`)

- **Timeframe pills** — 1H / 4H / 1D / 1W, loaded on demand.
- **Notice when the chart timeframe differs from the signal timeframe.** These are deliberately independent, and the app says so rather than letting the user assume switching to 1H changes the signal. It previously did not, and nothing indicated it.
- **Candlestick chart** — horizontally scrollable, green/red bodies.
- **Overlay selector** — single-select: none, EMA 9, EMA 21, SMA 50, SMA 200, Bollinger upper, Bollinger lower. The selected series is drawn on the candles, index-aligned. It is single-select because the chart component accepts one overlay series; six independent checkboxes would promise more than it can render.
- **Current values card** — numeric readout of all moving averages and the Bollinger triplet.
- **RSI sub-chart** — 40-point sparkline with shaded overbought (top) and oversold (bottom) bands.
- **MACD histogram sub-chart** — 40 bars, green above zero, red below, scaled to the window's peak.

## 3. Signals (`app/tabs/signals.tsx`)

The full breakdown, and the screen that has to make the hierarchy legible.

- **Summary card** — regime pill, action badge, allocation bar, conviction and DCA multiplier side by side with one-line explanations of what each means, then the disclaimer.
- **Readings grouped by layer, in the order they apply:**
  1. Regime — sets the base allocation
  2. Stretch — adjusts within the regime
  3. Momentum — confirms or tempers
  4. Sentiment — contrarian, extremes only
  5. Context — does not affect the allocation
- **Every row states its own weight inline** (`±15% allocation`, `Context only`, `Primary`). This is the key change from the previous design, which listed nine equal-looking rows and so implied nine independent opinions that did not exist — three of which could never actually vote.
- Rows expand on tap to a plain-English explanation.
- **Levels & expected range** — nearest support and resistance with distance from spot, plus the 24h and 7d volatility bands.

## 4. On-Chain (`app/tabs/onchain.tsx`)

- Fear & Greed deep dive with yesterday / last week / last month comparison.
- Mempool congestion, recommended fees, hash rate, difficulty adjustment.
- On web, shows a notice explaining that mempool.space blocks browser CORS and these metrics need the native app.

## 5. Settings (`app/tabs/settings.tsx`)

- **Signal timeframe** — which candles the regime and allocation use.
- **Mean-reversion strength** — Off / Light / Moderate / Heavy, with an honest note that backtesting favoured Light and a pointer to `yarn backtest --sweep`.
- **Refresh interval** — manual / 1 min / 5 min.
- **Currency** — USD / GBP, with a note that it affects the headline price only.
- **RSI display bands** — validated as a pair. Entering an inverted or collapsed range shows an inline warning and red borders, and the values reset on save. Previously each field was validated alone, so oversold could exceed overbought and silently invert every RSI reading.
- **Reset to defaults.**
- **About** — accurate data sources (it previously credited CoinGecko, which the app does not use), and the full disclaimer.

---

## Loading, error and empty states

- **Loading** — skeleton placeholders matching the real layout, not spinners.
- **Partial failure** — a banner saying some sources are unavailable; whatever loaded still renders. Losing dominance or sentiment is a degraded view, losing the price is a broken one, and the two are reported differently.
- **Total failure** — a retry card.
- **Insufficient history** — the advice card says how many bars it has and how many it needs, rather than showing a signal computed from too little data.

## Accessibility

- Every interactive control has an `accessibilityLabel`.
- The overlay selector exposes `accessibilityRole="radio"` with selection state.
- Meaning is never carried by colour alone; every coloured element has a text label beside it.

---

## Not implemented

Listed honestly so nobody reads this document and expects them:

- Chart crosshair with an OHLCV tooltip on touch
- Pinch-to-zoom and panning on the chart (it scrolls horizontally only)
- Multiple simultaneous chart overlays
- Price or signal alerts, and any push notifications
- Haptic feedback
- Portfolio or holdings tracking
- Equity-curve visualisation of backtest results in the app (the backtest is CLI only)
