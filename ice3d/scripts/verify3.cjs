// verify3 — retest the flaky bits: near-miss, drops twist+exit win, ping emote
const fs = require('fs');
const OUT = 'C:/Users/H/Desktop/app/LuckyMilitia/ice3d/shots/trailer';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const list = await (await fetch('http://localhost:9222/json/list')).json();
  const page = list.find((t) => t.type === 'page' && t.url.includes('localhost:5199'));
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
  const evl = (x) => send('Runtime.evaluate', { expression: x, returnByValue: true }).then((r) => r?.result?.value);
  const shot = async (n) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(`${OUT}/${n}.png`, Buffer.from(r.data, 'base64'));
  };
  const waitPlay = async () => {
    for (let i = 0; i < 120; i++) {
      if ((await evl(`__m ? __m.phase : 'x'`)) === 'play') return true;
      await sleep(500);
    }
    return false;
  };
  const R = {};

  await send('Page.enable');
  await evl(`location.href='http://localhost:5199/'; 'x'`);
  await sleep(4500);

  // ============ A. near-miss — arm for ONE frame then separate ============
  await evl(`document.getElementById('btnPlay').click(); 'x'`); await sleep(700);
  await evl(`document.getElementById('btnStart').click(); 'x'`);
  await evl(`__m && (__m.cd = .1); 'x'`);
  await waitPlay();
  // pin every hunter far away except the test one; put it at near-range of a runner
  await evl(`(() => {
    const ws = __m.ents.filter(e=>e.team==='water'&&!e.isPlayer);
    const t = __m.ents.find(e=>e.team==='ice'&&!e.frozen);
    ws.forEach((w,i)=>{ w.x = i===0 ? t.x+1.9 : -40; w.z = i===0 ? t.z : -24; w.vx=w.vz=0; });
    return ws.length; })()`);
  await sleep(350); // ~1-2 frames: pair arms, hunter can't close the 1.9m in time
  await evl(`(() => { const w=__m.ents.find(e=>e.team==='water'&&!e.isPlayer); w.x=-40; w.z=-24; return 1; })()`);
  await sleep(800);
  R.nearMissFired = await evl(`__m.nearMisses`);
  R.pairCleared = await evl(`__m.nearPairs.size`);

  // ============ B. ping emote — freeze player, ping, watch the coward ============
  await evl(`(() => { const p=__m.player, w=__m.ents.find(e=>e.team==='water'&&!e.isPlayer);
    if(p.team!=='ice')return'water'; w.x=p.x; w.z=p.z; w.vx=w.vz=0; return 'ok'; })()`);
  await sleep(1600);
  R.playerFrozen = await evl(`__m.player.frozen`);
  if (R.playerFrozen === true) {
    await evl(`__m.pingCrew()`);
    await sleep(600);
    R.emotes = await evl(`__m.emotes.length`);
    R.cowardShown = await evl(`__m.ents.some(e=>!e.isPlayer&&e.team==='ice'&&e.bean.emote.visible)`);
    R.braveMarked = await evl(`__m.ents.filter(e=>!e.isPlayer&&e.team==='ice'&&!e.frozen&&e.brave>=.5).map(e=>e.tgt===__m.player)`);
    await shot('09-ping');
    // thaw them so the match can end naturally
    await evl(`(() => { const m=__m.ents.filter(e=>e.team==='ice'&&!e.isPlayer&&!e.frozen).sort((a,b)=>b.brave-a.brave)[0];
      if(m){m.x=__m.player.x+.5;m.z=__m.player.z;} return 1; })()`);
    await sleep(1200);
    R.thawed = await evl(`!__m.player.frozen`);
  }

  // ============ C. drops — pin hunters, collect all, twist, exit, WIN ============
  await evl(`location.href='http://localhost:5199/'; 'x'`); await sleep(4500);
  await evl(`document.getElementById('btnPlay').click(); 'x'`); await sleep(700);
  await evl(`[...document.querySelectorAll('.mode')].find(m=>m.textContent.includes('WATER RUN')).click(); 'x'`);
  await evl(`document.getElementById('btnStart').click(); 'x'`);
  await evl(`__m && (__m.cd = .1); 'x'`);
  await waitPlay();
  const need = await evl(`__m.dropsNeed`);
  for (let i = 0; i < need + 2; i++) {
    await evl(`(() => {
      // keep hunters corralled in the north corner + player unfrozen
      __m.ents.forEach(e=>{ if(e.team==='water'&&!e.isPlayer){e.x=-15;e.z=-22;e.vx=e.vz=0;} });
      const p=__m.player; p.frozen=false;
      const d=__m.drops.find(d=>!d.taken);
      if(d){p.x=d.x;p.z=d.z;p.y=.2;}
      return 1; })()`);
    await sleep(600);
    if (await evl(`__m.twistDone`)) break;
  }
  R.twist = await evl(`__m.twistDone`);
  R.waterCount = await evl(`__m.ents.filter(e=>e.team==='water').length`);
  R.noGhostDrops = await evl(`__m.drops.every(d=>d.taken)`);
  await shot('12-twist');
  await evl(`(() => { const p=__m.player; p.x=__m.exitX; p.z=__m.exitZ; p.y=.2; p.frozen=false;
    __m.ents.forEach(e=>{ if(e.team==='water'&&!e.isPlayer){e.x=0;e.z=-22;} }); return 1; })()`);
  await sleep(2500);
  R.dropsWin = await evl(`JSON.stringify({over:__m.over,win:__m.winTeam})`);
  await shot('13-exit');

  console.log(JSON.stringify(R, null, 1));
  process.exit(0);
}
main();
