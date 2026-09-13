/**
 * Tests for scrollToDate() in src/core/chart.js.
 * Covers: unix-timestamp vs. ISO date input, per-resolution secsPerBar
 * mapping (D/W/M vs. numeric minutes vs. unparseable), the resulting
 * centered/window math, and the invalid-date guard.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { scrollToDate } from '../src/core/chart.js';

function mockDeps({ resolution = 'D' } = {}) {
  const calls = [];
  const evaluate = async (expr) => {
    calls.push(expr);
    if (expr.includes('.resolution()')) return resolution;
    return undefined;
  };
  evaluate.calls = calls;
  return { _deps: { evaluate }, evaluate };
}

describe('scrollToDate() — date parsing', () => {
  it('treats an all-digit string as a unix timestamp in seconds, unmodified', async () => {
    const { _deps } = mockDeps();
    const r = await scrollToDate({ date: '946684800', _deps });
    assert.equal(r.centered_on, 946684800);
  });

  it('parses an ISO date string and floors to seconds', async () => {
    const { _deps } = mockDeps();
    const expected = Math.floor(new Date('2024-01-15').getTime() / 1000);
    const r = await scrollToDate({ date: '2024-01-15', _deps });
    assert.equal(r.centered_on, expected);
  });

  it('throws with the offending value when the date cannot be parsed', async () => {
    const { _deps } = mockDeps();
    await assert.rejects(
      () => scrollToDate({ date: 'not-a-date-at-all', _deps }),
      (err) => {
        assert.ok(err.message.includes('Could not parse date'));
        assert.ok(err.message.includes('not-a-date-at-all'));
        return true;
      },
    );
  });
});

describe('scrollToDate() — resolution → secsPerBar → window', () => {
  const cases = [
    ['D', 86400], ['1D', 86400],
    ['W', 604800], ['1W', 604800],
    ['M', 2592000], ['1M', 2592000],
    ['15', 900], ['60', 3600],
  ];

  for (const [resolution, secsPerBar] of cases) {
    it(`resolution "${resolution}" -> a 50x secsPerBar-wide window`, async () => {
      const { _deps } = mockDeps({ resolution });
      const r = await scrollToDate({ date: '946684800', _deps });
      assert.equal(r.window.to - r.window.from, 50 * secsPerBar);
      assert.equal(r.centered_on - r.window.from, 25 * secsPerBar);
      assert.equal(r.window.to - r.centered_on, 25 * secsPerBar);
    });
  }

  it('falls back to 60s/bar for an unrecognized resolution string', async () => {
    const { _deps } = mockDeps({ resolution: 'weird' });
    const r = await scrollToDate({ date: '946684800', _deps });
    assert.equal(r.window.to - r.window.from, 50 * 60);
  });

  it('reports the resolution it read back from the chart', async () => {
    const { _deps } = mockDeps({ resolution: '5' });
    const r = await scrollToDate({ date: '946684800', _deps });
    assert.equal(r.resolution, '5');
  });
});

describe('scrollToDate() — evaluate wiring', () => {
  it('zooms the chart via zoomToBarsRange', async () => {
    const { _deps, evaluate } = mockDeps();
    await scrollToDate({ date: '946684800', _deps });
    assert.ok(evaluate.calls.some((c) => c.includes('zoomToBarsRange')), 'zoomToBarsRange called');
  });

  it('returns success and echoes the requested date', async () => {
    const { _deps } = mockDeps();
    const r = await scrollToDate({ date: '2024-01-15', _deps });
    assert.equal(r.success, true);
    assert.equal(r.date, '2024-01-15');
  });
});
