import { z } from 'zod';
import { jsonResult } from './_format.js';
import * as core from '../core/journal.js';

export function registerJournalTools(server) {
  server.tool('journal_log_setup', 'Log a new trade setup to the local trade journal (entry/SL/TP + reasoning). Call this whenever you give the user an actionable LONG/SHORT setup, so a later analysis can check whether it hit SL or TP instead of silently ignoring it.', {
    symbol: z.string().describe('e.g. OANDA:XAUUSD'),
    timeframe: z.string().describe('e.g. "15", "60", "D"'),
    direction: z.enum(['LONG', 'SHORT']),
    entry: z.number(),
    sl: z.number().describe('Stop loss — must be on the invalidation side of entry (below entry for LONG, above for SHORT)'),
    tp1: z.number(),
    tp2: z.number().optional(),
    tp3: z.number().optional(),
    entry_type: z.string().optional().describe('e.g. RETEST_ENTRY, BREAKOUT_ENTRY, CONFIRMATION_ENTRY'),
    setup_type: z.string().optional().describe('e.g. trend_continuation, liquidity_sweep_reversal, resistance_rejection'),
    confluence_score: z.number().min(0).max(100).optional(),
    htf_bias: z.string().optional().describe('Higher-timeframe bias at the time of the call'),
    news_condition: z.enum(['LOW', 'MEDIUM', 'HIGH', 'EXTREME']).optional(),
    session: z.string().optional().describe('ASIA, LONDON, NEW_YORK, OVERLAP'),
    reasoning: z.array(z.string()).optional(),
    notes: z.string().optional(),
  }, async (input) => {
    try { return jsonResult({ success: true, entry: core.logSetup(input) }); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('journal_update_status', 'Update a journal entry\'s status (e.g. once price has hit SL or a TP). Pass result_r (realized R multiple, positive for a win, negative for a loss) whenever the status is terminal so it counts toward stats.', {
    id: z.string(),
    status: z.enum(core.STATUSES),
    result_r: z.number().optional().describe('Realized result in R multiples, e.g. 1.5 for a 1.5R win, -1 for a full stop-out'),
    mfe: z.number().optional().describe('Maximum favorable excursion (price units) observed before close'),
    mae: z.number().optional().describe('Maximum adverse excursion (price units) observed before close'),
    notes: z.string().optional(),
  }, async (input) => {
    try { return jsonResult({ success: true, entry: core.updateStatus(input) }); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('journal_get_open', 'List currently ACTIVE (unresolved) journal entries — call this at the start of a new analysis to check for an existing setup before giving a new one.', {
    symbol: z.string().optional(),
  }, async ({ symbol }) => {
    try { return jsonResult({ success: true, open: core.getOpen({ symbol }) }); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('journal_get_all', 'List journal entries, most recent first, optionally filtered by symbol/status and capped with limit.', {
    symbol: z.string().optional(),
    status: z.enum(core.STATUSES).optional(),
    limit: z.number().optional(),
  }, async (input) => {
    try { return jsonResult({ success: true, entries: core.getAll(input) }); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('journal_get_stats', 'Compute win rate, avg win/loss, profit factor, expectancy, avg R and max drawdown over CLOSED journal entries, broken down by direction/timeframe/news condition/setup type. Only entries with a result_r are counted.', {
    symbol: z.string().optional(),
    setup_type: z.string().optional(),
    timeframe: z.string().optional(),
    news_condition: z.enum(['LOW', 'MEDIUM', 'HIGH', 'EXTREME']).optional(),
    direction: z.enum(['LONG', 'SHORT']).optional(),
  }, async (input) => {
    try { return jsonResult({ success: true, stats: core.getStats(input) }); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });
}
