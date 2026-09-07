import { evaluate as _evaluate } from './connection.js';

export const DEFAULT_TIMEOUT = 10000;
const POLL_INTERVAL = 200;
const CHART_API = 'window.TradingViewApi._activeChartWidgetWV.value()';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/**
 * Reduce a symbol to its bare ticker for comparison: strip an exchange prefix
 * ("BATS:CIFR" -> "CIFR"), trim, upper-case. Anything falsy becomes ''.
 */
export function normalizeTicker(symbol) {
  const s = (symbol == null ? '' : String(symbol)).trim();
  if (!s) return '';
  const idx = s.lastIndexOf(':');
  return (idx === -1 ? s : s.slice(idx + 1)).trim().toUpperCase();
}

/**
 * True when the chart's symbol is the one that was requested. Compared by
 * ticker only, case-insensitively, so a request for "CIFR" is satisfied by a
 * chart showing "BATS:CIFR" (TradingView resolves the exchange itself), and a
 * request for "NYMEX:CL1!" is satisfied by "CL1!". Two different exchange
 * prefixes for the same ticker are still considered a match — the caller asked
 * for the ticker, the exchange is TradingView's routing decision.
 */
export function symbolMatches(expected, actual) {
  const e = normalizeTicker(expected);
  if (!e) return true;             // nothing requested — any symbol is fine
  const a = normalizeTicker(actual);
  return !!a && a === e;
}

/**
 * Canonical resolution string. TradingView reports "D"/"W"/"M" for the daily
 * family while users commonly write "1D"/"1W"/"1M"; hour forms ("1H", "4H")
 * are reported in minutes ("60", "240").
 */
export function normalizeResolution(res) {
  const s = (res == null ? '' : String(res)).trim().toUpperCase();
  if (!s) return '';
  if (/^1[DWM]$/.test(s)) return s.slice(1);
  const h = s.match(/^(\d+)H$/);
  if (h) return String(Number(h[1]) * 60);
  return s;
}

export function resolutionMatches(expected, actual) {
  const e = normalizeResolution(expected);
  if (!e) return true;
  return normalizeResolution(actual) === e;
}

// Page-side probe: everything the readiness decision needs, read from the
// chart API rather than the DOM. Returns { error } when the API is not
// reachable yet (chart still booting, or no chart tab).
const READY_PROBE = `
  (function() {
    try {
      var chart = ${CHART_API};
      var out = { symbol: chart.symbol(), resolution: chart.resolution(), barCount: 0, lastTime: null };
      try {
        var bars = chart._chartWidget.model().mainSeries().bars();
        out.barCount = bars.size();
        if (out.barCount > 0) { var last = bars.valueAt(bars.lastIndex()); out.lastTime = last ? last[0] : null; }
      } catch (e) { out.barsError = e.message; }
      return out;
    } catch (e) { return { error: e.message }; }
  })()
`;

/**
 * Wait until the chart has actually switched to `expectedSymbol` /
 * `expectedTf` (either may be null = don't care) AND its main series has
 * settled: symbol, resolution, bar count and last-bar time identical across
 * two consecutive polls with at least one bar loaded.
 *
 * Resolves true only when that was confirmed. Resolves false on timeout —
 * callers must treat false as "the chart is NOT showing what was asked for"
 * and fail, never continue and read whatever the chart happens to show.
 *
 * `deps.evaluate` / `deps.pollInterval` can be injected for unit tests.
 */
export async function waitForChartReady(expectedSymbol = null, expectedTf = null, timeout = DEFAULT_TIMEOUT, deps = {}) {
  const evaluate = deps.evaluate || _evaluate;
  const pollInterval = deps.pollInterval || POLL_INTERVAL;
  const start = Date.now();
  let previous = null;

  while (Date.now() - start < timeout) {
    let state = null;
    try { state = await evaluate(READY_PROBE); } catch { state = null; }

    if (!state || state.error || !state.barCount || state.barCount <= 0
        || !symbolMatches(expectedSymbol, state.symbol)
        || !resolutionMatches(expectedTf, state.resolution)) {
      previous = null;
      await sleep(pollInterval);
      continue;
    }

    const signature = [state.symbol, state.resolution, state.barCount, state.lastTime].join('|');
    if (previous === signature) return true;
    previous = signature;
    await sleep(pollInterval);
  }

  // Timed out: the chart never confirmed the requested state (or never settled).
  return false;
}

/**
 * Wait for the chart to finish (re)rendering — used before screenshots so a
 * capture right after chart_set_symbol / chart_set_timeframe doesn't grab a
 * stale frame (issue #144). Waits for any loading spinner to clear, then for
 * the symbol/resolution/canvas signature to hold stable across 3 polls.
 */
export async function waitForChartRender(timeout = 5000, deps = {}) {
  const evaluate = deps.evaluate || _evaluate;
  const start = Date.now();
  let lastSignature = null;
  let stableCount = 0;

  while (Date.now() - start < timeout) {
    const state = await evaluate(`
      (function() {
        var canvas = document.querySelector('[data-name="pane-canvas"] canvas')
          || document.querySelector('[data-name="pane-canvas"]')
          || document.querySelector('canvas');
        var rect = canvas ? canvas.getBoundingClientRect() : null;
        var symbol = '', resolution = '';
        try {
          var chart = ${CHART_API};
          symbol = chart.symbol();
          resolution = chart.resolution();
        } catch(e) {}
        var spinner = document.querySelector('[class*="loader"]')
          || document.querySelector('[class*="loading"]')
          || document.querySelector('[data-name="loading"]');
        return {
          symbol: symbol,
          resolution: resolution,
          isLoading: !!(spinner && spinner.offsetParent !== null),
          canvasWidth: rect ? Math.round(rect.width) : 0,
          canvasHeight: rect ? Math.round(rect.height) : 0
        };
      })()
    `);

    if (!state || state.isLoading || !state.canvasWidth || !state.canvasHeight) {
      stableCount = 0;
      await sleep(POLL_INTERVAL);
      continue;
    }

    const signature = [state.symbol, state.resolution, state.canvasWidth, state.canvasHeight].join('|');
    if (signature === lastSignature) stableCount++;
    else { stableCount = 0; lastSignature = signature; }

    if (stableCount >= 3) return true;
    await sleep(POLL_INTERVAL);
  }

  return false;
}
