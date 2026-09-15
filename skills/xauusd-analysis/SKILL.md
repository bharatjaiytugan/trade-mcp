---
name: xauusd-analysis
description: Full multi-timeframe XAUUSD/Gold analysis — structure, liquidity, S/R, indicators as confirmation only, macro/news context, and a validated trade setup (or NO TRADE). Trigger words — ANALISIS, ANALYZE, CEK GOLD, CHECK GOLD, SETUP, UPDATE — when the user is asking about gold/XAUUSD specifically.
---

# XAUUSD Multi-Timeframe Analysis

This is a decision-support workflow, not a signal generator. **NO TRADE is a valid and often
preferred output.** Never force a BUY/SELL because the user asked for "analisis" — quality of
setup matters more than producing one every time.

## Step 0 — Check the previous setup first (never skip this)

Before doing anything else, call `journal_get_open` (filter by the symbol, e.g. `OANDA:XAUUSD`).

- If an ACTIVE entry exists: pull fresh price/OHLCV since its `created_at` and determine whether
  price has hit `sl`, `tp1`, `tp2`, or `tp3` since then. Report this explicitly to the user
  *before* presenting new analysis — do not silently replace an old setup with a new one. If
  resolved, call `journal_update_status` with the correct status and a `result_r` you compute
  yourself: `result_r = (exit - entry) / risk` for LONG, `(entry - exit) / risk` for SHORT
  (`risk` is stored on the record). If still open, say so and note current unrealized R.
- If nothing is open, say so briefly and continue.

## Step 1 — Gather real data (no invented numbers)

Use whatever is actually connected. If TradingView/CDP is unreachable, say
**"REAL-TIME DATA UNAVAILABLE"** explicitly and lower confidence accordingly — never fill the gap
with assumptions.

Per timeframe you analyze, pull:
- `data_get_ohlcv` (enough bars to see recent swing structure — 50-100 is usually enough)
- `data_get_study_values` for whatever indicators are already on the chart (add RSI/MACD via
  `chart_manage_indicator` if not present — full names only, e.g. "Relative Strength Index")
- `quote_get` for the live price

## Step 2 — Multi-timeframe hierarchy

Default set for XAUUSD (adjust if the user asks for something narrower/wider): **D → 1H → 15M →
5M**. Add W/Monthly for a swing-horizon question, or 1M for scalping — don't fetch a timeframe
that isn't relevant to the question being asked.

Priority: **higher timeframe = directional context, lower timeframe = entry timing.** If a higher
timeframe is bullish but a lower timeframe prints a bearish move, do NOT immediately call SHORT —
first work out whether the lower-TF move is a normal pullback, a liquidity sweep, or a genuine
reversal (does it break a higher-TF swing low with a closed candle, not just a wick?). Only treat
it as reversal when there's real structural evidence, not just one or two red candles.

For each timeframe analyzed, fill a row (numbers only where you actually have data — `n/a` for
anything not fetched):

| TIMEFRAME | TREND | STRUCTURE | LIQUIDITY | MOMENTUM | BIAS |
|---|---|---|---|---|---|

- **TREND**: read off actual swing highs/lows in the OHLCV you pulled — HH/HL (bullish), LH/LL
  (bearish), or ranging.
- **STRUCTURE**: note BOS (break of structure — a close beyond the prior swing in the trend
  direction) or CHOCH (change of character — the first break against the prevailing trend).
- **LIQUIDITY**: obvious untested equal highs/lows, session high/low, previous day/week high/low —
  only if visible in the fetched bars, don't guess.
- **MOMENTUM**: RSI/MACD reading from `data_get_study_values`, described plainly (e.g. "RSI 53,
  neutral-bullish; MACD bullish cross") — never let this alone drive the bias (see Step 4).
- **BIAS**: bullish / bearish / neutral for *that timeframe only*.

## Step 3 — Market regime

Classify the overall condition before setup-hunting: strong bullish trend / weak bullish trend /
range / accumulation / distribution / strong bearish trend / weak bearish trend / high-volatility
/ news-driven / unclear-unstable. **Do not trade aggressively in an unclear regime** — that alone
can be a reason for WAIT/NO TRADE regardless of what indicators say.

## Step 4 — Indicators are confirmation, not the thesis

RSI > 70 does not automatically mean SELL. RSI < 30 does not automatically mean BUY. A MACD
crossover alone does not create a trade. Structure and liquidity come first; indicators either
support or weaken that structural thesis. **If an indicator is diverging from the direction you're
about to propose (e.g. histogram shrinking right as you're about to call trend continuation),
treat that as a reason to downgrade toward WAIT/NO TRADE** — do not mention the divergence and
then issue the setup anyway (this is the exact mistake that got corrected earlier this project).

## Step 5 — Support/Resistance ranking

Rank every level you cite:
- **A = major** (confluence across 2+ timeframes, or a level tested 3+ times)
- **B = important** (clear swing point on the entry/intermediate timeframe)
- **C = minor** (local/short-term only)

Don't invent round-number levels that aren't backed by an actual printed high/low.

## Step 6 — Macro & news

- Macro (DXY/yields): `quote_get({ symbol: "TVC:DXY" })` and `quote_get({ symbol: "TVC:US10Y" })`
  work directly — TradingView carries them as regular symbols (confirmed working). Pulling these
  switches the active chart briefly and restores it, same as any other cross-symbol `quote_get`
  call. Never assume "DXY down = gold must go up" — state the actual correlation context (e.g.
  both moving together suggests a broader risk move, not a clean inverse) rather than asserting
  a guaranteed relationship.
- News: use `WebSearch` for upcoming high-impact events (CPI, Core CPI, PCE, NFP, FOMC/Fed
  decision, Powell speeches, PPI, GDP, Retail Sales, ISM, jobless claims, geopolitical events).
  Report event, date/time (converted to the user's timezone if known), expected/previous/actual
  if released, impact level, and time remaining until it.
- For each significant upcoming event, sketch scenario A (actual > expected), B (actual <
  expected), C (in line) and the *directionally plausible* (never guaranteed) effect on gold.
- **News risk rule**: if high-impact news is imminent, default to WAIT unless there's a
  specifically tested news-trading approach the user has asked for. After the release, wait for
  the initial spike to settle, a candle close, and ideally a retest before proposing an entry —
  don't chase the first move.

## Step 7 — Setup detection & entry validation

Look for one of: trend continuation, pullback, breakout+retest, liquidity-sweep+reversal, support
rejection, resistance rejection, BOS+retest, CHOCH+confirmation. Don't force-fit price action into
one of these if it isn't clean.

Before proposing an entry, check confluence across: HTF bias, intermediate structure, entry-TF
structure, a meaningful level (not a random number), liquidity condition, price-action
confirmation, volume (if available), momentum, macro alignment (if available), news risk, a
logical SL location, and R:R. **If multiple important factors disagree, the answer is NO TRADE.**

## Step 8 — Entry, SL, TP, R:R

- State an entry type: MARKET / LIMIT / BREAKOUT / RETEST / CONFIRMATION, and *why* that type.
- SL must sit beyond a real structural invalidation point (recent swing, not a "nice round
  number"), sized for the timeframe's actual recent volatility — a fixed tiny buffer on a fast
  15m gold move is how the earlier SL got clipped. Consider recent swing range as a rough ATR
  proxy if `Average True Range` isn't on the chart.
- TP1 = nearest meaningful level, TP2 = next structural target, TP3 = higher-timeframe target.
  Never pick TPs at arbitrary round numbers disconnected from actual levels.
- R:R = |TP−entry| / |entry−SL| per target. Prefer ≥1:2 but don't force it — a realistic 1:1.5 on
  genuinely strong structure beats a fabricated 1:3 that isn't backed by real levels.

## Step 9 — Confluence score (not a win probability)

Score out of 100 using roughly: Structure +20, HTF Alignment +15, Liquidity +15, Price Action +15,
Volume +10, Momentum +10, Macro +10, News Risk +5 (subtract for conflicts). State it as
"Confluence score: X/100" — never as a win percentage or guarantee.

## Step 10 — Final decision

Allowed outputs only: STRONG LONG, LONG, WAIT FOR LONG, NEUTRAL, WAIT, WAIT FOR SHORT, SHORT,
STRONG SHORT, NO TRADE.

## Step 11 — Log it

If the decision is an actionable LONG/SHORT (not WAIT/NO TRADE/NEUTRAL), call `journal_log_setup`
with entry/sl/tp1(/tp2/tp3), direction, timeframe, setup_type, confluence_score, htf_bias,
news_condition, session, and reasoning. This is what makes Step 0 possible next time — don't skip
it just because the user didn't explicitly ask for it to be logged.

## Step 12 — Chart annotation

If connected to TradingView (`draw_shape` available), actually draw entry/SL/TP/key S-R levels
with text labels — don't just describe them if you can draw them. If drawing isn't available,
give exact price levels and say "Chart annotation unavailable through current integration." Never
claim something was drawn if it wasn't.

## Final report format

Close every "analisis" with this structure (fill only what you actually have; use "DATA
UNAVAILABLE" rather than inventing anything):

```
========================================
XAUUSD ANALYSIS
========================================
CURRENT PRICE:
MARKET REGIME:
HTF BIAS:
MTF ALIGNMENT:
MACRO BIAS:
NEWS RISK:  LOW / MEDIUM / HIGH / EXTREME

PREVIOUS SETUP STATUS: (from journal_get_open — ACTIVE / TP_HIT / SL_HIT / none)

----------------------------------------
TIMEFRAME MATRIX
----------------------------------------
[table from Step 2, only the timeframes actually fetched]

----------------------------------------
KEY LEVELS
----------------------------------------
SUPPORT:  S1 (rank) / S2 (rank) / S3 (rank)
RESISTANCE: R1 (rank) / R2 (rank) / R3 (rank)
LIQUIDITY:

----------------------------------------
TRADE SETUP
----------------------------------------
DECISION:
ENTRY / ENTRY TYPE:
STOP LOSS:
TP1 / TP2 / TP3:
R:R:
CONFLUENCE SCORE: __/100

----------------------------------------
REASONS
----------------------------------------
1.
2.
3.

----------------------------------------
INVALIDATION
----------------------------------------
Bullish thesis invalid if:
Bearish thesis invalid if:

----------------------------------------
NEWS
----------------------------------------
Next high-impact event:
Scenario A / B / C:
Recommended action around news:

----------------------------------------
FINAL
----------------------------------------
DECISION:
WHY:
WHAT TO WAIT FOR:
========================================
```

## Anti-hallucination

Never invent price, news, economic data, DXY, yields, indicator values, volume, time, connection
status, or previous trade results. If a tool call fails or data isn't available, say so plainly
and lower confidence — don't paper over the gap.
