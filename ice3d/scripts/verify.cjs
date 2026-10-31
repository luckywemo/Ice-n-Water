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

  await evalJs(sock, `location.href='http://localhost:5199/'; 'ok'`);
  await sleep(4500);
  console.log('menu:', await evalJs(sock, `document.getElementById('menu').classList.contains('show')`));
  await shot(sock, 'i3-menu');

  await evalJs(sock, `document.getElementById('btnPlay').click(); 'x'`);
  await sleep(600);
  await shot(sock, 'i3-setup');

  await evalJs(sock, `document.getElementById('btnStart').click(); 'x'`);
  await sleep(2500);
  await shot(sock, 'i3-intro');
  await sleep(3500);
  console.log('phase:', await evalJs(sock, `__m.phase`));
  console.log('ents:', await evalJs(sock, `JSON.stringify(__m.ents.map(e=>({n:e.name,t:e.team,p:e.isPlayer,f:e.frozen})))`));

  await evalJs(sock, `(() => { const ev=(t,k)=>dispatchEvent(new KeyboardEvent(t,{key:k})); ev('keydown','w'); ev('keydown','d'); window.__kd=()=>{ev('keyup','w');ev('keyup','d')}; return 1; })()`);
  await sleep(1500);
  await shot(sock, 'i3-play1');
  await sleep(1500);
  await shot(sock, 'i3-play2');
  await evalJs(sock, `__kd()`);

  console.log('probe:', await evalJs(sock, `(() => { const p=__m.player; return JSON.stringify({x:+p.x.toFixed(1),z:+p.z.toFixed(1),stam:+p.stamina.toFixed(2),time:+__m.timeLeft.toFixed(1),frozen:__m.iceFrozenCount,phase:__m.phase}); })()`));

  await evalJs(sock, `(() => { const m=__m; const w=m.ents.find(e=>e.team==='water'&&!e.isPlayer); const t=m.ents.find(e=>e.team==='ice'&&!e.isPlayer); t.x=w.x+.3; t.z=w.z; return 'tele'; })()`);
  await sleep(800);
  await shot(sock, 'i3-frozen');
  console.log('frozen now:', await evalJs(sock, `__m.iceFrozenCount`));
  await sleep(4000);
  await shot(sock, 'i3-after');
  console.log('frozen later:', await evalJs(sock, `__m.iceFrozenCount`));

  process.exit(0);
})();
