import CDP from 'chrome-remote-interface';
import fs from 'node:fs';

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
      if (sym) {
        var row = el.closest('[data-rowkey]') || el.closest('tr') || el.parentElement;
        var cells = row ? row.querySelectorAll('[class*="cell"], [class*="column"]') : [];
        var texts = [];
        for (var j = 0; j < cells.length; j++) texts.push((cells[j].textContent||'').trim());
        results.push({ symbol: sym, section: currentSection, cells: texts });
      }
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

// Reset to top first so section-tracking starts clean.
await Runtime.evaluate({ expression: `(function(){var s=document.querySelector('[class*="listContainer-"]'); if(s) s.scrollTop=0; return s?s.scrollTop:null;})()`, returnByValue: true });
await new Promise(res => setTimeout(res, 400));

const seen = new Map();
let lastScrollTop = -1;
let stableCount = 0;

for (let iter = 0; iter < 40; iter++) {
  const snap = await captureVisible();
  if (snap.error) { console.log('ERROR', snap.error); break; }
  for (const row of snap.rows) {
    if (!seen.has(row.symbol)) seen.set(row.symbol, row);
  }
  if (snap.scrollTop === lastScrollTop) {
    stableCount++;
    if (stableCount >= 2) break;
  } else {
    stableCount = 0;
  }
  lastScrollTop = snap.scrollTop;
  if (snap.scrollTop + snap.clientHeight >= snap.scrollHeight - 5) break;
  await scrollBy(400);
  await new Promise(res => setTimeout(res, 250));
}

const rows = Array.from(seen.values());
fs.writeFileSync(process.env.TEMP + '\\claude_watchlist_full.json', JSON.stringify(rows, null, 2));
console.log('captured', rows.length, 'symbols, sample:', JSON.stringify(rows.slice(0, 3), null, 2));
await client.close();
