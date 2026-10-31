// record-trailer — drive kenburns.html?manual's __capture() and save the video
const fs = require('fs');
const OUT_DIR = 'C:/Users/H/Desktop/app/LuckyMilitia/ice3d/public';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const list = await (await fetch('http://localhost:9222/json/list')).json();
  let page = list.find((t) => t.type === 'page' && t.url.includes('localhost:5199'));
  const { default: WebSocket } = await import('ws');
  const sock = new WebSocket(page.webSocketDebuggerUrl);
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
  const evl = (x, awaitP) => send('Runtime.evaluate',
    { expression: x, returnByValue: true, awaitPromise: !!awaitP, timeout: 120000 })
    .then((r) => r?.result?.value);

  await send('Page.enable');
  await evl(`location.href='http://localhost:5199/kenburns.html?manual'; 'x'`);
  for (let i = 0; i < 30; i++) { if (await evl('!!window.__ready')) break; await sleep(500); }
  console.log('ready:', await evl('!!window.__ready'), '| total:', await evl('window.__total'));

  console.log('!capturing (~50s)…'.slice(1));
  const v = await evl(`__capture(30).catch(e=>'ERR:'+e.message)`, true);
  if (!v || !v.bytes) { console.log('CAPTURE FAILED:', JSON.stringify(v)); process.exit(1); }
  console.log('mime:', v.mime, 'bytes:', v.bytes);
  // pull the dataURL in chunks — too big for one returnByValue
  const len = await evl(`__vid.data.length`);
  let dataUrl = '';
  for (let off = 0; off < len; off += 400000) {
    dataUrl += await evl(`__vid.data.slice(${off},${off + 400000})`);
  }
  const b64 = dataUrl.split(',')[1];
  const file = `${OUT_DIR}/icenwater-trailer.${v.ext}`;
  fs.writeFileSync(file, Buffer.from(b64, 'base64'));
  console.log('->', file, (fs.statSync(file).size / 1e6).toFixed(2) + 'MB');
  process.exit(0);
}
main().catch((e) => { console.log('FATAL', e); process.exit(1); });
