/**
 * Plain-English explanations of every term the app shows.
 *
 * Written for someone who owns Bitcoin but has never traded: each entry says
 * what the thing is, then what it tends to mean in practice. Where a reading
 * is commonly over-sold (RSI "sell signals", Fear & Greed as a timing tool),
 * the entry says so, because a beginner is exactly who gets hurt by that.
 */

export interface GlossaryEntry {
  title: string;
  /** What it is, in a sentence or two. */
  what: string;
  /** How to read it, and what it tends to mean for the price. */
  read: string;
  /** How this app uses it, where that is worth knowing. */
  app?: string;
}

export const GLOSSARY = {
  // ===== The advice =====
  action: {
    title: 'The advice (Accumulate hard, Hold…)',
    what: "The app's overall suggestion for how much to buy right now, from most to least keen: ACCUMULATE HARD, ACCUMULATE, HOLD, REDUCE, STAND ASIDE.",
    read:
      'ACCUMULATE HARD: conditions look favourable, buy more than usual. ACCUMULATE: buy a bit more than usual. ' +
      'HOLD: no strong view, stick with your usual amount. REDUCE: buy less than usual. STAND ASIDE: conditions ' +
      'look poor, consider pausing your buys.',
    app: 'It is built for someone buying regularly over years, not for day trading. It reads past prices; it cannot see news or the future.',
  },
  regime: {
    title: 'Market regime (Bull, Neutral, Bear)',
    what:
      "The app's read of the long-term trend. BULL is an uptrend, BEAR a downtrend, NEUTRAL no clear trend. The score " +
      '(from -3 to +3) counts three checks: is the price above its 200-day average, is the 50-day average above the ' +
      '200-day, and is the 200-day average rising?',
    read:
      '+3/3 means all three checks point up. The regime changes slowly on purpose, usually over weeks or months, so ' +
      'a single bad day does not flip it. It is the biggest single input to the advice.',
  },
  targetAllocation: {
    title: 'Target Bitcoin allocation',
    what: 'Of the money you have set aside for Bitcoin, how much the app suggests actually having in Bitcoin right now, from 0% to 100%.',
    read:
      '94% means: of your Bitcoin pot, hold about 94% as Bitcoin and 6% as cash. It moves slowly with the trend. ' +
      'You decide how big the pot is; the app never knows your finances.',
  },
  dcaMultiplier: {
    title: 'DCA multiplier (1.6× your usual)',
    what:
      'DCA, or dollar-cost averaging, means buying a fixed amount on a regular schedule, whatever the price. The ' +
      'multiplier scales that usual amount up or down.',
    read:
      '1.0× means buy your usual amount. 1.6× means 60% more than usual (£160 if you normally buy £100). 0.5× means ' +
      'half, keeping the rest as cash for later.',
    app: 'The Track record on the Signals tab checks whether following the multiplier has actually bought Bitcoin more cheaply.',
  },
  conviction: {
    title: 'Conviction',
    what: "How much the app's separate readings (the long-term trend, how stretched the price is, and momentum) agree with each other, from 0 to 100%.",
    read:
      'High means they point the same way, so the advice is clearer. Low means they disagree, so treat the advice as ' +
      'less certain. It is NOT the chance that the price will go up.',
  },

  bullishBearish: {
    title: 'Bullish and bearish',
    what: 'Bullish means pointing towards prices rising; bearish means pointing towards prices falling. A "bull market" is a long rise, a "bear market" a long fall.',
    read:
      'On the Signals tab, each reading is marked BULLISH (it supports buying) or BEARISH (it argues for buying ' +
      'less). They often disagree: a price can be in a long-term uptrend (bullish) and have run up too fast this ' +
      'week (bearish) at the same time. Only the long-term trend can set the overall direction.',
  },

  // ===== Indicators =====
  movingAverages: {
    title: 'Moving averages (SMA, EMA)',
    what:
      'The average closing price over the last N candles, recalculated every period, which smooths out day-to-day ' +
      'noise. An SMA (simple moving average) weights every day equally; an EMA (exponential) gives more weight to ' +
      'recent prices, so it reacts faster.',
    read:
      'Price above a rising average suggests an uptrend. The 200-day is the most watched long-term line, the 50-day ' +
      'is medium-term, and the 9 and 21 EMAs are short-term. When the 50-day crosses above the 200-day it is called a ' +
      '"golden cross"; below is a "death cross". Both are slow and often late.',
  },
  rsi: {
    title: 'RSI (Relative Strength Index)',
    what: 'A score from 0 to 100 comparing the size of recent up-moves with recent down-moves, over the last 14 candles.',
    read:
      'Above 70 is called "overbought" (it has risen fast), below 30 "oversold" (it has fallen fast). It is not a ' +
      'buy or sell signal on its own: in a strong uptrend RSI can sit above 70 for weeks while the price keeps ' +
      'climbing. Read it as "how stretched is this move?"',
  },
  stochRsi: {
    title: 'StochRSI',
    what: 'A faster, jumpier version of RSI: where RSI currently sits within its own recent range, from 0 to 100.',
    read: 'Above 80 or below 20 are the stretched zones. It flips often, so on its own it gives lots of false alarms.',
    app: 'The app only uses it blended with RSI and Bollinger Bands, as part of "Price stretch".',
  },
  bollinger: {
    title: 'Bollinger Bands',
    what:
      'Three lines on the chart: a 20-candle average in the middle, with a band above and below it. The bands sit ' +
      'two "standard deviations" away, which roughly marks the range the price usually stays within.',
    read:
      'Near the upper band, the price is high compared with its recent range; near the lower band, low. The bands ' +
      'widen when the market is jumpy and narrow when it is quiet. A long, tight squeeze often comes before a big ' +
      'move, but it does not tell you which direction.',
  },
  macd: {
    title: 'MACD',
    what:
      'Short for Moving Average Convergence Divergence. It tracks the gap between a fast (12-candle) and a slow ' +
      '(26-candle) average. The histogram bars show whether that gap is growing or shrinking.',
    read:
      'Green bars above the middle line mean upward momentum; taller bars mean it is strengthening, shrinking bars ' +
      'that it is fading. Red bars below mean downward momentum. It lags behind the price, so it confirms moves ' +
      'rather than predicting them.',
  },
  stretch: {
    title: 'Price stretch',
    what:
      "The app's combined reading of RSI, StochRSI and Bollinger Bands: how far the price has run up or down " +
      'compared with its recent range, from -100% to +100%.',
    read:
      'Positive means it has run up quickly; negative means it has sold off quickly. After a big run-up, prices ' +
      'often pause or pull back; after a sharp fall, they often bounce. Often, not always.',
    app: 'The app buys a little less after run-ups and a little more after sell-offs, but never enough to override the long-term trend.',
  },
  momentum: {
    title: 'Momentum',
    what: "The app's combined reading of MACD and the gap between the 9 and 21 EMAs: whether recent moves are speeding up or slowing down.",
    read: 'Positive means the move up is gaining pace; negative means moves down are gaining pace. Around zero, there is no clear push either way.',
    app: 'It only confirms or softens the trend call, and can move the target allocation by at most 10 points.',
  },
  atr: {
    title: 'Volatility (ATR)',
    what:
      'Average True Range: the typical size of one candle\'s move, from its high to its low, over the last 14 ' +
      'candles. On the daily chart, 3.8% means a typical day spans about 3.8% of the price.',
    read:
      'Higher means bigger swings, in both directions. It says nothing about which way the price will go. It helps ' +
      'you tell a normal day from an unusual one, so a move within the normal range is no reason to panic.',
  },
  supportResistance: {
    title: 'Support and resistance',
    what:
      'Support is a price where recent falls stopped and bounced. Resistance is where recent rises stalled. They ' +
      'come from recent turning points on the chart.',
    read:
      'Prices often pause near these levels, partly because so many traders watch them. But they break regularly. ' +
      'Treat them as landmarks, not walls.',
  },
  expectedRange: {
    title: 'Expected range (next 24h, next 7d)',
    what: "The range the price would typically move within over the next day or week, based on how much it has been moving lately (the ATR). It is not a prediction of direction.",
    read:
      'Roughly two thirds of the time, the price should end up inside the range. Finishing outside it means an ' +
      'unusually big move. The Track record on the Signals tab checks how often that has really held.',
  },

  // ===== Market =====
  fearGreed: {
    title: 'Fear & Greed Index',
    what:
      'A score from 0 to 100 for how nervous or excited the crypto market is, published daily by Alternative.me. It ' +
      'blends price swings, momentum, trading volume, social media and search trends.',
    read:
      'Low means fear, high means greed, around 50 neutral. It is often read the opposite way round: extreme fear has ' +
      'more often come near low points, when people sell in a panic, and extreme greed near peaks. But it can stay ' +
      'extreme for weeks, so it is a poor timing tool on its own.',
    app: 'The app only lets it nudge the advice at the extremes (below 20 or above 80), and only slightly.',
  },
  dominance: {
    title: 'BTC dominance',
    what: "Bitcoin's share of the total value of all cryptocurrencies combined.",
    read:
      'Rising dominance means money is favouring Bitcoin over other coins, which often happens in nervous markets. ' +
      'Falling means money is flowing into other coins. It says little about Bitcoin\'s own price direction.',
  },
  marketCap: {
    title: 'Market cap',
    what: 'The price of one bitcoin multiplied by the number of bitcoins in existence: the value of the whole Bitcoin market.',
    read: 'Useful for comparing size with other assets. On its own it does not tell you whether Bitcoin is cheap or expensive.',
  },
  volume: {
    title: '24h volume',
    what: 'The value of Bitcoin traded in the last 24 hours. Here it is trading on Kraken, one large exchange, not the whole market.',
    read: 'Price moves on high volume are generally taken more seriously than moves on thin volume, which are easier to push around.',
  },
  supply: {
    title: 'Circulating supply',
    what:
      'How many bitcoins exist so far. There will never be more than 21 million; new ones go to miners on a schedule ' +
      'that halves roughly every four years.',
    read: 'About 95% have already been created. The fixed supply is a big part of why people hold Bitcoin long term.',
  },

  // ===== Network =====
  hashRate: {
    title: 'Hash rate',
    what: 'The total computing power miners are putting into securing the Bitcoin network.',
    read: 'Rising hash rate means miners are investing in the network, a sign of health. It has little short-term link to the price.',
  },
  difficulty: {
    title: 'Mining difficulty',
    what:
      'How hard it is to mine a new block. Bitcoin adjusts it every 2,016 blocks (about two weeks) so blocks keep ' +
      'arriving roughly every 10 minutes, however many miners join or leave.',
    read: 'A rise means more mining power has joined. It is a network-health figure, not a price signal.',
  },
  mempool: {
    title: 'Mempool',
    what: 'The queue of Bitcoin transactions waiting to be confirmed.',
    read: 'A long queue means the network is busy and sending fees go up. It matters when you move Bitcoin off an exchange; it does not predict the price.',
  },
  fees: {
    title: 'Network fees (sat/vB)',
    what:
      'What it currently costs to send a Bitcoin transaction, in satoshis per virtual byte. A satoshi is a ' +
      'hundred-millionth of a bitcoin. High gets confirmed fastest; low can take an hour or more.',
    read: 'Only relevant when you withdraw or send Bitcoin. A typical simple transaction is about 140 vB, so 10 sat/vB costs about 1,400 satoshis.',
  },

  // ===== Charts and your portfolio =====
  candles: {
    title: 'Candlestick chart',
    what:
      'Each candle is one period (an hour, a day, a week). The thick body runs from the opening to the closing ' +
      'price; the thin lines, called wicks, show the highest and lowest points.',
    read: 'Green: it closed higher than it opened. Red: it closed lower. Long wicks mean the price swung a lot within that period.',
  },
  timeframe: {
    title: 'Timeframe (1H, 4H, 1D, 1W)',
    what: 'How long each candle covers: one hour, four hours, one day or one week.',
    read: 'Short timeframes show a lot of noise; long ones show the bigger picture. The signal uses daily candles unless you change it in Settings.',
  },
  averageCost: {
    title: 'Average cost',
    what: 'What you have paid per bitcoin on average, fees included: the total you put in, divided by the bitcoin you hold.',
    read:
      "If today's price is above your average cost, you are in profit overall. Buying below your average cost " +
      'brings it down. The second figure converts it into the other currency at today\'s exchange rate, so you can ' +
      'compare it with the charts, which are in dollars.',
  },
  tradeOutcomes: {
    title: 'After each trade (1d, 7d, 30d, 90d later)',
    what: "How Bitcoin's market price moved 1, 7, 30 and 90 days after each trade. Green means it moved your way: up after a buy, down after a sell.",
    read:
      'Moves over a day or a week are mostly luck. For a regular buyer, the 30 and 90-day columns matter more, and ' +
      'even those only mean something across many trades.',
  },
  trackRecord: {
    title: 'Track record',
    what: 'The app replays its own advice on each past day, using only prices it could have known then, and checks what the price did next.',
    read:
      'If ACCUMULATE HARD days were followed by better returns than an average day, the signal has been adding ' +
      'something. Dimmed rows have too little data to judge. Past results do not guarantee future ones.',
  },
} satisfies Record<string, GlossaryEntry>;

export type GlossaryKey = keyof typeof GLOSSARY;

/** How the full guide is grouped. */
export const GLOSSARY_SECTIONS: { title: string; keys: GlossaryKey[] }[] = [
  { title: 'The advice', keys: ['action', 'regime', 'targetAllocation', 'dcaMultiplier', 'conviction', 'bullishBearish'] },
  {
    title: 'Indicators',
    keys: ['movingAverages', 'rsi', 'stochRsi', 'bollinger', 'macd', 'stretch', 'momentum', 'atr', 'supportResistance', 'expectedRange'],
  },
  { title: 'The market', keys: ['fearGreed', 'dominance', 'marketCap', 'volume', 'supply'] },
  { title: 'The Bitcoin network', keys: ['hashRate', 'difficulty', 'mempool', 'fees'] },
  { title: 'Charts and your portfolio', keys: ['candles', 'timeframe', 'averageCost', 'tradeOutcomes', 'trackRecord'] },
];
