import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveScriptMatch, diffScriptVersions } from '../src/core/pine.js';

// Mirrors the real shape returned by pine-facade's saved-script list.
const SCRIPTS = [
  { id: 'aaa', name: "Azu's Gold Sweeps v2", title: 'My script', version: '3.0', modified: 1776419977 },
  { id: 'bbb', name: 'My script', title: 'Example 1: Regular Session Data', version: '2.0', modified: 1709398679 },
  { id: 'ccc', name: 'new code', title: 'Error: cannot compile script', version: '2.0', modified: 1696233050 },
  { id: 'ddd', name: 'Opening Range Breakout', title: 'ORB Stocks & Options', version: '12.0', modified: 1788895207 },
];

test('resolveScriptMatch prefers an exact name over an earlier title collision', () => {
  // Regression: "Azu's Gold Sweeps v2" has the TITLE "My script" and sorts
  // first, so equal-precedence matching returned it instead of the script
  // actually NAMED "My script".
  const hit = resolveScriptMatch(SCRIPTS, 'My script');
  assert.equal(hit.script.id, 'bbb');
  assert.equal(hit.matched_on, 'name (exact)');
});

test('resolveScriptMatch falls back to an exact title when no name matches', () => {
  const hit = resolveScriptMatch(SCRIPTS, 'ORB Stocks & Options');
  assert.equal(hit.script.id, 'ddd');
  assert.equal(hit.matched_on, 'title (exact)');
});

test('resolveScriptMatch is case-insensitive and trims', () => {
  assert.equal(resolveScriptMatch(SCRIPTS, '  NEW CODE  ').script.id, 'ccc');
});

test('resolveScriptMatch only falls back to substring when nothing exact matches', () => {
  const hit = resolveScriptMatch(SCRIPTS, 'Opening Range');
  assert.equal(hit.script.id, 'ddd');
  assert.equal(hit.matched_on, 'name (substring)');
});

test('resolveScriptMatch returns null for misses and empty input', () => {
  assert.equal(resolveScriptMatch(SCRIPTS, 'nothing like this'), null);
  assert.equal(resolveScriptMatch(SCRIPTS, ''), null);
  assert.equal(resolveScriptMatch(null, 'My script'), null);
});

test('diffScriptVersions detects the script whose version moved', () => {
  const after = SCRIPTS.map((s) => (s.id === 'ddd' ? { ...s, version: '13.0', modified: 1788895999 } : s));
  const changed = diffScriptVersions(SCRIPTS, after);
  assert.equal(changed.length, 1);
  assert.equal(changed[0].id, 'ddd');
  assert.equal(changed[0].change, 'updated');
  assert.equal(changed[0].from_version, '12.0');
});

test('diffScriptVersions detects a modified timestamp even when version is static', () => {
  const after = SCRIPTS.map((s) => (s.id === 'ccc' ? { ...s, modified: 1799999999 } : s));
  assert.equal(diffScriptVersions(SCRIPTS, after)[0].id, 'ccc');
});

test('diffScriptVersions reports creations and sorts them first', () => {
  const after = [
    ...SCRIPTS.map((s) => (s.id === 'aaa' ? { ...s, version: '4.0' } : s)),
    { id: 'eee', name: 'Brand New', title: 'Brand New', version: '1.0', modified: 1799999999 },
  ];
  const changed = diffScriptVersions(SCRIPTS, after);
  assert.equal(changed.length, 2);
  assert.equal(changed[0].change, 'created');
  assert.equal(changed[0].id, 'eee');
});

test('diffScriptVersions returns nothing when the list is unchanged', () => {
  assert.deepEqual(diffScriptVersions(SCRIPTS, SCRIPTS.map((s) => ({ ...s }))), []);
});

test('diffScriptVersions tolerates unreadable snapshots', () => {
  assert.deepEqual(diffScriptVersions(null, SCRIPTS), []);
  assert.deepEqual(diffScriptVersions(SCRIPTS, null), []);
});
