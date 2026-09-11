import { register } from '../router.js';
import * as core from '../../core/health.js';
import { update } from '../../core/update.js';

register('status', {
  description: 'Check CDP connection to TradingView (exit 2 when not connected)',
  options: {
    'check-update': { type: 'boolean', description: 'Also compare the local git HEAD with GitHub (network call; off by default)' },
  },
  handler: async (opts) => {
    const result = await core.healthCheck({ check_update: !!opts['check-update'] });
    if (result.cdp_connected === false) {
      // The JSON is the answer; exit 2 = connection failure, same as every other command.
      console.log(JSON.stringify(result, null, 2));
      process.exit(2);
    }
    return result;
  },
});

register('launch', {
  description: 'Launch TradingView with CDP enabled',
  options: {
    port: { type: 'string', short: 'p', description: 'CDP port (default 9222)' },
    'no-kill': { type: 'boolean', description: 'Do not kill existing instances' },
  },
  handler: (opts) => core.launch({
    port: opts.port ? Number(opts.port) : undefined,
    kill_existing: !opts['no-kill'],
  }),
});

register('update', {
  description: 'Update to the latest version (git fast-forward + npm ci if deps changed)',
  handler: () => update({}),
});
