const CDP = 'http://localhost:9222';
const fs = require('fs');
const OUT = 'C:/Users/H/Desktop/app/LuckyMilitia/ice3d/shots';
async function wsUrl() {
  const list = await (await fetch(CDP + '/json/list')).json();
  const page = list.find((t) => t.type === 'page' && t.url.includes('localhost:5199'));
  return page.webSocketDebuggerUrl;
}
const send = (sock, method, params = {}) => new Promise((res) => {
  const id = ++send.id;
  sock.send(JSON.stringify({ id, method, params }));
  sock.on('message', function h(m) { const d = JSON.parse(m); if (d.id === id) { sock.off('message', h); res(d.result); } });
});
send.id = 0;
const evalJs = (sock, expr) =>
  send(sock, 'Runtime.evaluate', { expression: expr, returnByValue: true }).then((r) => r?.result?.value);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = async (sock, name) => {
  const r = await send(sock, 'Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(`${OUT}/${name}.png`, Buffer.from(r.data, 'base64'));
};

(async () => {
  const { default: WebSocket } = await import('ws');
  const sock = new WebSocket(await wsUrl());
  await new Promise((r) => sock.on('open', r));
  await send(sock, 'Page.enable');

  // match already running from dbg6 — check state; if not in drops play, restart
  let mode = await evalJs(sock, `__m ? __m.mode : 'none'`);
  if (mode !== 'drops' || (await evalJs(sock, `__m.over`))) {
    await evalJs(sock, `document.getElementById('btnPlay') && document.getElementById('btnPlay').click(); 'x'`);
    await sleep(1500);
    await evalJs(sock, `[...document.querySelectorAll('.mode')].find(m=>m.textContent.includes('WATER RUN')).click(); 'x'`);
    await sleep(300);
    await evalJs(sock, `document.getElementById('btnStart').click(); 'x'`);
    await sleep(2500);
  }
  // fast-forward through countdown & intro
  await evalJs(sock, `__m.cd = 0.05; 'x'`);
  await sleep(800);
  console.log('phase:', await evalJs(sock, `__m.phase`));

  // collect 6 drops via teleport
  const need = await evalJs(sock, `__m.dropsNeed`);
  for (let i = 0; i < 8; i++) {
    await evalJs(sock, `(() => { const d=__m.drops.find(d=>!d.taken); if(!d) return; const p=__m.player; p.x=d.x; p.z=d.z; p.y=0.2; })()`);
    await sleep(600);
    if ((await evalJs(sock, `__m.dropsGot`)) >= need) break;
  }
  console.log('got:', await evalJs(sock, `__m.dropsGot`), 'twist:', await evalJs(sock, `__m.twistDone`));
  await sleep(1500);
  console.log('ents:', await evalJs(sock, `__m.ents.length`), 'waterCount:', await evalJs(sock, `__m.ents.filter(e=>e.team==='water').length`));

  // reach the exit
  await evalJs(sock, `(() => { const p=__m.player; p.x=__m.exitX; p.z=__m.exitZ; p.y=0.2; })()`);
  await sleep(2500);
  console.log('over:', await evalJs(sock, `__m.over`), '| winner:', await evalJs(sock, `__m.winTeam`), '| why:', await evalJs(sock, `__m.winWhy`));
  await shot(sock, 'i3c-dropswin');
  console.log('done');
  process.exit(0);
})();
