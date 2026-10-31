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

  console.log('phase:', await evalJs(sock, `__m.phase`), 'time:', await evalJs(sock, `+__m.timeLeft.toFixed(1)`));

  // teleport an ICE bean right next to a WATER bean → should freeze
  await evalJs(sock, `(() => { const m=__m; const w=m.ents.find(e=>e.team==='water'&&!e.isPlayer); const t=m.ents.find(e=>e.team==='ice'&&!e.isPlayer&&!e.frozen); t.x=w.x+.4; t.z=w.z; t.tgt=null; window.__fr=t.name; return 1; })()`);
  await sleep(2500);
  console.log('frozen:', await evalJs(sock, `__m.iceFrozenCount`), 'who:', await evalJs(sock, `__fr`));
  await shot(sock, 'i3-freeze-live');

  // teleport camera target = player next to them for a closeup
  await evalJs(sock, `(() => { const m=__m; const f=m.ents.find(e=>e.name===__fr); m.player.x=f.x+2; m.player.z=f.z+2; m.camDist=12; return 1; })()`);
  await sleep(700);
  await shot(sock, 'i3-freeze-close');

  // wait for a rescue attempt — watch frozen count over time
  for (let i = 0; i < 6; i++) {
    await sleep(3000);
    console.log('t+%ds frozen=%d', (i + 1) * 3, await evalJs(sock, `__m.iceFrozenCount`));
  }
  await shot(sock, 'i3-late');

  // end the match quickly to see results screen
  await evalJs(sock, `__m.timeLeft = 2; 'x'`);
  await sleep(4000);
  console.log('over:', await evalJs(sock, `__m.over`), 'winner:', await evalJs(sock, `__m.winTeam`));
  await sleep(2000);
  await shot(sock, 'i3-results');
  console.log('done');
  process.exit(0);
})();
