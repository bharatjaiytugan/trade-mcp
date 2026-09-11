import CDP from 'chrome-remote-interface';

const targetId = process.argv[2];
const searchText = process.argv[3];

const client = await CDP({ target: targetId, port: 9222 });
const { Runtime } = client;
await Runtime.enable();

const expr = `
(function() {
  var container = document.querySelector('[class*="layout__area--right"]');
  if (!container) return { error: 'no container' };
  var all = container.querySelectorAll('*');
  var matches = [];
  for (var i = 0; i < all.length; i++) {
    var el = all[i];
    if (el.children.length === 0 && (el.textContent || '').trim() === ${JSON.stringify(searchText)}) {
      var chain = [];
      var cur = el;
      for (var d = 0; d < 5 && cur; d++) {
        chain.push({ tag: cur.tagName, cls: cur.className ? cur.className.toString() : '', role: cur.getAttribute && cur.getAttribute('role') });
        cur = cur.parentElement;
      }
      matches.push(chain);
    }
  }
  return matches;
})()
`;
const result = await Runtime.evaluate({ expression: expr, returnByValue: true });
console.log(JSON.stringify(result.result.value, null, 2));
await client.close();
