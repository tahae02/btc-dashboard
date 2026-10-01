---
description: Review the paper trading record from the app. How well the app's advice, Claude's briefs and the owner's own calls have done, with sample sizes, and what if anything is worth changing.
argument-hint: "then paste the paper backup or the paper CSV from the app (Portfolio, Paper, Export backup or Export CSV)"
allowed-tools: Bash(TZ=Europe/London date:*), Bash(yarn paper-review:*), Bash(node --experimental-strip-types --no-warnings --import ./backtest/register.mjs scripts/paperReview.ts:*), Read, Write
---

What the owner sent with the command: `$ARGUMENTS`

The owner is in the UK, buys Bitcoin in pounds on Coinbase, and is not a trader. Write plain English, UK spelling, and never use an em dash anywhere in the reply. Keep it readable on a phone: short lines, and tables no wider than four columns.

## What you are reviewing

The app's paper trading (Portfolio tab, Paper) records decisions made with pretend money at real prices. Each one carries the full picture at that moment (signal tier, DCA multiplier, conviction, regime, Fear & Greed, RSI, volatility, the market price in GBP and USD), plus:

- **following**: whose call it was: `app`, `brief` (Claude's /btc-brief) or `own`.
- **why**: `routine` (regular buy day), `signalChange`, `bigMove`, `extremeMood`, `event`, `tempted` (about to trade for real), `other`.
- **usual_amount** and **app_suggested** (usual x DCA multiplier), and **vs_app**: `same` (within 5%), `more` or `less`.
- For brief decisions: **verdict** (BUY_NOW, WAIT, SPLIT), **confidence**, and the chances it gave of the price being lower after 24 hours, 48 hours and 7 days.
- Limit orders: limit price, the market price when placed, expiry, and whether they filled, ran out, were cancelled or could not be checked.
- Decisions not to buy (`no buy` in the CSV).
- The BTC/USD price 24 hours, 48 hours, 7, 30 and 90 days after each decision, recorded once known. In the CSV these are the `after_*_pct` columns: the % move from the decision's own price (for a limit order, from when it was placed). Blank means not reached yet.

## a) Get the data

Look for the export in the arguments, the same message, an attached file or the message before. It is either the **backup** (JSON containing `"kind": "paper"`) or the **CSV** (header starting `record,status,decided_utc`). If there is neither, stop and tell the owner where to get one: Portfolio, Paper, then Export backup (preferred, it reproduces the app's figures exactly) or Export CSV.

Run `TZ=Europe/London date` to know today's date.

**If it is the backup**, save it to a file in the scratchpad (or `/tmp`), then from the repository root run:

```
node --experimental-strip-types --no-warnings --import ./backtest/register.mjs scripts/paperReview.ts <file>
```

That prints the app's own scorecard (the same code as the "How the advice has done" card). Show it in one code block, unedited, then do the deeper analysis below from the raw records in the backup.

**If it is the CSV**, work from it directly, using the same rules as the app (below) so your figures match the card.

## b) The analysis

Every figure gets its sample size. Use the app's thresholds and say "too few to judge" below them: 5 buys in a group, 8 separate days for the even-spread comparison, 20 calls for Claude's chances. Consecutive decisions overlap: two buys a week apart share most of their 30-day move, so the honest count of independent 30-day results is about the span in days divided by 30, not the number of rows. Say so wherever it matters.

For any difference you report (one group against another), give a rough uncertainty: the standard error of each mean (standard deviation over the square root of n), and say plainly whether the gap is bigger than about two of those. Most gaps in the first year will not be, and saying so is the useful answer.

1. **Coverage.** Date range, number of decisions by type, by following and by why. Count the weeks with no `routine` decision: the regular buy day is the backbone of the record, and gaps in it bias everything towards exciting days. Flag a usual amount that keeps changing, and fees that look unlike the owner's real ones.
2. **Following the multiplier against spreading the money evenly.** The app's rule: one entry per UTC day however many decisions it held; a filled limit order counts on the day it was placed, at its limit price; an unfilled order is left out; a `no buy` day is a day the even buyer still buys on; before fees. Compare average price per BTC in pounds. This is the clearest test of whether varying the amount pays.
3. **The app's tiers.** Average 7 and 30-day move after buys on each signal tier, against all buys. The claim to check is ordering: higher tiers (ACCUMULATE HARD, ACCUMULATE) should be followed by better 30 and 90-day moves than lower ones. Compare with the app's own Track record on the Signals tab if the owner has shared it.
4. **Against the app, and whose call.** `same` against `more` and `less`, and `app` against `brief` against `own`, on 7 and 30-day moves. This is how the owner finds out whether departing from the advice has helped.
5. **Why.** Do the extra decisions (big moves, extreme fear or greed, events, tempted) do better or worse than routine ones?
6. **Claude's calls.** Per horizon: the Brier score (mean of (chance - outcome) squared, with chance as a fraction and outcome 1 if the price was lower) against 0.250 for always saying 50%. Then a reliability check in three buckets of the stated chance (under 45%, 45 to 55%, over 55%): how often was the price actually lower in each? Verdicts: was BUY_NOW followed by rises and WAIT by falls, over 24 hours and 7 days? Does high confidence beat low?
7. **Limit orders.** Fill rate, average saving against the price when placed, hours to fill, and for those that ran out, where the price finished against where it was placed. Split by how far below the market they were set (under 2%, 2 to 4%, over 4%) if there are enough.
8. **Real against paper**, if the owner also pastes the real trades CSV: average price per BTC paid, fees included, since the first paper decision.

## c) What to do about it

Sort recommendations into three groups, and be strict about evidence:

- **The habit.** Gaps in the regular buy day, too many extras clustered on exciting days, deleted or missing decisions, fees to update. These can change now.
- **Claude's /btc-brief.** It is a prompt (`.claude/commands/btc-brief.md`), so it can be changed directly. Only once there are 20 or more scored calls: if its chances are overconfident (score above 0.250, or the over-55% bucket comes true much less often than stated), propose a specific edit, such as pulling stated chances further towards 50%; if its limit orders rarely fill, propose setting them closer to the price; if they fill almost always, they may be too close to save anything. Draft the exact wording of the edit, but do not change the file unless the owner asks.
- **The app's signal engine.** Never change it on the strength of this record alone. That is a decision already made (see CLAUDE.md): two years of data hold fewer than two dozen independent months, so retuning from results would fit noise. If a tier looks consistently wrong with a reasonable sample, name the specific parameter in `DEFAULT_CONFIG` (`src/services/signalEngine.ts`) and the `yarn backtest --split` run that would test the change on a decade of real data. Only a change that holds up there is worth making.

Finish with the one or two things most worth doing before the next review, and when to run the next one (every three months, or after another 12 regular decisions, whichever comes later).

Style: direct, no disclaimers, UK English, no em dashes. Facts and interpretation kept apart. Do not invent numbers: if something cannot be worked out from the export, say what is missing.
