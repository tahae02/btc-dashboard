---
description: Short-term BTC buy-timing brief. Uses a snapshot pasted from the app (or runs one), researches the last 24 to 72 hours, and gives a straight call.
argument-hint: "[amount in GBP, optional] then paste the app's snapshot below it (optional)"
allowed-tools: Bash(yarn snapshot:*), Bash(yarn snapshot), Bash(yarn probe), Bash(node --experimental-strip-types --no-warnings --import ./backtest/register.mjs scripts/snapshot.ts:*), Bash(TZ=Europe/London date:*), WebSearch, WebFetch
---

What the owner sent with the command: `$ARGUMENTS`

- The amount they are thinking of buying, in GBP, is the number at the start (for example `500` or `£500`). If there is none, give the split as percentages of "your amount" instead of pounds.
- They may also have pasted a snapshot exported from the app (Settings, Share with Claude). It is plain text starting `BTC SNAPSHOT`, and it may be in the arguments above, in the same message, in an attached file, or in a message just before this one. Look in all of those.

The owner is in the UK, buys Bitcoin in pounds on Coinbase, and is not a trader. Write plain English, UK spelling, and never use an em dash anywhere in the reply.

## a) Snapshot

First run `TZ=Europe/London date` to know the time now.

**If the owner pasted a snapshot from the app**, use it as the snapshot. It was made on their phone with the app's own code, data and settings, so it is exactly what the app shows. Do not reprint it. Instead show a short summary in a code block: when it was taken and how old it is, the price in USD and GBP, Fear & Greed, the app's advice and target allocation, and any sources that failed.
- If it is more than 15 minutes old, get the current BTC price in USD and GBP from a web source (cite it with its time) and say how far the price has moved since the snapshot. Use the current price for entry zones and limit orders, and the snapshot for the indicators and signals.
- If it is more than 2 hours old, also run the live snapshot below. If that works, use the live one and say so; if not, carry on with the pasted one and flag its age next to every figure that depends on it.

**If there is no pasted snapshot**, from the repository root run:

```
node --experimental-strip-types --no-warnings --import ./backtest/register.mjs scripts/snapshot.ts
```

This is what `yarn snapshot` runs. Calling Node directly needs nothing installed (only Node 22.6 or later), whereas Yarn refuses to run scripts on a fresh clone until `yarn install` has run. It prints the BTC Analyst app's own reading: live price in USD and GBP, Fear & Greed, every indicator on closed bars of the signal timeframe, every layer of the signal engine with the rule and threshold behind it, the app's overall advice, and the same indicators on the other timeframes. It uses the app's default settings, not the owner's.

Show the owner the output in a single code block, unedited.

- If it exits non-zero or any source says FAIL, say in one line which sources failed and quote the "How to fix" line it printed. Carry on with whatever loaded. If the price itself failed, get the current BTC price in USD and GBP from a web source, cite it with its time, and say the app's signals are missing, which caps confidence at low. End the reply with one line telling the owner that next time they can export a snapshot from the app (Settings, Share with Claude, Share snapshot) and paste it under the command.

Either way:

- If Fear & Greed failed in the snapshot (it often does on the owner's phone), look up today's reading on the web and cite it. The app's engine ran without it; say whether it would have changed the advice (it only counts at 20 or below, or 80 or above).
- The app's signal is an allocation for a long-term buyer, not a price prediction, and its 24h and 7d ranges are volatility bands (ATR), not forecasts. Treat them that way and never call them predictions.
- The snapshot's supports and resistances come from closed bars. If it says the live price is already through a level, use the next one.

## b) Research what the app does not cover

Search the web (WebSearch, then WebFetch on the best pages) for the last 24 to 72 hours. Cover each of these, in one line each where there is something worth saying, and write "nothing notable found" for a category rather than padding it:

1. Breaking BTC and crypto news (hacks, exchange problems, large liquidations, big corporate or government buys or sells).
2. Macro: Fed and rate expectations (CME FedWatch), US CPI and PCE, jobs data, the dollar (DXY), US yields, oil, and equities (S&P 500 and Nasdaq futures). Bank of England if it matters for GBP/USD, since the owner buys in pounds.
3. Geopolitics that is moving risk assets.
4. Regulation and policy (US, UK FCA, EU).
5. Spot Bitcoin ETF flows: the last few days of net flows (Farside Investors publishes a daily table).
6. Derivatives: funding rates, open interest and its recent change, and where the large liquidation clusters sit above and below price (CoinGlass, or exchange public data from Binance, Bybit, OKX or Deribit). Say which way a squeeze is more likely.
7. On-chain flows: whale moves, exchange inflows and outflows, stablecoin supply changes (CryptoQuant, Glassnode, Whale Alert, Lookonchain, Arkham summaries).
8. Social sentiment beyond Fear & Greed (funding and long/short ratios, X and Reddit mood, Google Trends, Santiment if available).

Then list **scheduled events in the next 7 days** that could move BTC, with the day and UK time for each: FOMC decisions and minutes, Fed speakers, CPI, PCE, payrolls, jobless claims, GDP, BoE decisions, large options expiries (Deribit expiries are Fridays at 08:00 UTC, which is 09:00 UK time in summer and 08:00 in winter; the monthly one is the last Friday of the month), token unlocks or network events if relevant, and major regulatory deadlines. Convert US times carefully: US Eastern is normally 5 hours behind UK time, but only 4 hours behind for the few weeks each spring and autumn when one country has changed its clocks and the other has not.

Rules for the research:
- Every fact gets a source name and a date (and time if it matters), e.g. "(CoinDesk, 27 Sep 2026)".
- Keep facts and interpretation apart: state what happened, then give your read of it separately.
- Flag anything older than 72 hours as stale, and say plainly when a category could not be checked (page blocked, paywalled, no recent data).
- Do not invent numbers. If you cannot find a figure, say so.

## c) The call

Put this after the research. Verdict first, in exactly this order, as short bullet points:

- **Verdict:** BUY NOW, WAIT, or SPLIT (part now, part later).
- **Best entry:** a target price zone in USD and GBP, and the time window to aim for (for example later today, after a named event, over the weekend).
- **The plan:** if SPLIT or WAIT, exactly how to split the amount (in pounds when an amount was given) and the limit order prices to set, in GBP for Coinbase with USD alongside. Mention that limit orders on Coinbase Advanced usually cost less in fees than a simple buy. Say what to do if the limits are not filled by a stated time.
- **Short-term outlook:** the most likely direction, plus rough probabilities that the price will be lower than now 24 hours, 48 hours and 7 days from now (lower at that moment, not at some point before it: that is how the app's paper record scores them). Start from about 50% (Bitcoin is close to a coin flip over short horizons) and move away from it only as far as the evidence justifies; say briefly what moved it.
- **Key levels:** nearest support and resistance in USD and GBP, from the snapshot and the liquidation data.
- **Why:** a few lines on where the app's signals and the research agree or conflict.
- **Invalidation:** the specific price or event that would flip the call.
- **Confidence:** high, medium or low. If it is genuinely a coin flip, say so plainly rather than forcing a call.
- **For your paper log:** one line the owner can copy into a paper decision in the app (Portfolio, Paper, Paper buy, "Claude's brief"): the verdict, the confidence, the three chances above as whole percentages, and for a SPLIT or WAIT each limit order as amount, GBP price and expiry. Give expiries of 1, 2, 7 or 14 days, the choices the app's paper orders offer, and make the plan's "if not filled by" time match. For example: `Paper log: SPLIT · medium · lower 24h 55%, 48h 52%, 7d 48% · now £250 · limit £250 at £55,100, 2 days`.

Style rules for the whole reply:
- Be direct and decisive. No disclaimers, no "not financial advice", no reminders that AI can be wrong.
- Show prices in both USD and GBP. Use the GBP/USD rate implied by the snapshot's two BTC prices, or a cited rate if the snapshot failed.
- Flag stale or missing data where it is used.
- Keep sections (b) and (c) short enough to read on a phone: one line per point, no tables wider than a phone screen.
- UK English. No em dashes.

The owner will ask follow-up questions in this session. Keep the snapshot and research in mind for those, and re-run `yarn snapshot` if they ask for fresh numbers or more than about an hour has passed.
