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
  await send(sock, 'Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });

  // is results up from the last match?
  console.log('results shown:', await evalJs(sock, `document.getElementById('results').classList.contains('show')`));
  console.log('match over:', await evalJs(sock, `__m ? __m.over : 'gone'`));
  await shot(sock, 'i3-results2');

  // rematch via button → verify it resets
  await evalJs(sock, `document.getElementById('btnRematch').click(); 'x'`);
  await sleep(3000);
  console.log('new match:', await evalJs(sock, `JSON.stringify({phase:__m.phase,time:+__m.timeLeft.toFixed(0),ents:__m.ents.length})`));

  // pause test
  await evalJs(sock, `dispatchEvent(new KeyboardEvent('keydown',{key:'p'})); 'x'`);
  await sleep(800);
  console.log('paused:', await evalJs(sock, `document.getElementById('pause').classList.contains('show')`));
  await shot(sock, 'i3-pause');
  await evalJs(sock, `document.getElementById('btnQuit').click(); 'x'`);
  await sleep(800);
  console.log('back at menu:', await evalJs(sock, `document.getElementById('menu').classList.contains('show')`));
  await shot(sock, 'i3-menu2');
  process.exit(0);
})();
