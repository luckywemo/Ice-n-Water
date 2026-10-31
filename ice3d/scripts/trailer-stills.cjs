// trailer-stills — drive the game through the money beats, capture PNGs.
// Stills are instant; headless fps doesn't affect their quality.
const fs = require('fs');
const OUT = 'C:/Users/H/Desktop/app/LuckyMilitia/ice3d/shots/trailer';
fs.mkdirSync(OUT, { recursive: true });

async function wsUrl() {
  const list = await (await fetch('http://localhost:9222/json/list')).json();
  const page = list.find((t) => t.type === 'page' && t.url.includes('localhost:5199'));
  return page.webSocketDebuggerUrl;
}
const pend = new Map();
let id = 0;
let send, evl;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let sock;
const shot = async (name) => {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(`${OUT}/${name}.png`, Buffer.from(r.data, 'base64'));
  console.log('·', name);
};
const waitPhase = async (ph, tries = 90) => {
  for (let i = 0; i < tries; i++) {
    if ((await evl(`__m ? __m.phase : 'x'`)) === ph) return true;
    await sleep(700);
  }
  return false;
};

(async () => {
  const { default: WebSocket } = await import('ws');
  sock = new WebSocket(await wsUrl());
  await new Promise((r) => sock.on('open', r));
  send = (m, p = {}) => new Promise((res) => {
    const mid = ++id; pend.set(mid, res);
    sock.send(JSON.stringify({ id: mid, method: m, params: p }));
  });
  sock.on('message', (data) => {
    let m; try { m = JSON.parse(data.toString()); } catch { return; }
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result ?? m.error); pend.delete(m.id); }
  });
  evl = (x) => send('Runtime.evaluate', { expression: x, returnByValue: true }).then((r) => r?.result?.value);

  await send('Page.enable');
  await evl(`location.href='http://localhost:5199/'; 'x'`);
  await sleep(4000);

  // 01 menu — logo + buttons
  await shot('01-menu');
  // 02 setup — podium + cards
  await evl(`document.getElementById('btnPlay').click(); 'x'`);
  await sleep(900); await shot('02-setup');

  // 03+ classic: intro → skydive → go → chase → freeze → ping → rescue
  await evl(`document.getElementById('btnStart').click(); 'x'`);
  await sleep(1200); await shot('03-flyover');
  await evl(`__m && (__m.cd = 2.2); 'x'`);
  await sleep(700); await shot('04-skydive');
  await waitPhase('play');
  await shot('05-go');
  // let the chase breathe — hunters come to you
  await sleep(4000); await shot('06-chase-a');
  await sleep(2500); await shot('07-chase-b');
  // force the catch: teleport a water player onto you
  await evl(`(() => { const p=__m.player, w=__m.ents.find(e=>e.team==='water'&&!e.isPlayer);
    if (p.team==='ice'&&w){w.x=p.x+.4;w.z=p.z;} return p.team; })()`);
  await sleep(1200); await shot('08-frozen');
  // COME SAVE ME ping → ping ring + emotes
  await evl(`__m && __m.player.frozen && (window.__si = {shoutDown:true,mx:0,mz:0,sprint:false,jumpDown:false,skillDown:false,camDelta:0,zoomDelta:0}); 'x'`);
  // ping direct — input override is fiddly headless, call the internal
  await evl(`__m.pingT=0; __m.player.frozen && __m['pingCrew'] ? __m['pingCrew']() : 'x'`);
  await sleep(1500); await shot('09-ping');
  // teleport the bravest mate to us → rescue frame
  await evl(`(() => { const p=__m.player, m=__m.ents.filter(e=>e.team==='ice'&&!e.isPlayer&&!e.frozen)
    .sort((a,b)=>b.brave-a.brave)[0]; if(m&&p.frozen){m.x=p.x+.6;m.z=p.z;} return 1; })()`);
  await sleep(1400); await shot('10-rescue');

  // 11+ WATER RUN — drops, twist, hunters dropping in, exit ring
  await evl(`__start({cfg: MODES ? undefined : undefined}); 'x'`);
  await evl(`location.href='http://localhost:5199/'; 'x'`);
  await sleep(4000);
  await evl(`document.getElementById('btnPlay').click(); 'x'`); await sleep(600);
  await evl(`[...document.querySelectorAll('.mode')].find(m=>m.textContent.includes('WATER RUN')).click(); 'x'`);
  await evl(`document.getElementById('btnStart').click(); 'x'`);
  await evl(`__m && (__m.cd = .2); 'x'`);
  await waitPhase('play');
  await shot('11-drops');
  // grab all drops fast → the twist fires
  for (let i = 0; i < 8; i++) {
    await evl(`(() => { const d=__m.drops.find(d=>!d.taken); if(d){__m.player.x=d.x;__m.player.z=d.z;} return 1; })()`);
    await sleep(500);
    if (await evl(`__m.twistDone`)) break;
  }
  await sleep(900); await shot('12-twist');
  // near the exit ring for the escape frame
  await evl(`(() => { const p=__m.player; p.x=__m.exitX+3; p.z=__m.exitZ; return 1; })()`);
  await sleep(700); await shot('13-exit');

  // 14 MAIDUGURI — NEPA chapter, darkness + torch
  await evl(`__start({ ch: 5 }); 'x'`);
  await evl(`__m && (__m.cd = .2); 'x'`);
  await waitPhase('play');
  await sleep(1500); await shot('14-nepa');

  // 15 school map — assembly rows + classroom lanes
  await evl(`__start({ ch: 3 }); 'x'`);   // ABUJA is school
  await evl(`__m && (__m.cd = .2); 'x'`);
  await waitPhase('play');
  await shot('15-school');

  // 16 win banner — finish ch1 by freezing everyone as... simplest: force end
  await evl(`location.href='http://localhost:5199/'; 'x'`); await sleep(4000);
  await evl(`document.getElementById('btnPlay').click(); 'x'`); await sleep(500);
  await evl(`document.getElementById('btnStart').click(); 'x'`);
  await evl(`__m && (__m.cd = .2); 'x'`); await waitPhase('play');
  await evl(`(() => { __m.stats.won = true; __m['end'](__m.player.team); return 1; })()`);
  await sleep(2200); await shot('16-results');

  console.log('done —', fs.readdirSync(OUT).length, 'stills');
  process.exit(0);
})();
