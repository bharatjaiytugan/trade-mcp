import { register } from '../router.js';
import * as core from '../../core/tab.js';

register('tab', {
  description: 'Tab management (list, new, close, switch)',
  subcommands: new Map([
    ['list', {
      description: 'List all open chart tabs',
      handler: () => core.list(),
    }],
    ['new', {
      description: 'Open a new chart tab (--layout new|<saved name>, --name <label>)',
      options: {
        layout: { type: 'string', description: 'Layout to open: "new" for a blank chart, or a saved layout name' },
        name: { type: 'string', description: 'Label for the new tab' },
      },
      // core.newTab already accepted these; the CLI passed nothing, so `tv tab new`
      // could only ever land on the layout picker and never finish opening a chart.
      // Without a chart in it the new tab is not a CDP chart target, so it cannot
      // be pinned - which made the whole open-your-own-tab workflow unreachable
      // from the CLI.
      handler: (opts) => core.newTab({ layout: opts.layout ?? 'new', name: opts.name }),
    }],
    ['close', {
      description: 'Close the current tab',
      handler: () => core.closeTab(),
    }],
    ['switch', {
      description: 'Switch to a tab by index',
      handler: (opts, positionals) => {
        if (positionals[0] === undefined) throw new Error('Index required. Usage: tv tab switch 0');
        return core.switchTab({ index: positionals[0] });
      },
    }],
  ]),
});
