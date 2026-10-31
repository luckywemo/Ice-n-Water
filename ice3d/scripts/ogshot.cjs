// ogshot — screenshot the card page at exactly 1200x630 → public/og.png
const fs = require('fs');
async function main() {
  const list = await (await fetch('http://localhost:9222/json/list')).json();
  const { default: WebSocket } = await import('ws');
  // fresh tab so the game page is untouched
  const t = await (await fetch('http://localhost:9222/json/new?file:///C:/Users/H/Desktop/app/LuckyMilitia/ice3d/scripts/ogcard.html', { method: 'PUT' })).json();
  const sock = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r) => sock.on('open', r));
  const pend = new Map(); let id = 0;
  const send = (m, p = {}) => new Promise((res) => {
    const mid = ++id; pend.set(mid, res);
    sock.send(JSON.stringify({ id: mid, method: m, params: p }));
  });
  sock.on('message', (d) => {
    let m; try { m = JSON.parse(d.toString()); } catch { return; }
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); }
  });
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1200, height: 630, deviceScaleFactor: 1, mobile: false });
  await new Promise((r) => setTimeout(r, 2500)); // fonts + imgs
  const r = await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: 1200, height: 630, scale: 1 } });
  fs.writeFileSync('C:/Users/H/Desktop/app/LuckyMilitia/ice3d/public/og.png', Buffer.from(r.data, 'base64'));
  console.log('og.png written');
  await fetch(`http://localhost:9222/json/close/${t.id}`).catch(() => {});
  process.exit(0);
}
main();
