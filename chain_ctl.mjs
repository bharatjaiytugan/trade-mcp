import WebSocket from 'ws';
const targetId = process.argv[2];
const mode = process.argv[3] || 'list';
const arg = process.argv[4] || '';
const ws = new WebSocket(`ws://127.0.0.1:9222/devtools/page/${targetId}`, { perMessageDeflate: false });
let id = 0; const pending = new Map();
function send(m, p) { return new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method: m, params: p })); }); }
ws.on('message', d => { const m = JSON.parse(d.toString()); if (m.id && pending.has(m.id)) { const q = pending.get(m.id); pending.delete(m.id); m.error ? q.rej(new Error(JSON.stringify(m.error))) : q.res(m.result); } });

const scripts = {
  list: `(() => {
    const els=[...document.querySelectorAll('button,[role="button"],[class*="button"]')];
    const out=[];
    for(const e of els){const t=(e.innerText||'').replace(/\\n/g,'/').trim();if(t&&t.length<40)out.push(t);}
    return [...new Set(out)].join(' :: ');
  })()`,
  click: `(() => {
    const T=${JSON.stringify(arg)};
    const els=[...document.querySelectorAll('button,[role="button"],[role="option"],[class*="button"],[class*="item"]')];
    const e=els.find(x=>(x.innerText||'').trim()===T)||els.find(x=>(x.innerText||'').trim().startsWith(T));
    if(!e) return 'not found: '+T;
    e.click(); return 'clicked: '+(e.innerText||'').replace(/\\n/g,'/').slice(0,60);
  })()`,
};
ws.on('open', async () => {
  await send('Runtime.enable', {});
  const r = await send('Runtime.evaluate', { expression: scripts[mode], returnByValue: true });
  console.log(r.result.value);
  ws.close(); process.exit(0);
});
