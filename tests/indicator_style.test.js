/**
 * Tests for study style overrides and add-time resolution detection in
 * src/core/indicators.js.
 *
 * - getStyle / setStyle wrap StudyApi.getStyleValues() / applyOverrides().
 *   Style keys are dotted paths under `styles.*` (plot styles) and
 *   `graphics.*` (native drawings such as the Volume Profile's POC/VAH/VAL
 *   lines and histogram width). setStyle reads the values back so the caller
 *   sees what actually took, not what was requested.
 * - addStudyFromSearch reports the chart resolution before/after the add so
 *   an automated run can detect a timeframe change it did not ask for.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getStyle, setStyle, addStudyFromSearch } from '../src/core/indicators.js';

// Mock evaluate for a single study whose style tree is mutated in place by
// applyOverrides. Dotted override keys are resolved against the tree.
function mockStudy(tree) {
  const state = { style: JSON.parse(JSON.stringify(tree)), applied: [] };
  const setPath = (obj, path, value) => {
    const parts = path.split('.');
    let cur = obj;
    for (let i = 0; i < parts.length - 1; i++) {
      if (cur[parts[i]] === undefined) return false;
      cur = cur[parts[i]];
    }
    if (!Object.prototype.hasOwnProperty.call(cur, parts[parts.length - 1])) return false;
    cur[parts[parts.length - 1]] = value;
    return true;
  };
  const evaluate = async (expr) => {
    if (/getStudyById\("missing"\)/.test(expr)) return { error: 'Study not found: missing' };
    if (/applyOverrides/.test(expr)) {
      const m = expr.match(/var overrides = (\{[\s\S]*?\});/);
      const overrides = m ? JSON.parse(m[1]) : {};
      for (const [k, v] of Object.entries(overrides)) { state.applied.push(k); setPath(state.style, k, v); }
      return { style: state.style };
    }
    if (/getStyleValues/.test(expr)) return { style: state.style };
    return undefined;
  };
  return { _deps: { evaluate }, state };
}

const VRVP_STYLE = {
  styles: { developingVAHigh: { visible: false, color: '#00bcd4' } },
  graphics: {
    horizlines: { pocLines: { color: '#DBDBDB', visible: true }, vahLines: { color: '#DBDBDB', visible: false } },
    hhists: { histBars2: { percentWidth: 30 } },
  },
};

describe('getStyle', () => {
  it('returns the study style tree', async () => {
    const { _deps } = mockStudy(VRVP_STYLE);
    const r = await getStyle({ entity_id: 'qK9z91', _deps });
    assert.equal(r.success, true);
    assert.equal(r.entity_id, 'qK9z91');
    assert.equal(r.style.graphics.horizlines.pocLines.color, '#DBDBDB');
  });

  it('throws when the study is missing', async () => {
    const { _deps } = mockStudy(VRVP_STYLE);
    await assert.rejects(getStyle({ entity_id: 'missing', _deps }), /Study not found: missing/);
  });
});

describe('setStyle', () => {
  it('applies dotted overrides and confirms them by read-back', async () => {
    const { _deps, state } = mockStudy(VRVP_STYLE);
    const r = await setStyle({
      entity_id: 'qK9z91',
      overrides: JSON.stringify({
        'graphics.horizlines.pocLines.color': '#FFC107',
        'graphics.horizlines.vahLines.visible': true,
        'graphics.hhists.histBars2.percentWidth': 18,
        'styles.developingVAHigh.visible': true,
      }),
      _deps,
    });
    assert.equal(r.success, true);
    assert.deepEqual(r.confirmed, {
      'graphics.horizlines.pocLines.color': '#FFC107',
      'graphics.horizlines.vahLines.visible': true,
      'graphics.hhists.histBars2.percentWidth': 18,
      'styles.developingVAHigh.visible': true,
    });
    assert.deepEqual(r.unconfirmed, []);
    assert.equal(state.style.graphics.horizlines.pocLines.color, '#FFC107');
  });

  it('reports keys that did not take rather than claiming success for them', async () => {
    const { _deps } = mockStudy(VRVP_STYLE);
    const r = await setStyle({ entity_id: 'qK9z91', overrides: { 'graphics.horizlines.bogus.color': '#000' }, _deps });
    assert.equal(r.success, false);
    assert.deepEqual(r.confirmed, {});
    assert.deepEqual(r.unconfirmed, ['graphics.horizlines.bogus.color']);
  });

  it('rejects an empty override set', async () => {
    const { _deps } = mockStudy(VRVP_STYLE);
    await assert.rejects(setStyle({ entity_id: 'qK9z91', overrides: '{}', _deps }), /non-empty/);
  });
});

// Mock the Indicators-dialog flow used by addStudyFromSearch: the dialog is
// already open, the search input is present, the row click succeeds, one new
// study appears, and the chart resolution optionally changes across the add.
function mockAddFlow({ resolutionAfter }) {
  let calls = 0;
  const evaluate = async (expr) => {
    if (/getAllStudies\(\)\.map\(function\(s\)\{return s\.id;\}\)/.test(expr)) return ['old'];
    if (/getAllStudies\(\)\.map\(function\(s\)\{return \{ id/.test(expr)) return [{ id: 'old', name: 'Volume' }, { id: 'new1', name: 'VRVP' }];
    if (/\.resolution\(\)/.test(expr)) { calls += 1; return calls === 1 ? '240' : resolutionAfter; }
    if (/open-indicators-dialog/.test(expr)) return 'already';
    if (/indicators-dialog"\] input'\)/.test(expr) && /!!document/.test(expr)) return true;
    if (/dispatchEvent/.test(expr)) return true;
    if (/pick\.row\.click/.test(expr)) return { clicked: 'Visible Range Volume Profile', section: 'technicals' };
    return undefined;
  };
  return { _deps: { evaluate, delay: async () => {} } };
}

describe('addStudyFromSearch — resolution detection', () => {
  it('reports resolution_changed=false when the timeframe is untouched', async () => {
    const { _deps } = mockAddFlow({ resolutionAfter: '240' });
    const r = await addStudyFromSearch({ query: 'Visible Range Volume Profile', _deps });
    assert.equal(r.success, true);
    assert.equal(r.entity_id, 'new1');
    assert.equal(r.resolution_before, '240');
    assert.equal(r.resolution_after, '240');
    assert.equal(r.resolution_changed, false);
  });

  it('flags resolution_changed=true when the timeframe moved during the add', async () => {
    const { _deps } = mockAddFlow({ resolutionAfter: '5' });
    const r = await addStudyFromSearch({ query: 'Visible Range Volume Profile', _deps });
    assert.equal(r.resolution_before, '240');
    assert.equal(r.resolution_after, '5');
    assert.equal(r.resolution_changed, true);
  });
});
