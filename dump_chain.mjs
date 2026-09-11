import WebSocket from 'ws';
const targetId = process.argv[2];
const ws = new WebSocket(`ws://127.0.0.1:9222/devtools/page/${targetId}`, { perMessageDeflate: false });
let id = 0; const pending = new Map();
function send(method, params) { return new Promise((res, rej) => { const mid = ++id; pending.set(mid, { res, rej }); ws.send(JSON.stringify({ id: mid, method, params })); }); }
ws.on('message', d => { const m = JSON.parse(d.toString()); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); } });
ws.on('open', async () => {
  await send('Runtime.enable', {});
  const r = await send('Runtime.evaluate', { expression: `(() => {
     const cells=[...document.querySelectorAll('td[class*="groupCell"]')];
     const tbl = cells[0]?.closest('table');
     if(!tbl) return 'no table';
     const trs=[...tbl.querySelectorAll('tr')];
     return trs.map((tr,i)=> i+': '+tr.innerText.replace(/\\n/g,'|').slice(0,300)).join('\\n');
  })()`, returnByValue: true });
  console.log(r.result.value);
  ws.close(); process.exit(0);
});
