import CDP from 'chrome-remote-interface';

const targetId = process.argv[2];

const client = await CDP({ target: targetId, port: 9222 });
const { Runtime } = client;
await Runtime.enable();

async function captureVisible() {
  const expr = `
  (function() {
    var container = document.querySelector('[class*="layout__area--right"]');
    if (!container) return { error: 'no container' };
    var all = container.querySelectorAll('*');
    var results = [];
    var currentSection = null;
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      var cls = el.className ? el.className.toString() : '';
      if (el.tagName === 'DIV' && /separator/i.test(cls)) {
        var labelEl = el.querySelector('[class*="label"]');
        var txt = labelEl ? (labelEl.textContent || '').trim() : (el.textContent || '').trim();
        if (txt) currentSection = txt;
        continue;
      }
      var sym = el.getAttribute && el.getAttribute('data-symbol-full');
      if (sym) results.push({ symbol: sym, section: currentSection });
    }
    var scroller = document.querySelector('[class*="listContainer-"]');
    return { rows: results, scrollTop: scroller ? scroller.scrollTop : null, scrollHeight: scroller ? scroller.scrollHeight : null, clientHeight: scroller ? scroller.clientHeight : null };
  })()
  `;
  const r = await Runtime.evaluate({ expression: expr, returnByValue: true });
  return r.result.value;
}

async function scrollBy(px) {
  const expr = `
  (function() {
    var scroller = document.querySelector('[class*="listContainer-"]');
    if (!scroller) return null;
    scroller.scrollTop = scroller.scrollTop + ${px};
    return scroller.scrollTop;
  })()
  `;
  const r = await Runtime.evaluate({ expression: expr, returnByValue: true });
  return r.result.value;
}

const seen = new Map(); // symbol -> section
let lastScrollTop = -1;
let stableCount = 0;

for (let iter = 0; iter < 40; iter++) {
  const snap = await captureVisible();
  if (snap.error) { console.log('ERROR', snap.error); break; }
  for (const row of snap.rows) {
    if (!seen.has(row.symbol)) seen.set(row.symbol, row.section);
  }
  if (snap.scrollTop === lastScrollTop) {
    stableCount++;
    if (stableCount >= 2) break; // reached bottom, two identical reads in a row
  } else {
    stableCount = 0;
  }
  lastScrollTop = snap.scrollTop;
  if (snap.scrollTop + snap.clientHeight >= snap.scrollHeight - 5) break;
  await scrollBy(400);
  await new Promise(res => setTimeout(res, 250));
}

const out = { total: seen.size, bySection: {} };
for (const [symbol, section] of seen.entries()) {
  const key = section || '(no section)';
  if (!out.bySection[key]) out.bySection[key] = [];
  out.bySection[key].push(symbol);
}
console.log(JSON.stringify(out, null, 2));
await client.close();
