import CDP from 'chrome-remote-interface';

const targetId = process.argv[2];

const client = await CDP({ target: targetId, port: 9222 });
const { Runtime } = client;
await Runtime.enable();

const expr = `
(function() {
  var container = document.querySelector('[class*="layout__area--right"]');
  if (!container) return 'no container';
  var all = container.querySelectorAll('*');
  var candidates = [];
  for (var i = 0; i < all.length; i++) {
    var el = all[i];
    if (el.scrollHeight > el.clientHeight + 20 && el.clientHeight > 50) {
      candidates.push({ tag: el.tagName, cls: (el.className||'').toString().slice(0,60), scrollHeight: el.scrollHeight, clientHeight: el.clientHeight });
    }
  }
  return candidates;
})()
`;
const result = await Runtime.evaluate({ expression: expr, returnByValue: true });
console.log(JSON.stringify(result.result.value, null, 2));
await client.close();
