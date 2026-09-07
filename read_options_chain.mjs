import CDP from 'chrome-remote-interface';

const targetId = process.argv[2];
if (!targetId) { console.error('Usage: node read_options_chain.mjs <targetId>'); process.exit(1); }

const client = await CDP({ target: targetId, port: 9222 });
const { Runtime } = client;
await Runtime.enable();

const result = await Runtime.evaluate({
  expression: `document.body.innerText`,
  returnByValue: true,
});

console.log(result.result.value);
await client.close();
