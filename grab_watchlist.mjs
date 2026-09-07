// TradingView's watchlist is virtualized: only the rows on screen exist in the DOM, which is
// why a single read returns ~54 of 150+. Scroll in steps and accumulate, keeping section
// headers so index rows can be dropped by name rather than guessed at.
import CDP from 'chrome-remote-interface';

const targetId = process.argv[2];
const client = await CDP({ target: targetId, port: 9222 });
const { Runtime } = client;
await Runtime.enable();

const evalJS = async (expr) => {
  const { result } = await Runtime.evaluate({ expression: expr, returnByValue: true, awaitPromise: true });
  return result.value;
};

const SCAN = `(function(){
  var rows = document.querySelectorAll('[class*="listContainer"] [data-symbol-full], [data-symbol-full]');
  var out = [];
  for (var i=0;i<rows.length;i++){
    var s = rows[i].getAttribute('data-symbol-full');
    if (!s) continue;
    var sec = null, p = rows[i];
    while (p && p.parentElement) {
      p = p.parentElement;
      var prev = p.previousElementSibling;
      while (prev) {
        var c = prev.className ? prev.className.toString() : '';
        if (/separator|group/i.test(c) && prev.innerText) { sec = prev.innerText.trim().split('\\n')[0]; break; }
        prev = prev.previousElementSibling;
      }
      if (sec) break;
    }
    out.push({symbol:s, section:sec});
  }
  return out;
})()`;

const CONTAINER = `(function(){
  var els = document.querySelectorAll('div');
  for (var i=0;i<els.length;i++){
    var e = els[i];
    if (e.scrollHeight > e.clientHeight + 50 && e.querySelector('[data-symbol-full]')) return true;
  }
  return false;
})()`;

const SCROLL = (px) => `(function(){
  var els = document.querySelectorAll('div');
  for (var i=0;i<els.length;i++){
    var e = els[i];
    if (e.scrollHeight > e.clientHeight + 50 && e.querySelector('[data-symbol-full]')) {
      e.scrollTop = ${px};
      return {top: e.scrollTop, max: e.scrollHeight - e.clientHeight};
    }
  }
  return null;
})()`;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

console.error('scrollable found:', await evalJS(CONTAINER));

const seen = new Map();
let pos = 0, max = 1, guard = 0;
while (guard++ < 200) {
  const st = await evalJS(SCROLL(pos));
  await sleep(220);
  const rows = await evalJS(SCAN);
  for (const r of (rows || [])) if (!seen.has(r.symbol)) seen.set(r.symbol, r.section);
  if (!st) break;
  max = st.max;
  if (pos >= max) break;
  pos = Math.min(pos + 300, max);
}
console.error(`scrolled to ${pos}/${max}, collected ${seen.size}`);

const out = [...seen.entries()].map(([symbol, section]) => ({ symbol, section }));
console.log(JSON.stringify(out, null, 1));
await client.close();
