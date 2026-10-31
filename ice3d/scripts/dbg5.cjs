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
  await shot(sock, 'i3b-menu');

  await evalJs(sock, `document.getElementById('btnPlay').click(); 'x'`);
  await sleep(700);
  await shot(sock, 'i3b-setup');
  await evalJs(sock, `document.getElementById('btnStart').click(); 'x'`);

  for (let i = 0; i < 60; i++) {
    const p = await evalJs(sock, `__m ? __m.phase : 'none'`);
    if (p === 'play') break;
    await sleep(1000);
  }
  console.log('phase:', await evalJs(sock, `__m.phase`));
  console.log('cast:', await evalJs(sock, `JSON.stringify(__m.ents.map(e=>({n:e.name,t:e.team,b:e.brave})))`));
  await shot(sock, 'i3b-play');
  process.exit(0);
})();
