import WebSocket from 'ws';

const targetId = process.argv[2];
const label = process.argv[3];

const ws = new WebSocket(`ws://127.0.0.1:9222/devtools/page/${targetId}`, { perMessageDeflate: false });
let id = 0;
const pending = new Map();
function send(method, params) {
  return new Promise((res, rej) => {
    const mid = ++id;
    pending.set(mid, { res, rej });
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
}
ws.on('message', (d) => {
  const m = JSON.parse(d.toString());
  if (m.id && pending.has(m.id)) {
    const { res, rej } = pending.get(m.id);
    pending.delete(m.id);
    if (m.error) rej(new Error(JSON.stringify(m.error)));
    else res(m.result);
  }
});

const evalExpr = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
  return r.result.value;
};

ws.on('open', async () => {
  try {
    await send('Runtime.enable', {});
    const script = `(async () => {
      const LABEL = ${JSON.stringify(label)};
      const cells = [...document.querySelectorAll('td[class*="groupCell"]')];
      const target = cells.find(c => c.innerText.trim().startsWith(LABEL));
      if (!target) return { error: 'group not found' };
      const opened = target.className.includes('groupOpened');
      if (!opened) { target.querySelector('div')?.click() || target.click(); await new Promise(r=>setTimeout(r,1500)); }
      // find scroll container
      let el = target, sc = null;
      while (el) { if (el.scrollHeight > el.clientHeight + 30) { sc = el; break; } el = el.parentElement; }
      const rowsMap = new Map();
      const collect = () => {
        const tbl = target.closest('table');
        if (!tbl) return;
        const trs = [...tbl.querySelectorAll('tr')];
        let seen = false;
        for (const tr of trs) {
          const gc = tr.querySelector('td[class*="groupCell"]');
          if (gc) { seen = gc.innerText.trim().startsWith(LABEL); continue; }
          if (seen) {
            const txt = tr.innerText.replace(/\\n/g, '|').trim();
            if (txt) rowsMap.set(txt.slice(0,400), true);
          }
        }
      };
      collect();
      if (sc) {
        const start = target.offsetTop;
        for (let i = 0; i < 25; i++) {
          sc.scrollTop = start + i * 200;
          await new Promise(r=>setTimeout(r,220));
          collect();
        }
      }
      return { opened, hasScroll: !!sc, rows: [...rowsMap.keys()] };
    })()`;
    const out = await evalExpr(script);
    console.log(JSON.stringify(out, null, 1));
  } catch (e) {
    console.error('ERR', e.message);
  }
  ws.close();
  process.exit(0);
});
