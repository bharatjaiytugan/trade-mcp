---
name: strategy-report
description: Generate a comprehensive strategy performance report — metrics, trade analysis, equity curve, and recommendations. Use after backtesting a Pine Script strategy.
---

# Strategy Performance Report

You are generating a detailed performance report for a Pine Script strategy on TradingView.

## Step 1: Gather Data

Collect all available performance data:
1. `data_get_strategy_results` — overall metrics (net profit, win rate, profit factor, etc.)
2. `data_get_trades` — individual trade list (max 20)
3. `data_get_equity` — equity curve data points
4. `chart_get_state` — current symbol, timeframe, and studies on chart
5. `symbol_info` — symbol metadata for context

## Step 2: Capture Visuals

1. `capture_screenshot` with region "chart" — the chart with strategy overlay
2. `capture_screenshot` with region "strategy_tester" — the Strategy Tester panel

## Step 3: Analyze

### Key Metrics
Report these if available. **Total Trades comes first**, because every other
number on this list is only as trustworthy as the count behind it:
- **Total Trades** — the sample size, and the limit on what the rest can mean
- **Net Profit** and **% return**
- **Win Rate**
- **Profit Factor** (a target of > 1.5 is often quoted, but it is meaningless
  on a small sample — see Step 3.5)
- **Max Drawdown** ($ and %)
- **Average Trade** ($ and %)
- **Sharpe Ratio** if available
- **Max Consecutive Losses**

### Trade Analysis
From the trade list:
- Largest winner and largest loser
- Average winner vs average loser (reward:risk)
- Long vs short performance breakdown
- Time in market

### Equity Curve Assessment
- Is it smooth and upward-sloping?
- Any extended drawdown periods?
- Does it show consistency or was profit front/back-loaded?

## Step 3.5: Check the sample can support a conclusion

Do this BEFORE writing any verdict. A backtest always produces numbers; it does
not always produce evidence.

**State the trade count, then pick the band:**

| Trades | What may be said |
|--------|------------------|
| < 30 | No verdict. Report the metrics and say plainly that the sample cannot distinguish skill from luck. |
| 30–99 | Provisional only. Describe what the numbers *were*, never what the strategy *is*. |
| 100+ | A verdict is reasonable — still subject to the limits below. |

Trades are not automatically independent observations. Several positions opened
in the same week, or across correlated symbols on the same move, are closer to
one market event than to many. When trades cluster like that, the effective
sample is smaller than the count, and the bands above should be read more
conservatively.

A large profit factor on a handful of trades is the single most common way a
backtest misleads. Two or three outsized winners can carry it, and they may not
recur.

## Step 4: Generate Report

Format as a structured report:

```
## Strategy Report: [Strategy Name]
**Symbol:** [symbol] | **Timeframe:** [tf] | **Period:** [date range]

### Sample
[N trades over [period]. State here whether that is enough to support a
verdict, per Step 3.5 — before any conclusion appears below.]

### Summary
[1-2 sentence overview of performance. If the sample is under 30 trades, this
must say the result is inconclusive rather than describing the strategy as
working or not working.]

### Key Metrics
| Metric | Value |
|--------|-------|
| Net Profit | ... |
| Win Rate | ... |
| Profit Factor | ... |
| Max Drawdown | ... |

### Strengths
- [bullet points]

### Weaknesses
- [bullet points]

### Recommendations
- [specific actionable improvements]
```

## Step 5: Suggest Improvements

Based on the analysis:
- If win rate < 50% but profit factor > 1: suggest tighter entries
- If max drawdown > 20%: suggest position sizing or stop loss adjustments
- If profit factor < 1.2: suggest the strategy may need fundamental changes
- If few trades: say the sample is too small to judge, and suggest testing over
  a longer history or more symbols. Do NOT suggest loosening entry criteria to
  produce more trades — that manufactures sample size by changing the strategy
  being measured, which is how overfitting starts.

## What these numbers cannot tell you

State these limits in the report when they apply. They are not hedging; they
are the difference between a result and an edge.

- **In-sample fitting.** If the rules were chosen after looking at this period,
  the backtest measures the fit, not the edge. Ask whether the strategy was
  tested on data it was not designed against.
- **One symbol, one regime.** A result on a single symbol over a trending period
  may be exposure to that trend rather than skill. Check whether it survives on
  other symbols and in other conditions.
- **Costs.** Confirm the backtest includes commission and slippage. A strategy
  with a small average trade can be profitable gross and losing net.
- **Survivorship in the choice of test.** A strategy reached after discarding
  several that tested worse has already been selected on this data.
