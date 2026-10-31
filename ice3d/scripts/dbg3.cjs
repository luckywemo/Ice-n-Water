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
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(`${OUT}/${name}.png`, Buffer.from(r.data, 'base64'));
  console.log('shot', name);
};

(async () => {
  const { default: WebSocket } = await import('ws');
  const sock = new WebSocket(await wsUrl());
  await new Promise((r) => sock.on('open', r));
  await send(sock, 'Page.enable');

  // wait for menu → start a match → wait until play phase (slow env)
  for (let i = 0; i < 30; i++) {
    if (await evalJs(sock, `document.getElementById('menu').classList.contains('show')`)) break;
    await sleep(1000);
  }
  console.log('menu up');
  await evalJs(sock, `document.getElementById('btnPlay').click(); 'x'`);
  await sleep(400);
  await evalJs(sock, `document.getElementById('btnStart').click(); 'x'`);
  for (let i = 0; i < 60; i++) {
    const p = await evalJs(sock, `__m ? __m.phase : 'none'`);
    if (p === 'play') break;
    await sleep(1000);
  }
  console.log('phase:', await evalJs(sock, `__m.phase`));
  await shot(sock, 'i3-live1');

  // teleport ICE next to WATER → freeze
  await evalJs(sock, `(() => { const m=__m; const w=m.ents.find(e=>e.team==='water'&&!e.isPlayer); const t=m.ents.find(e=>e.team==='ice'&&!e.isPlayer&&!e.frozen); t.x=w.x+.4; t.z=w.z; window.__fr=t.name; return 1; })()`);
  for (let i = 0; i < 10; i++) {
    if (await evalJs(sock, `__m.iceFrozenCount`) > 0) break;
    await sleep(800);
  }
  console.log('frozen:', await evalJs(sock, `__m.iceFrozenCount`), 'of', await evalJs(sock, `__fr`));

  // closeup on the frozen bean
  await evalJs(sock, `(() => { const m=__m; const f=m.ents.find(e=>e.name===__fr); m.player.x=f.x+2.5; m.player.z=f.z+2; m.camDist=11; return 1; })()`);
  await sleep(800);
  await shot(sock, 'i3-freeze-close');

  // rescue watch — does an AI thaw them?
  let rescued = false;
  for (let i = 0; i < 20; i++) {
    const f = await evalJs(sock, `__m.iceFrozenCount`);
    if (f === 0) { rescued = true; break; }
    await sleep(1500);
  }
  console.log('rescued by AI:', rescued);
  await shot(sock, 'i3-after-rescue');

  // fast-forward to the end → results
  await evalJs(sock, `__m.timeLeft = 1.5; 'x'`);
  await sleep(6000);
  console.log('over:', await evalJs(sock, `__m.over`), 'winner:', await evalJs(sock, `__m.winTeam`));
  await sleep(2500);
  await shot(sock, 'i3-results');
  process.exit(0);
})();
