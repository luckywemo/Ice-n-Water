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
  console.log('shot', name);
};

(async () => {
  const { default: WebSocket } = await import('ws');
  const sock = new WebSocket(await wsUrl());
  await new Promise((r) => sock.on('open', r));
  await send(sock, 'Page.enable');

  await evalJs(sock, `location.href='http://localhost:5199/'; 'x'`);
  for (let i = 0; i < 30; i++) {
    if (await evalJs(sock, `document.getElementById('menu').classList.contains('show')`)) break;
    await sleep(1000);
  }
  await evalJs(sock, `document.getElementById('btnPlay').click(); 'x'`);
  await sleep(1200);
  await shot(sock, 'i3c-setup-podium');

  // pick WATER RUN mode (2nd mode card)
  await evalJs(sock, `document.querySelectorAll('.mode')[1].click(); 'x'`);
  await sleep(300);
  await evalJs(sock, `document.getElementById('btnStart').click(); 'x'`);

  // catch the skydive mid-fall (~1s into countdown)
  await sleep(1400);
  await shot(sock, 'i3c-skydive');

  for (let i = 0; i < 60; i++) {
    if (await evalJs(sock, `__m ? __m.phase : 'none'`) === 'play') break;
    await sleep(1000);
  }
  console.log('phase:', await evalJs(sock, `__m.phase`), '| team:', await evalJs(sock, `__m.player.team`), '| drops:', await evalJs(sock, `__m.drops.length`));
  await shot(sock, 'i3c-drops-field');

  // teleport-collect all 6 needed drops
  for (let i = 0; i < 6; i++) {
    await evalJs(sock, `(() => { const d=__m.drops.find(d=>!d.taken); if(!d) return 'none'; const p=__m.player; p.x=d.x; p.z=d.z; return 1; })()`);
    await sleep(400);
  }
  console.log('got:', await evalJs(sock, `__m.dropsGot`), 'twist:', await evalJs(sock, `__m.twistDone`));
  await sleep(1200);
  await shot(sock, 'i3c-twist');
  console.log('exit at:', await evalJs(sock, `JSON.stringify({x:+__m.exitX.toFixed(0),z:+__m.exitZ.toFixed(0)})`), 'ents now:', await evalJs(sock, `__m.ents.length`));

  // run to the exit → should win instantly
  await evalJs(sock, `(() => { const p=__m.player; p.x=__m.exitX; p.z=__m.exitZ; return 1; })()`);
  await sleep(3000);
  console.log('over:', await evalJs(sock, `__m.over`), 'winner:', await evalJs(sock, `__m.winTeam`));
  await shot(sock, 'i3c-win');
  process.exit(0);
})();
