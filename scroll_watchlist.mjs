import CDP from 'chrome-remote-interface';

const targetId = process.argv[2];
const amount = process.argv[3] || 2000;

const client = await CDP({ target: targetId, port: 9222 });
const { Runtime } = client;
await Runtime.enable();

const expr = `
(function() {
  var container = document.querySelector('[class*="layout__area--right"] [class*="scroll"]')
    || document.querySelector('[class*="layout__area--right"]');
  if (!container) return 'no container';
  container.scrollTop = container.scrollTop + ${amount};
  return 'scrolled to ' + container.scrollTop + ' of ' + container.scrollHeight;
})()
`;
const result = await Runtime.evaluate({ expression: expr, returnByValue: true });
console.log(result.result.value);
await client.close();
