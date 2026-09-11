import CDP from 'chrome-remote-interface';

const targetId = process.argv[2];

const client = await CDP({ target: targetId, port: 9222 });
const { Runtime } = client;
await Runtime.enable();

const expr = `
(function() {
  var container = document.querySelector('[class*="layout__area--right"]');
  if (!container) return { error: 'no container' };
  var all = container.querySelectorAll('*');
  var results = [];
  var currentSection = null;
  var seenSymbols = new Set();
  for (var i = 0; i < all.length; i++) {
    var el = all[i];
    var cls = el.className ? el.className.toString() : '';
    // Section-header row: a div whose class contains 'separator' (TradingView's watchlist group divider)
    if (el.tagName === 'DIV' && /separator/i.test(cls)) {
      var labelEl = el.querySelector('[class*="label"]');
      var txt = labelEl ? (labelEl.textContent || '').trim() : (el.textContent || '').trim();
      if (txt) currentSection = txt;
      continue;
    }
    var sym = el.getAttribute && el.getAttribute('data-symbol-full');
    if (sym && !seenSymbols.has(sym)) {
      seenSymbols.add(sym);
      results.push({ symbol: sym, section: currentSection });
    }
  }
  return { sections: results.map(r => r.section).filter((v,i,a)=>a.indexOf(v)===i), rows: results };
})()
`;
const result = await Runtime.evaluate({ expression: expr, returnByValue: true });
console.log(JSON.stringify(result.result.value, null, 2));
await client.close();
