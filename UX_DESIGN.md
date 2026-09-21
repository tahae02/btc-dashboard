# UX Specification — Bitcoin Investment Dashboard

## Screens

### 1. Dashboard Screen (`app/tabs/index.tsx`)
**Purpose:** At-a-glance overview of BTC market state, signal summary, and key metrics.

**Layout (scrollable, pull-to-refresh):**
- **Header Bar:** App title "BTC Analyst" left-aligned, last-updated timestamp right-aligned (relative: "2m ago"), manual refresh icon button
- **Hero Price Card:** Large glass-effect card spanning full width
  - BTC icon + "Bitcoin" label
  - Current price in large display font (28px), formatted with commas
  - 24h change: absolute $ and %, colored green (positive) or red (negative) with ▲/▼ arrow
  - 24h High / 24h Low in smaller text below
- **Signal Badge Card:** Horizontal card below hero
  - Overall signal text: "STRONG BUY" / "BUY" / "NEUTRAL" / "SELL" / "STRONG SELL"
  - Confidence percentage with thin progress bar
  - Color-coded: strong buy = bright green, buy = green, neutral = amber, sell = red, strong sell = deep red
  - Bullish vs Bearish indicator count (e.g., "6 Bullish · 2 Bearish · 1 Neutral")
  - Tap → navigates to Signals tab
- **Key Stats Grid:** 2×2 grid of small glass cards
  - Market Cap (formatted: $1.2T)
  - 24h Volume (formatted: $28.5B)
  - BTC Dominance (e.g., 54.2%)
  - ATR Volatility (e.g., $1,450)
- **Mini Indicators Row:** Horizontal scroll of compact indicator chips
  - Each chip: indicator name (RSI, MACD, StochRSI, BBands) + colored dot (green/red/amber) + value
  - Tap any chip → navigates to Signals tab
- **Fear & Greed Gauge:** Semi-circular gauge visualization
  - Gradient arc from red (0, Extreme Fear) through amber (50, Neutral) to green (100, Extreme Greed)
  - Needle pointing to current value, large number in center
  - Label below: "Extreme Fear" / "Fear" / "Neutral" / "Greed" / "Extreme Greed"
- **Price Projections Card:** Glass card
  - 24h projection range (low–high) with horizontal bar
  - 7d Bull / Base / Bear scenario prices in 3 columns
  - Next resistance ↑ and next support ↓ price levels
- **Footer spacer** for tab bar clearance

### 2. Chart Screen (`app/tabs/chart.tsx`)
**Purpose:** Full interactive candlestick chart with technical indicator overlays.

**Layout:**
- **Timeframe Switcher:** Horizontal row of pill buttons: 1H, 4H, 1D, 1W. Active pill filled with accent color.
- **Main Chart Area:** Takes ~50% of screen height
  - Candlestick chart (green body = bullish, red body = bearish)
  - Y-axis: price scale on right side
  - X-axis: date/time labels
  - Crosshair on touch: shows OHLCV data in a floating tooltip at top
  - Pinch-to-zoom horizontal (more/fewer candles visible)
  - Pan horizontally to scroll through history
- **Overlay Toggle Row:** Below chart, horizontal scroll of toggle chips
  - EMA 9 (yellow), EMA 21 (orange), SMA 50 (blue), SMA 200 (purple) — each toggleable
  - Bollinger Bands (semi-transparent teal fill between upper/lower)
  - Volume Bars (shown as bar chart at bottom of main chart area, colored by candle direction)
  - Support/Resistance lines (horizontal dashed lines at detected levels)
- **RSI Sub-Chart:** ~15% screen height below main chart
  - RSI line chart (0–100 scale)
  - Horizontal dashed lines at 30 (oversold, green zone below) and 70 (overbought, red zone above)
  - Current RSI value label
- **MACD Sub-Chart:** ~15% screen height below RSI
  - MACD line (blue), Signal line (orange)
  - Histogram bars (green above zero, red below)
  - Zero line
- **Chart Legend:** Small text row showing which overlays are active with color swatches

### 3. Signals Screen (`app/tabs/signals.tsx`)
**Purpose:** Detailed breakdown of every technical indicator's signal with explanations.

**Layout (scrollable):**
- **Overall Signal Header:** Large card at top
  - Signal text (e.g., "STRONG BUY") in large bold font, color-coded
  - Confidence bar with percentage
  - Entry suggestion price and Exit/Target suggestion price
  - "Based on X indicators" subtitle
- **Signal Summary Bar:** Horizontal bar showing proportion: green (bullish) | amber (neutral) | red (bearish)
  - Labels below: "X Bullish · Y Neutral · Z Bearish"
- **Indicator Signal List:** Each indicator as an expandable card
  - **Collapsed state:** Indicator name | Current value | Signal badge (BULLISH green / BEARISH red / NEUTRAL amber)
  - **Expanded state (tap to toggle):** 
    - WHY explanation text (1-2 sentences, e.g., "RSI at 32.4 is below 35, approaching oversold territory. Historically this suggests a potential bounce.")
    - Key thresholds shown (e.g., "Oversold < 30 | Overbought > 70")
  - Indicators listed in order:
    1. RSI (14) — value, overbought/oversold status
    2. MACD (12/26/9) — histogram direction, signal line crossover status
    3. Stochastic RSI — value, overbought/oversold
    4. Bollinger Bands — price position relative to bands, squeeze status
    5. EMA 9/21 Crossover — cross direction, trend
    6. SMA 50/200 (Golden/Death Cross) — cross status, trend
    7. Volume Analysis — above/below 20-period average, trend confirmation
    8. ATR (14) — current volatility vs average, expanding/contracting
    9. Support & Resistance — proximity to nearest levels
- **Price Targets Card:** Bottom card
  - Next Resistance (price + % away)
  - Next Support (price + % away)
  - 24h Range Projection
  - 7d Bull / Base / Bear targets

### 4. On-Chain Screen (`app/tabs/onchain.tsx`)
**Purpose:** Blockchain network health and sentiment deep dive.

**Layout (scrollable, pull-to-refresh):**
- **Section: Fear & Greed Deep Dive**
  - Large gauge (same as dashboard but bigger)
  - Historical Fear & Greed line chart (30 days) with colored zones
  - "Yesterday" / "Last Week" / "Last Month" values in a row
- **Section: Network Stats** (glass cards)
  - Hash Rate: value + trend arrow (formatted: "620 EH/s")
  - Difficulty: current value + next adjustment estimate
  - Mempool Size: transaction count + congestion indicator badge ("Low" green / "Medium" amber / "High" red)
  - Estimated fee rates: Low / Medium / High priority in sat/vB
- **Section: Market Metrics**
  - BTC Dominance: percentage + mini sparkline (7d)
  - 24h Exchange Volume: formatted value
  - Market Cap: formatted value
  - Circulating Supply: formatted with % of 21M max

### 5. Settings Screen (`app/tabs/settings.tsx`)
**Purpose:** User preferences for data refresh, alerts, and display.

**Layout (scrollable):**
- **Section: Data Refresh**
  - Refresh Interval: segmented control — Manual / 1 min / 5 min
  - Current status: "Auto-refreshing every 5 min" or "Manual refresh only"
- **Section: Display**
  - Price Currency: segmented control — USD / GBP
  - (Currency conversion applied to all price displays throughout app)
- **Section: Alert Thresholds**
  - RSI Overbought threshold: numeric input (default 70)
  - RSI Oversold threshold: numeric input (default 30)
  - Volume spike multiplier: numeric input (default 1.5x)
  - These thresholds affect signal calculations and indicator highlights
- **Section: About**
  - App version
  - Data sources: "CoinGecko · Alternative.me · Mempool.space"
  - Disclaimer text: "This app is for informational purposes only. Not financial advice."
- All settings persisted to AsyncStorage and loaded on app start via a SettingsContext

## Navigation

**Structure:** Bottom tab navigation with 5 tabs. No authentication required (frontend-only app).

**File Structure:**
```
app/
  _layout.tsx          — Root layout, wraps app in SettingsProvider + DataProvider, renders <Slot />
  tabs/
    _layout.tsx         — <Tabs> with 5 tabs, frosted glass tab bar
    index.tsx           — Dashboard (tab icon: home/dashboard)
    chart.tsx           — Chart (tab icon: candlestick/chart)
    signals.tsx         — Signals (tab icon: signal/pulse)
    onchain.tsx         — On-Chain (tab icon: link/chain)
    settings.tsx        — Settings (tab icon: gear/cog)
```

**Tab Bar Styling:**
- Frosted glass background (semi-transparent #12121A with blur)
- Active tab: accent color (#00D2FF) icon + label
- Inactive tab: muted gray (#666) icon + label
- 5 tabs: Dashboard, Chart, Signals, On-Chain, Settings

**Navigation Flows:**
- App opens → Dashboard tab (default)
- Tap Signal Badge on Dashboard → switches to Signals tab
- Tap indicator chip on Dashboard → switches to Signals tab
- All tabs are top-level, no nested stack navigation needed
- Pull-to-refresh available on Dashboard, Chart, On-Chain

## Design Direction

**Theme:** Dark, professional trading terminal aesthetic
- Background: #0A0A0F (near-black with slight blue tint)
- Card surfaces: #12121A with subtle border #1E1E2A
- Elevated surfaces: #1A1A28

**Color Palette:**
- Primary accent: #00D2FF (electric cyan/teal)
- Bullish/positive: #00E676 (bright green)
- Bearish/negative: #FF1744 (bright red)
- Neutral/warning: #FFB300 (amber)
- Text primary: #E8E8F0 (soft white)
- Text secondary: #8888A0 (muted lavender-gray)
- Text tertiary: #555570

**Color Application:**
- Gradient accents on signal badges: linear gradient from primary to slightly shifted hue
- Glass cards using semi-transparent backgrounds with 1px border
- Price change colors: green for up, red for down, consistently everywhere
- Gauge gradients: red → amber → green arc
- Chart candles: #00E676 body/wick bullish, #FF1744 body/wick bearish

**Typography:**
- Display/Headings: "Orbitron" (Google Font) — techy, trading-terminal feel
- Body/Data: "Inter" or "Roboto Mono" for numeric data — clean, monospaced numbers for alignment
- Type scale: Display 32px → Heading 22px → Subheading 18px → Body 16px → Caption 12px → Mono Data 14px
- Price displays use tabular/monospace figures for digit alignment

**Backgrounds:**
- Main background: solid #0A0A0F
- Subtle radial gradient overlay on Dashboard hero area (dark blue to transparent)
- Cards: flat dark with 1px border, no heavy gradients on cards to keep data readable

## Animation & Motion

- **Screen transitions:** Smooth cross-fade between tabs (default tab transition)
- **Pull-to-refresh:** Custom refresh indicator with accent color spinner
- **Loading states:** Skeleton shimmer on all cards during initial load and refresh. Shimmer color: #1A1A28 → #252538 → #1A1A28
- **Price updates:** Number ticker animation when price changes (digits roll)
- **Signal badge:** Subtle pulse glow animation on the signal badge color
- **Gauge needle:** Animated rotation to current value on load (spring easing)
- **Indicator chips:** Staggered fade-in on Dashboard load
- **Chart:** Smooth transitions when switching timeframes (candles fade/slide)
- **Expandable cards (Signals):** Height animation with content fade-in on expand
- **Tab switching:** Haptic feedback (light) on tab press (skip on web)
- **Respect reduced motion:** Disable animations when system preference is set

## Component Standards

- **Glass Cards:** borderRadius 16, backgroundColor rgba(18,18,26,0.8), borderWidth 1, borderColor rgba(255,255,255,0.06)
- **Signal Badges:** borderRadius 8, bold text, colored background with 20% opacity + colored text
- **Toggle Chips (Chart overlays):** borderRadius 20, pill shape, outlined when off, filled when on
- **Segmented Controls (Settings):** react-native-paper SegmentedButtons styled to match theme
- **Numeric Inputs:** Dark input fields with accent border on focus, validation for numeric ranges
- **Gauge Component:** Custom SVG semi-circle with animated needle
- **Skeleton Loading:** Applied to every card shape, matching card dimensions
- **Empty/Error States:** "Unable to fetch data" message with retry button, accent-colored
- **Timestamps:** Relative format ("2m ago") with absolute on long-press or tooltip
- **Spacing:** 8pt grid throughout. Screen horizontal padding: 16px. Card gap: 12px.
- **Accessibility:** All charts have accessible labels summarizing data. Touch targets 44pt+. Contrast ratios maintained.

## Data Architecture (Context + Hooks)

**SettingsContext:**
- `refreshInterval`: 'manual' | '1min' | '5min'
- `currency`: 'USD' | 'GBP'
- `rsiOverbought`: number (default 70)
- `rsiOversold`: number (default 30)
- `volumeSpikeMultiplier`: number (default 1.5)
- Persisted to AsyncStorage, loaded on mount

**DataContext / useMarketData hook:**
- Fetches from CoinGecko, Alternative.me, Mempool.space
- Stores: price data, OHLCV history, fear & greed, on-chain metrics
- Auto-refresh based on settings interval (useEffect with setInterval)
- `isLoading`, `lastUpdated`, `error` states
- `refresh()` function for manual pull-to-refresh

**useIndicators hook:**
- Takes OHLCV data, computes all technical indicators locally
- Returns: RSI, MACD, Bollinger Bands, EMAs, SMAs, StochRSI, ATR, support/resistance levels
- Memoized with useMemo to avoid recalculation on every render

**useSignalEngine hook:**
- Takes indicator values + settings thresholds
- Returns: overall signal, confidence %, individual indicator signals with explanations, entry/exit suggestions, projections
- Pure rule-based logic, no external calls

## External API Calls (all public, no keys needed)

1. **CoinGecko:**
   - `GET https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd,gbp&include_market_cap=true&include_24hr_vol=true&include_24hr_change=true&include_last_updated_at=true`
   - `GET https://api.coingecko.com/api/v3/coins/bitcoin?localization=false&tickers=false&community_data=false&developer_data=false`
   - `GET https://api.coingecko.com/api/v3/coins/bitcoin/ohlc?vs_currency=usd&days={1|7|30|180}` (maps to 1H/4H/1D/1W)
   - `GET https://api.coingecko.com/api/v3/global` (for BTC dominance)

2. **Alternative.me:**
   - `GET https://api.alternative.me/fng/?limit=31&format=json` (current + 30 days history)

3. **Mempool.space:**
   - `GET https://mempool.space/api/v1/mining/hashrate/1m` (hash rate)
   - `GET https://mempool.space/api/v1/difficulty-adjustment` (difficulty)
   - `GET https://mempool.space/api/mempool` (mempool stats)
   - `GET https://mempool.space/api/v1/fees/recommended` (fee estimates)
