/**
 * Tests for the trade journal (src/core/journal.js).
 * Each test uses its own temp store file so entries never leak between tests.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as journal from '../src/core/journal.js';

let dir, storePath, opts;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'tv-journal-test-'));
  storePath = join(dir, 'journal.json');
  opts = { storePath };
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function validLong(overrides = {}) {
  return {
    symbol: 'OANDA:XAUUSD',
    timeframe: '15',
    direction: 'LONG',
    entry: 4283,
    sl: 4277,
    tp1: 4296,
    tp2: 4306,
    ...overrides,
  };
}

describe('logSetup()', () => {
  it('creates an ACTIVE entry with an id and computed risk', () => {
    const rec = journal.logSetup(validLong(), opts);
    assert.equal(rec.status, 'ACTIVE');
    assert.equal(typeof rec.id, 'string');
    assert.equal(rec.risk, 6);
    assert.equal(rec.closed_at, null);
  });

  it('rejects a LONG setup with SL above entry', () => {
    assert.throws(() => journal.logSetup(validLong({ sl: 4290 }), opts), /invalidation side/);
  });

  it('rejects a SHORT setup with SL below entry', () => {
    assert.throws(
      () => journal.logSetup(validLong({ direction: 'SHORT', entry: 4283, sl: 4277, tp1: 4262 }), opts),
      /invalidation side/
    );
  });

  it('accepts a valid SHORT setup', () => {
    const rec = journal.logSetup(validLong({ direction: 'SHORT', entry: 4283, sl: 4290, tp1: 4262 }), opts);
    assert.equal(rec.status, 'ACTIVE');
  });

  it('requires symbol, timeframe, direction, entry, sl, tp1', () => {
    assert.throws(() => journal.logSetup({ ...validLong(), symbol: undefined }, opts), /symbol/);
    assert.throws(() => journal.logSetup({ ...validLong(), direction: 'UP' }, opts), /direction/);
    assert.throws(() => journal.logSetup({ ...validLong(), entry: 'x' }, opts), /entry/);
  });

  it('persists across separate load calls (same store file)', () => {
    journal.logSetup(validLong(), opts);
    const open = journal.getOpen({}, opts);
    assert.equal(open.length, 1);
  });
});

describe('updateStatus()', () => {
  it('updates status, sets closed_at for terminal statuses, and records result_r', () => {
    const rec = journal.logSetup(validLong(), opts);
    const updated = journal.updateStatus({ id: rec.id, status: 'TP1_HIT', result_r: 2.17 }, opts);
    assert.equal(updated.status, 'TP1_HIT');
    assert.equal(updated.result_r, 2.17);
    assert.notEqual(updated.closed_at, null);
  });

  it('does not set closed_at for a non-terminal status', () => {
    const rec = journal.logSetup(validLong(), opts);
    const updated = journal.updateStatus({ id: rec.id, status: 'ACTIVE' }, opts);
    assert.equal(updated.closed_at, null);
  });

  it('throws on unknown id', () => {
    assert.throws(() => journal.updateStatus({ id: 'nope', status: 'SL_HIT' }, opts), /No journal entry/);
  });

  it('throws on invalid status', () => {
    const rec = journal.logSetup(validLong(), opts);
    assert.throws(() => journal.updateStatus({ id: rec.id, status: 'MAYBE' }, opts), /status must be one of/);
  });

  it('an entry moved out of ACTIVE no longer appears in getOpen()', () => {
    const rec = journal.logSetup(validLong(), opts);
    journal.updateStatus({ id: rec.id, status: 'SL_HIT', result_r: -1 }, opts);
    assert.equal(journal.getOpen({}, opts).length, 0);
  });
});

describe('getOpen() / getAll()', () => {
  it('filters open entries by symbol', () => {
    journal.logSetup(validLong({ symbol: 'OANDA:XAUUSD' }), opts);
    journal.logSetup(validLong({ symbol: 'OANDA:EURUSD' }), opts);
    assert.equal(journal.getOpen({ symbol: 'OANDA:XAUUSD' }, opts).length, 1);
    assert.equal(journal.getOpen({}, opts).length, 2);
  });

  it('getAll respects limit and returns newest first', () => {
    const a = journal.logSetup(validLong(), opts);
    const b = journal.logSetup(validLong(), opts);
    const all = journal.getAll({ limit: 1 }, opts);
    assert.equal(all.length, 1);
    assert.equal(all[0].id, b.id);
    assert.notEqual(all[0].id, a.id);
  });
});

describe('getStats()', () => {
  it('only counts closed entries with a result_r', () => {
    journal.logSetup(validLong(), opts); // stays ACTIVE, should not count
    const stats = journal.getStats({}, opts);
    assert.equal(stats.overall.total_with_result, 0);
  });

  it('computes win rate, profit factor and expectancy over closed trades', () => {
    const a = journal.logSetup(validLong(), opts);
    const b = journal.logSetup(validLong(), opts);
    const c = journal.logSetup(validLong(), opts);
    journal.updateStatus({ id: a.id, status: 'TP1_HIT', result_r: 2 }, opts);
    journal.updateStatus({ id: b.id, status: 'TP1_HIT', result_r: 1 }, opts);
    journal.updateStatus({ id: c.id, status: 'SL_HIT', result_r: -1 }, opts);

    const stats = journal.getStats({}, opts);
    assert.equal(stats.overall.total_with_result, 3);
    assert.equal(stats.overall.wins, 2);
    assert.equal(stats.overall.losses, 1);
    assert.equal(stats.overall.win_rate, Number((2 / 3).toFixed(3)));
    assert.equal(stats.overall.profit_factor, 3); // (2+1) / 1
    // expectancy = winRate*avgWin - lossRate*avgLoss = (2/3)*1.5 - (1/3)*1 = 0.667
    assert.equal(stats.overall.expectancy_r, 0.667);
  });

  it('breaks down stats by direction', () => {
    const long = journal.logSetup(validLong({ direction: 'LONG' }), opts);
    const short = journal.logSetup(validLong({ direction: 'SHORT', entry: 4283, sl: 4290, tp1: 4262 }), opts);
    journal.updateStatus({ id: long.id, status: 'TP1_HIT', result_r: 1.5 }, opts);
    journal.updateStatus({ id: short.id, status: 'SL_HIT', result_r: -1 }, opts);

    const stats = journal.getStats({}, opts);
    assert.equal(stats.by_direction.LONG.wins, 1);
    assert.equal(stats.by_direction.SHORT.losses, 1);
  });

  it('filters by news_condition', () => {
    const a = journal.logSetup(validLong({ news_condition: 'HIGH' }), opts);
    const b = journal.logSetup(validLong({ news_condition: 'LOW' }), opts);
    journal.updateStatus({ id: a.id, status: 'SL_HIT', result_r: -1 }, opts);
    journal.updateStatus({ id: b.id, status: 'TP1_HIT', result_r: 2 }, opts);

    const highOnly = journal.getStats({ news_condition: 'HIGH' }, opts);
    assert.equal(highOnly.overall.total_with_result, 1);
    assert.equal(highOnly.overall.losses, 1);
  });
});
