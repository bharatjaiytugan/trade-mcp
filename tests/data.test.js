/**
 * Unit tests for getOhlcv history paging and the getQuote shared-chart guard
 * in src/core/data.js. Pure unit (mocked CDP eval) — no TradingView Desktop required.
 *
 * Run: node --test tests/data.test.js
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getOhlcv, getQuote } from '../src/core/data.js';

// Stateful chart mock: `size` bars loaded; each requestMoreData page adds
// `step` bars until `feed` is exhausted (more=false).
function ohlcvDeps({ size = 300, step = 1000, feed = 5000, symbol = 'BATS:CIFR', resolution = 'D' } = {}) {
  const calls = [];
  let loaded = size;
  const evaluate = async (expr) => {
    calls.push(expr);
    if (expr.includes('requestMoreDataAvailable')) return { size: loaded, more: loaded < feed };
    if (expr.includes('requestMoreData(')) { loaded = Math.min(feed, loaded + step); return undefined; }
    if (expr.includes("source: 'direct_bars'")) {
      const limit = Number(expr.match(/end - (\d+) \+ 1/)[1]);
      const n = Math.min(limit, loaded);
      const bars = Array.from({ length: n }, (_, i) => ({ time: i + 1, open: 1, high: 2, low: 0.5, close: 1.5, volume: 10 }));
      return { bars, total_bars: loaded, symbol, resolution, source: 'direct_bars' };
    }
    return undefined;
  };
  const pages = () => calls.filter((c) => c.includes('requestMoreData(')).length;
  return { _deps: { evaluate, evaluateAsync: evaluate, delay: async () => {} }, calls, pages };
}

describe('getOhlcv() — history paging', () => {
  it('does not page when enough bars are already loaded', async () => {
    const { _deps, pages } = ohlcvDeps({ size: 300 });
    const r = await getOhlcv({ count: 100, _deps });
    assert.equal(pages(), 0);
    assert.equal(r.bar_count, 100);
    assert.equal(r.requested, 100);
    assert.equal(r.truncated, false);
    assert.equal(r.total_available, 300);
    assert.equal(r.symbol, 'BATS:CIFR');
    assert.equal(r.resolution, 'D');
  });

  it('pages via requestMoreData until count bars are loaded', async () => {
    const { _deps, pages } = ohlcvDeps({ size: 300, step: 1000 }); // 300 -> 1300
    const r = await getOhlcv({ count: 500, _deps });
    assert.equal(pages(), 1);
    assert.equal(r.bar_count, 500);
    assert.equal(r.truncated, false);
    assert.equal(r.pages_loaded, 1);
  });

  it('stops when the feed is exhausted and reports truncated', async () => {
    const { _deps, pages } = ohlcvDeps({ size: 100, step: 50, feed: 200 }); // 100 -> 150 -> 200 (no more)
    const r = await getOhlcv({ count: 500, _deps });
    assert.equal(pages(), 2);
    assert.equal(r.bar_count, 200);
    assert.equal(r.total_available, 200);
    assert.equal(r.truncated, true);
  });

  it('stops when a page adds nothing (feed claims more but delivers none)', async () => {
    const { _deps, pages } = ohlcvDeps({ size: 100, step: 0, feed: 5000 });
    const r = await getOhlcv({ count: 500, _deps });
    assert.equal(pages(), 1);
    assert.equal(r.truncated, true);
  });

  it('caps at 500 bars per call and says so', async () => {
    const { _deps } = ohlcvDeps({ size: 2000 });
    const r = await getOhlcv({ count: 800, _deps });
    assert.equal(r.bar_count, 500);
    assert.equal(r.requested, 800);
    assert.equal(r.truncated, true);
    assert.match(r.note, /capped/);
  });

  it('summary mode carries the same metadata', async () => {
    const { _deps } = ohlcvDeps({ size: 300 });
    const r = await getOhlcv({ count: 50, summary: true, _deps });
    assert.equal(r.bar_count, 50);
    assert.equal(r.requested, 50);
    assert.equal(r.symbol, 'BATS:CIFR');
    assert.ok(r.period);
    assert.equal(r.bars, undefined);
  });
});

function quoteDeps({ chartSymbol = 'NASDAQ:AAPL', confirm = true } = {}) {
  const calls = [];
  const evaluate = async (expr) => {
    calls.push(expr);
    if (/\.symbol\(\)$/.test(expr.trim())) return chartSymbol;
    if (expr.includes('header_price')) return { symbol: chartSymbol, time: 1, open: 1, high: 2, low: 0.5, close: 1.5, last: 1.5, volume: 10 };
    return undefined;
  };
  const setSymbolCalls = () => calls.filter((c) => c.includes('chart.setSymbol('));
  const waits = [];
  const waitForChartReady = async (sym) => { waits.push(sym); return confirm; };
  return { _deps: { evaluate, evaluateAsync: evaluate, waitForChartReady, delay: async () => {} }, calls, setSymbolCalls, waits };
}

describe('getQuote() — shared-chart guard', () => {
  it('quotes the current chart symbol without touching the chart', async () => {
    const { _deps, setSymbolCalls } = quoteDeps();
    const r = await getQuote({ _deps });
    assert.equal(r.success, true);
    assert.equal(setSymbolCalls().length, 0);
  });

  it('a symbol that matches the chart by ticker needs no switch', async () => {
    const { _deps, setSymbolCalls } = quoteDeps({ chartSymbol: 'NASDAQ:AAPL' });
    const r = await getQuote({ symbol: 'aapl', _deps });
    assert.equal(r.success, true);
    assert.equal(setSymbolCalls().length, 0);
    assert.equal(r.switched_from, undefined);
  });

  it('refuses to move the shared chart to another symbol without force_switch', async () => {
    const { _deps, setSymbolCalls } = quoteDeps({ chartSymbol: 'NASDAQ:AAPL' });
    await assert.rejects(getQuote({ symbol: 'MSFT', _deps }), /force-switch/);
    assert.equal(setSymbolCalls().length, 0);
  });

  it('with force_switch: switches, waits for confirmation, reads, and restores', async () => {
    const { _deps, setSymbolCalls, waits } = quoteDeps({ chartSymbol: 'NASDAQ:AAPL' });
    const r = await getQuote({ symbol: 'MSFT', force_switch: true, _deps });
    assert.equal(r.success, true);
    assert.equal(r.switched_from, 'NASDAQ:AAPL');
    assert.equal(setSymbolCalls().length, 2, 'switch + restore');
    assert.deepEqual(waits, ['MSFT', 'NASDAQ:AAPL']);
  });

  it('with force_switch: an unconfirmed switch throws and still restores', async () => {
    const { _deps, setSymbolCalls } = quoteDeps({ chartSymbol: 'NASDAQ:AAPL', confirm: false });
    await assert.rejects(getQuote({ symbol: 'MSFT', force_switch: true, _deps }), /did not confirm symbol MSFT within \d+s; chart shows NASDAQ:AAPL/);
    assert.equal(setSymbolCalls().length, 2, 'switch attempted + restore attempted');
  });
});
