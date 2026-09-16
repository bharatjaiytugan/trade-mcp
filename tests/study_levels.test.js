/**
 * Tests for getStudyLevels in src/core/data.js.
 *
 * Native (non-Pine) studies such as the Volume Profile family publish their
 * POC / VAH / VAL as `horizlines` graphics, keyed by style id, with the price
 * in `level`. That collection sits one layer shallower than the Pine
 * `dwglines` path buildGraphicsJS walks, so data_get_pine_lines never sees
 * it. getStudyLevels reads it directly and returns the raw `level` values —
 * the numeric source the price-axis labels are rounded from.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getStudyLevels } from '../src/core/data.js';

const VRVP = {
  name: 'Visible Range Volume Profile',
  id: 'qK9z91',
  horizlines: {
    pocLines: [{ id: 2, level: 4449.35, startIndex: 0, endIndex: 1, extendLeft: true, extendRight: true }],
    vahLines: [{ id: 3, level: 4610.5, startIndex: 0, endIndex: 1, extendLeft: true, extendRight: true }],
    valLines: [{ id: 4, level: 4288.2, startIndex: 0, endIndex: 1, extendLeft: true, extendRight: true }],
  },
};

// The evaluate mock returns what the injected page script would: one row per
// study that has any horizlines, already flattened to plain data.
function mockChart(studies) {
  const evaluate = async (expr) => {
    const m = expr.match(/var filter = "([^"]*)"/);
    const filter = m ? m[1] : '';
    return studies
      .filter((s) => !filter || s.name.includes(filter))
      .map((s) => ({
        id: s.id,
        name: s.name,
        levels: Object.entries(s.horizlines).flatMap(([styleId, items]) =>
          items.map((it) => ({ style_id: styleId, primitive_id: it.id, level: it.level, start_index: it.startIndex, end_index: it.endIndex }))),
      }));
  };
  return { _deps: { evaluate } };
}

describe('getStudyLevels', () => {
  it('returns POC / VAH / VAL levels keyed by style id', async () => {
    const { _deps } = mockChart([VRVP]);
    const r = await getStudyLevels({ study_filter: 'Volume Profile', _deps });
    assert.equal(r.success, true);
    assert.equal(r.study_count, 1);
    const s = r.studies[0];
    assert.equal(s.id, 'qK9z91');
    assert.equal(s.name, 'Visible Range Volume Profile');
    assert.deepEqual(s.levels, { pocLines: [4449.35], vahLines: [4610.5], valLines: [4288.2] });
  });

  it('keeps the raw level untouched (no tick rounding)', async () => {
    const { _deps } = mockChart([VRVP]);
    const r = await getStudyLevels({ _deps });
    assert.equal(r.studies[0].levels.pocLines[0], 4449.35);
  });

  it('applies study_filter as a substring and reports zero studies cleanly', async () => {
    const { _deps } = mockChart([VRVP]);
    const r = await getStudyLevels({ study_filter: 'Bollinger', _deps });
    assert.equal(r.success, true);
    assert.equal(r.study_count, 0);
    assert.deepEqual(r.studies, []);
  });

  it('verbose returns each primitive with its bar-index span', async () => {
    const { _deps } = mockChart([VRVP]);
    const r = await getStudyLevels({ verbose: true, _deps });
    const poc = r.studies[0].primitives.find((p) => p.style_id === 'pocLines');
    assert.deepEqual(poc, { style_id: 'pocLines', primitive_id: 2, level: 4449.35, start_index: 0, end_index: 1 });
  });
});
