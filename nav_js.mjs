import CDP from 'chrome-remote-interface';

const targetId = process.argv[2];
const symbol = process.argv[3];

const client = await CDP({ target: targetId, port: 9222 });
const { Runtime } = client;
await Runtime.enable();
const url = `https://www.tradingview.com/options/chain/?symbol=${encodeURIComponent(symbol)}`;
await Runtime.evaluate({ expression: `window.location.href = ${JSON.stringify(url)}` });
console.log('triggered JS navigation to', url);
await client.close();
