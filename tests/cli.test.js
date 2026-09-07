/**
 * CLI unit tests — no TradingView connection needed.
 * Tests: help output, pine analyze, pine check, error handling, exit codes.
 *
 * Run: node --test tests/cli.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, execSync } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { writeFileSync, unlinkSync } from 'fs';
import { extractTabFlag, isConnectionFailure } from '../src/cli/router.js';

function require_fs() { return { writeFileSync, unlinkSync }; }

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = join(__dirname, '..', 'src', 'cli', 'index.js');

function run(args, opts = {}) {
  try {
    const stdout = execFileSync('node', [CLI, ...args], {
      encoding: 'utf-8',
      timeout: 15000,
      ...opts,
    });
    return { stdout, exitCode: 0 };
  } catch (err) {
    return {
      stdout: err.stdout || '',
      stderr: err.stderr || '',
      exitCode: err.status,
    };
  }
}

describe('CLI — help and routing', () => {
  it('--help shows command list', () => {
    const { stdout, exitCode } = run(['--help']);
    assert.equal(exitCode, 0);
    assert.ok(stdout.includes('Usage: tv'));
    assert.ok(stdout.includes('status'));
    assert.ok(stdout.includes('pine'));
    assert.ok(stdout.includes('quote'));
  });

  it('-h is same as --help', () => {
    const { stdout, exitCode } = run(['-h']);
    assert.equal(exitCode, 0);
    assert.ok(stdout.includes('Usage: tv'));
  });

  it('no args shows help', () => {
    const { stdout, exitCode } = run([]);
    assert.equal(exitCode, 0);
    assert.ok(stdout.includes('Usage: tv'));
  });

  it('unknown command exits 1', () => {
    const { exitCode, stderr } = run(['nonexistent']);
    assert.equal(exitCode, 1);
    assert.ok(stderr.includes('Unknown command'));
  });

  it('pine --help shows subcommands', () => {
    const { stdout, exitCode } = run(['pine', '--help']);
    assert.equal(exitCode, 0);
    assert.ok(stdout.includes('get'));
    assert.ok(stdout.includes('set'));
    assert.ok(stdout.includes('compile'));
    assert.ok(stdout.includes('analyze'));
    assert.ok(stdout.includes('check'));
  });

  it('ohlcv --help shows options', () => {
    const { stdout, exitCode } = run(['ohlcv', '--help']);
    assert.equal(exitCode, 0);
    assert.ok(stdout.includes('--count'));
    assert.ok(stdout.includes('--summary'));
  });
});

describe('CLI — pine analyze (offline)', () => {
  it('analyzes clean v6 script', () => {
    const source = '//@version=6\nindicator("test")\nplot(close)';
    const { stdout, exitCode } = run(['pine', 'analyze'], { input: source });
    assert.equal(exitCode, 0);
    const result = JSON.parse(stdout);
    assert.equal(result.success, true);
    assert.equal(result.issue_count, 0);
  });

  it('detects array out of bounds', () => {
    const source = '//@version=6\nindicator("test")\narr = array.from(1, 2, 3)\nval = array.get(arr, 5)';
    const { stdout, exitCode } = run(['pine', 'analyze'], { input: source });
    assert.equal(exitCode, 0);
    const result = JSON.parse(stdout);
    assert.equal(result.issue_count, 1);
    assert.ok(result.diagnostics[0].message.includes('out of bounds'));
  });

  it('detects strategy.entry without strategy()', () => {
    const source = '//@version=6\nindicator("test")\nstrategy.entry("long", strategy.long)';
    const { stdout, exitCode } = run(['pine', 'analyze'], { input: source });
    assert.equal(exitCode, 0);
    const result = JSON.parse(stdout);
    assert.ok(result.diagnostics.some(d => d.message.includes('strategy()')));
  });

  it('errors without input', () => {
    // When stdin is a TTY (no pipe), analyze should error
    const { exitCode, stderr } = run(['pine', 'analyze']);
    assert.equal(exitCode, 1);
    assert.ok(stderr.includes('No source provided'));
  });

  it('reads --file flag', () => {
    const { writeFileSync, unlinkSync } = require_fs();
    const tmpFile = join(__dirname, '_test_script.pine');
    writeFileSync(tmpFile, '//@version=6\nindicator("test")\nplot(close)');
    try {
      const { stdout, exitCode } = run(['pine', 'analyze', '--file', tmpFile]);
      assert.equal(exitCode, 0);
      const result = JSON.parse(stdout);
      assert.equal(result.success, true);
    } finally {
      unlinkSync(tmpFile);
    }
  });
});

describe('CLI — global --tab flag', () => {
  it('extractTabFlag: absent flag leaves args untouched', () => {
    const r = extractTabFlag(['quote', 'AAPL']);
    assert.deepEqual(r, { args: ['quote', 'AAPL'], tabId: null, error: null });
  });

  it('extractTabFlag: --tab <id> is stripped and returned', () => {
    const r = extractTabFlag(['--tab', 'ABC123', 'quote', 'AAPL']);
    assert.equal(r.tabId, 'ABC123');
    assert.deepEqual(r.args, ['quote', 'AAPL']);
    assert.equal(r.error, null);
  });

  it('extractTabFlag: --tab=<id> inline form works anywhere in argv', () => {
    const r = extractTabFlag(['quote', 'AAPL', '--tab=XYZ']);
    assert.equal(r.tabId, 'XYZ');
    assert.deepEqual(r.args, ['quote', 'AAPL']);
  });

  it('extractTabFlag: does not mutate its input', () => {
    const input = ['--tab', 'T1', 'state'];
    extractTabFlag(input);
    assert.deepEqual(input, ['--tab', 'T1', 'state']);
  });

  it('extractTabFlag: --tab with no value is an error', () => {
    assert.match(extractTabFlag(['--tab']).error, /--tab requires/);
    assert.match(extractTabFlag(['--tab=']).error, /--tab requires/);
    // A following flag is not a target id.
    assert.match(extractTabFlag(['--tab', '--help']).error, /--tab requires/);
  });

  it('CLI: --tab <id> before --help still prints help (exit 0)', () => {
    const { stdout, exitCode } = run(['--tab', 'ABC123', '--help']);
    assert.equal(exitCode, 0);
    assert.ok(stdout.includes('Usage: tv'));
  });

  it('CLI: --tab=<id> with a subcommand help routes normally', () => {
    const { stdout, exitCode } = run(['--tab=ABC123', 'pine', '--help']);
    assert.equal(exitCode, 0);
    assert.ok(stdout.includes('analyze'));
  });

  it('CLI: bare --tab exits 1 with a usage message', () => {
    const { exitCode, stderr } = run(['--tab']);
    assert.equal(exitCode, 1);
    assert.ok(stderr.includes('--tab requires'));
  });
});

describe('CLI — exit code classification', () => {
  it('connection-shaped errors map to exit 2', () => {
    assert.ok(isConnectionFailure('CDP connection failed after 5 attempts: fetch failed'));
    assert.ok(isConnectionFailure('TradingView is not reachable: connection refused at 127.0.0.1:9222 (ECONNREFUSED)'));
    assert.ok(isConnectionFailure('No TradingView CHART tab is open. The only TradingView page found is "Screener"'));
    assert.ok(isConnectionFailure('No TradingView chart target found. Is TradingView open with a chart?'));
  });

  it('ordinary command errors stay exit 1', () => {
    assert.equal(isConnectionFailure('Unknown chart type: Foo'), false);
    assert.equal(isConnectionFailure('chart did not confirm symbol CIFR within 10s; chart shows AAPL'), false);
  });
});

// Calls TradingView's compile endpoint over the network — opt in with TV_TEST_NETWORK=1.
describe('CLI — pine check (server compile)', { skip: !process.env.TV_TEST_NETWORK && 'set TV_TEST_NETWORK=1 to run (network call to TradingView)' }, () => {
  it('compiles valid Pine Script', () => {
    const source = '//@version=6\nindicator("test")\nplot(close)';
    const { stdout, exitCode } = run(['pine', 'check'], { input: source });
    assert.equal(exitCode, 0);
    const result = JSON.parse(stdout);
    assert.equal(result.success, true);
    assert.equal(result.compiled, true);
  });

  it('returns errors for invalid Pine Script', () => {
    const source = '//@version=6\nindicator("test")\nplot(nonexistent_var)';
    const { stdout, exitCode } = run(['pine', 'check'], { input: source });
    assert.equal(exitCode, 0);
    const result = JSON.parse(stdout);
    assert.equal(result.compiled, false);
    assert.ok(result.error_count > 0);
  });
});
