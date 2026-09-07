/**
 * Unit tests for the chart readiness check in src/wait.js.
 * Pure unit (injected evaluate) — no TradingView Desktop required.
 *
 * Run: node --test tests/wait.test.js
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeTicker, symbolMatches, normalizeResolution, resolutionMatches, waitForChartReady,
} from '../src/wait.js';

describe('normalizeTicker()', () => {
  it('strips an exchange prefix and upper-cases', () => {
    assert.equal(normalizeTicker('BATS:CIFR'), 'CIFR');
    assert.equal(normalizeTicker('nasdaq:aapl'), 'AAPL');
    assert.equal(normalizeTicker(' cifr '), 'CIFR');
  });

  it('keeps futures/continuation suffixes', () => {
    assert.equal(normalizeTicker('NYMEX:CL1!'), 'CL1!');
    assert.equal(normalizeTicker('ES1!'), 'ES1!');
  });

  it('falsy input becomes empty string', () => {
    assert.equal(normalizeTicker(null), '');
    assert.equal(normalizeTicker(undefined), '');
    assert.equal(normalizeTicker(''), '');
  });
});

describe('symbolMatches()', () => {
  it('matches by ticker regardless of exchange prefix or case', () => {
    assert.ok(symbolMatches('CIFR', 'BATS:CIFR'));
    assert.ok(symbolMatches('BATS:CIFR', 'CIFR'));
    assert.ok(symbolMatches('cifr', 'NASDAQ:CIFR'));
    assert.ok(symbolMatches('NYMEX:CL1!', 'CL1!'));
  });

  it('rejects a different ticker', () => {
    assert.equal(symbolMatches('CIFR', 'BATS:CIFRW'), false);
    assert.equal(symbolMatches('AAPL', 'MSFT'), false);
    assert.equal(symbolMatches('AAPL', ''), false);
    assert.equal(symbolMatches('AAPL', null), false);
  });

  it('no expectation matches anything', () => {
    assert.ok(symbolMatches(null, 'AAPL'));
    assert.ok(symbolMatches('', 'AAPL'));
  });
});

describe('normalizeResolution() / resolutionMatches()', () => {
  it('maps the daily family to the API form', () => {
    assert.equal(normalizeResolution('1D'), 'D');
    assert.equal(normalizeResolution('1W'), 'W');
    assert.equal(normalizeResolution('1M'), 'M');
    assert.equal(normalizeResolution('d'), 'D');
  });

  it('maps hours to minutes', () => {
    assert.equal(normalizeResolution('1H'), '60');
    assert.equal(normalizeResolution('4h'), '240');
  });

  it('leaves minute and multi-day forms alone', () => {
    assert.equal(normalizeResolution('15'), '15');
    assert.equal(normalizeResolution('3D'), '3D');
  });

  it('compares canonical forms', () => {
    assert.ok(resolutionMatches('1D', 'D'));
    assert.ok(resolutionMatches('60', '1H'));
    assert.equal(resolutionMatches('D', 'W'), false);
    assert.ok(resolutionMatches(null, 'D'));
  });
});

// Scripted probe: each call to evaluate() returns the next state (the last one
// repeats forever). Records how many polls happened.
function scripted(states) {
  let i = 0;
  const fn = async () => { const s = states[Math.min(i, states.length - 1)]; i++; return typeof s === 'function' ? s() : s; };
  fn.polls = () => i;
  return fn;
}
const deps = (evaluate) => ({ evaluate, pollInterval: 5 });
const ready = (symbol, resolution, barCount, lastTime) => ({ symbol, resolution, barCount, lastTime });

describe('waitForChartReady()', () => {
  it('confirms once symbol, resolution, bar count and last bar are identical across two polls', async () => {
    const ev = scripted([ready('BATS:CIFR', 'D', 300, 1000), ready('BATS:CIFR', 'D', 300, 1000)]);
    assert.equal(await waitForChartReady('CIFR', '1D', 2000, deps(ev)), true);
    assert.equal(ev.polls(), 2);
  });

  it('does not confirm while the series is still growing', async () => {
    const ev = scripted([
      ready('CIFR', 'D', 100, 1),
      ready('CIFR', 'D', 200, 2),
      ready('CIFR', 'D', 300, 3),
      ready('CIFR', 'D', 300, 3),
    ]);
    assert.equal(await waitForChartReady('CIFR', 'D', 2000, deps(ev)), true);
    assert.equal(ev.polls(), 4);
  });

  it('ignores stable polls of the WRONG symbol and returns false on timeout', async () => {
    const ev = scripted([ready('NASDAQ:AAPL', 'D', 300, 1000)]);
    assert.equal(await waitForChartReady('CIFR', null, 60, deps(ev)), false);
    assert.ok(ev.polls() >= 2);
  });

  it('does not count a stable reading from before the switch toward the new one', async () => {
    // First two polls still show the old symbol (stable), then the new one appears.
    const ev = scripted([
      ready('AAPL', 'D', 300, 1),
      ready('AAPL', 'D', 300, 1),
      ready('CIFR', 'D', 50, 2),
      ready('CIFR', 'D', 300, 3),
      ready('CIFR', 'D', 300, 3),
    ]);
    assert.equal(await waitForChartReady('CIFR', null, 2000, deps(ev)), true);
    assert.equal(ev.polls(), 5);
  });

  it('requires the resolution too when one is expected', async () => {
    const ev = scripted([ready('CIFR', '60', 300, 1)]);
    assert.equal(await waitForChartReady('CIFR', 'D', 60, deps(ev)), false);
  });

  it('treats zero bars, probe errors and thrown evaluate as not ready', async () => {
    const ev = scripted([
      { error: 'Cannot read properties of undefined' },
      () => { throw new Error('CDP evaluate timed out'); },
      ready('CIFR', 'D', 0, null),
      ready('CIFR', 'D', 300, 9),
      ready('CIFR', 'D', 300, 9),
    ]);
    assert.equal(await waitForChartReady('CIFR', 'D', 2000, deps(ev)), true);
    assert.equal(ev.polls(), 5);
  });

  it('returns false (never true) when the chart API is unreachable for the whole window', async () => {
    const ev = scripted([{ error: 'no chart' }]);
    assert.equal(await waitForChartReady(null, null, 40, deps(ev)), false);
  });
});
