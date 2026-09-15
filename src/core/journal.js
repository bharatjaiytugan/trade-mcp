/**
 * Trade journal — local persistence for discretionary setups given in chat
 * (not TradingView Strategy Tester results, see performance-analyst agent
 * for that). Tracks a setup from creation through SL/TP resolution so a
 * later analysis can check "is my last call still open, and did it win?"
 * instead of silently starting over.
 *
 * Storage: a single JSON file, gitignored, local to this machine.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_STORE_PATH = join(__dirname, '..', '..', 'data', 'journal.json');

const OPEN_STATUS = 'ACTIVE';
const TERMINAL_STATUSES = ['TP1_HIT', 'TP2_HIT', 'TP3_HIT', 'SL_HIT', 'INVALIDATED', 'EXPIRED'];
const ALL_STATUSES = [OPEN_STATUS, ...TERMINAL_STATUSES];

function load(storePath = DEFAULT_STORE_PATH) {
  if (!existsSync(storePath)) return [];
  try {
    const raw = readFileSync(storePath, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    // Corrupt file — don't crash the server, start fresh in memory.
    // The bad file is left on disk for manual inspection.
    return [];
  }
}

function save(entries, storePath = DEFAULT_STORE_PATH) {
  const dir = dirname(storePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(storePath, JSON.stringify(entries, null, 2), 'utf8');
}

function short(direction, entry, sl) {
  if (!Number.isFinite(entry) || !Number.isFinite(sl)) return null;
  return direction === 'SHORT' ? sl > entry : sl < entry;
}

export function logSetup(input, { storePath } = {}) {
  const { symbol, timeframe, direction, entry, sl, tp1 } = input;
  if (!symbol) throw new Error('symbol is required');
  if (!timeframe) throw new Error('timeframe is required');
  if (direction !== 'LONG' && direction !== 'SHORT') throw new Error('direction must be LONG or SHORT');
  if (!Number.isFinite(entry)) throw new Error('entry must be a number');
  if (!Number.isFinite(sl)) throw new Error('sl must be a number');
  if (!Number.isFinite(tp1)) throw new Error('tp1 must be a number');
  if (short(direction, entry, sl) === false) {
    throw new Error(`sl (${sl}) is not on the invalidation side of entry (${entry}) for a ${direction} setup`);
  }

  const entries = load(storePath);
  const now = new Date().toISOString();
  const risk = Math.abs(entry - sl);
  const record = {
    id: randomUUID().slice(0, 8),
    created_at: now,
    updated_at: now,
    closed_at: null,
    symbol,
    timeframe,
    direction,
    setup_type: input.setup_type ?? null,
    entry_type: input.entry_type ?? null,
    entry,
    sl,
    tp1,
    tp2: Number.isFinite(input.tp2) ? input.tp2 : null,
    tp3: Number.isFinite(input.tp3) ? input.tp3 : null,
    risk,
    confluence_score: Number.isFinite(input.confluence_score) ? input.confluence_score : null,
    htf_bias: input.htf_bias ?? null,
    news_condition: input.news_condition ?? null,
    session: input.session ?? null,
    reasoning: Array.isArray(input.reasoning) ? input.reasoning : (input.reasoning ? [input.reasoning] : []),
    notes: input.notes ?? null,
    status: OPEN_STATUS,
    result_r: null,
    mfe: null,
    mae: null,
  };
  entries.push(record);
  save(entries, storePath);
  return record;
}

export function updateStatus(input, { storePath } = {}) {
  const { id, status } = input;
  if (!id) throw new Error('id is required');
  if (!ALL_STATUSES.includes(status)) throw new Error(`status must be one of: ${ALL_STATUSES.join(', ')}`);

  const entries = load(storePath);
  const idx = entries.findIndex(e => e.id === id);
  if (idx === -1) throw new Error(`No journal entry with id "${id}"`);

  const record = entries[idx];
  record.status = status;
  record.updated_at = new Date().toISOString();
  if (Number.isFinite(input.result_r)) record.result_r = input.result_r;
  if (Number.isFinite(input.mfe)) record.mfe = input.mfe;
  if (Number.isFinite(input.mae)) record.mae = input.mae;
  if (input.notes) record.notes = record.notes ? `${record.notes}\n${input.notes}` : input.notes;
  if (TERMINAL_STATUSES.includes(status) && !record.closed_at) record.closed_at = record.updated_at;

  entries[idx] = record;
  save(entries, storePath);
  return record;
}

export function getById(id, { storePath } = {}) {
  const entries = load(storePath);
  const record = entries.find(e => e.id === id);
  if (!record) throw new Error(`No journal entry with id "${id}"`);
  return record;
}

export function getOpen({ symbol } = {}, { storePath } = {}) {
  const entries = load(storePath);
  return entries
    .filter(e => e.status === OPEN_STATUS && (!symbol || e.symbol === symbol))
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export function getAll({ symbol, status, limit } = {}, { storePath } = {}) {
  let entries = load(storePath);
  if (symbol) entries = entries.filter(e => e.symbol === symbol);
  if (status) entries = entries.filter(e => e.status === status);
  entries = entries.sort((a, b) => b.created_at.localeCompare(a.created_at));
  return Number.isFinite(limit) ? entries.slice(0, limit) : entries;
}

function mean(nums) {
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
}

function summarize(closed) {
  const withR = closed.filter(e => Number.isFinite(e.result_r));
  const wins = withR.filter(e => e.result_r > 0);
  const losses = withR.filter(e => e.result_r <= 0);
  const winSum = wins.reduce((a, e) => a + e.result_r, 0);
  const lossSum = Math.abs(losses.reduce((a, e) => a + e.result_r, 0));
  const winRate = withR.length ? wins.length / withR.length : 0;
  const lossRate = withR.length ? losses.length / withR.length : 0;
  const avgWin = mean(wins.map(e => e.result_r));
  const avgLoss = mean(losses.map(e => Math.abs(e.result_r)));

  // Running-R drawdown (peak-to-trough over the closed sequence, oldest first).
  const chrono = [...withR].sort((a, b) => a.closed_at.localeCompare(b.closed_at));
  let running = 0, peak = 0, maxDrawdown = 0;
  for (const e of chrono) {
    running += e.result_r;
    peak = Math.max(peak, running);
    maxDrawdown = Math.min(maxDrawdown, running - peak);
  }

  return {
    total_setups: closed.length,
    total_with_result: withR.length,
    wins: wins.length,
    losses: losses.length,
    win_rate: Number(winRate.toFixed(3)),
    avg_win_r: Number(avgWin.toFixed(3)),
    avg_loss_r: Number(avgLoss.toFixed(3)),
    profit_factor: lossSum > 0 ? Number((winSum / lossSum).toFixed(3)) : (winSum > 0 ? Infinity : 0),
    expectancy_r: Number((winRate * avgWin - lossRate * avgLoss).toFixed(3)),
    avg_r: withR.length ? Number(mean(withR.map(e => e.result_r)).toFixed(3)) : 0,
    max_drawdown_r: Number(maxDrawdown.toFixed(3)),
  };
}

export function getStats({ symbol, setup_type, timeframe, news_condition, direction } = {}, { storePath } = {}) {
  let entries = load(storePath).filter(e => TERMINAL_STATUSES.includes(e.status));
  if (symbol) entries = entries.filter(e => e.symbol === symbol);
  if (setup_type) entries = entries.filter(e => e.setup_type === setup_type);
  if (timeframe) entries = entries.filter(e => e.timeframe === timeframe);
  if (news_condition) entries = entries.filter(e => e.news_condition === news_condition);
  if (direction) entries = entries.filter(e => e.direction === direction);

  const overall = summarize(entries);
  const byDirection = {
    LONG: summarize(entries.filter(e => e.direction === 'LONG')),
    SHORT: summarize(entries.filter(e => e.direction === 'SHORT')),
  };
  const byTimeframe = {};
  for (const tf of new Set(entries.map(e => e.timeframe))) {
    byTimeframe[tf] = summarize(entries.filter(e => e.timeframe === tf));
  }
  const byNewsCondition = {};
  for (const nc of new Set(entries.map(e => e.news_condition).filter(Boolean))) {
    byNewsCondition[nc] = summarize(entries.filter(e => e.news_condition === nc));
  }
  const bySetupType = {};
  for (const st of new Set(entries.map(e => e.setup_type).filter(Boolean))) {
    bySetupType[st] = summarize(entries.filter(e => e.setup_type === st));
  }

  return { overall, by_direction: byDirection, by_timeframe: byTimeframe, by_news_condition: byNewsCondition, by_setup_type: bySetupType };
}

export const STATUSES = ALL_STATUSES;
