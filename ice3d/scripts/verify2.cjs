// verify2 — live test of the new systems + reshoot the mistimed frames
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
  const R = {}; // results

  await send('Page.enable');
  await evl(`location.href='http://localhost:5199/'; 'x'`);
  await sleep(4500);

  // ============ A. CLASSIC — taunt mark, near-miss, freeze shake, ping emote ============
  await evl(`document.getElementById('btnPlay').click(); 'x'`); await sleep(700);
  await evl(`document.getElementById('btnStart').click(); 'x'`);
  await evl(`__m && (__m.cd = .1); 'x'`);
  await waitPlay();
  R.team = await evl(`__m.player.team`);

  // TAUNT: park a hunter near the player, shout → marked + speed boost
  await evl(`(() => { const p=__m.player, w=__m.ents.find(e=>e.team==='water'&&!e.isPlayer);
    w.x=p.x+5; w.z=p.z; return 1; })()`);
  await evl(`__m.taunt()`);
  await sleep(300);
  R.tauntBoost = await evl(`__m.tauntT > 0`);
  R.hunterHeard = await evl(`(() => { const p=__m.player;
    return __m.ents.filter(e=>e.team==='water'&&!e.isPlayer).some(w=>w.tgt===p); })()`);

  // NEAR-MISS: place hunter just inside NEAR_R of a free ice ent, then teleport it away
  await evl(`(() => { const t=__m.ents.find(e=>e.team==='ice'&&!e.frozen), w=__m.ents.find(e=>e.team==='water'&&!e.isPlayer);
    w.x=t.x+2.0; w.z=t.z; w.tgt=t; return 'armed'; })()`);
  await sleep(700); // let frames arm the pair
  await evl(`(() => { const w=__m.ents.find(e=>e.team==='water'&&!e.isPlayer);
    w.x=-20; w.z=-20; return 1; })()`);
  await sleep(900);
  R.nearMissFired = await evl(`__m.nearMisses > 0`);

  // PING + emote: freeze the player, ping, check a coward mate shows '…'
  if (R.team === 'ice') {
    await evl(`(() => { const p=__m.player, w=__m.ents.find(e=>e.team==='water'&&!e.isPlayer);
      w.x=p.x; w.z=p.z; w.air=false; return 1; })()`);
    await sleep(1500);
    R.playerFrozen = await evl(`__m.player.frozen`);
    if (R.playerFrozen) {
      await evl(`__m.pingCrew()`);
      await sleep(400);
      R.cowardEmote = await evl(`__m.ents.some(e=>!e.isPlayer&&e.team==='ice'&&e.bean.emote.visible)`);
      R.braveComing = await evl(`__m.ents.some(e=>!e.isPlayer&&e.team==='ice'&&!e.frozen&&e.tgt===__m.player)`);
    }
    // rescue the player so the match continues
    await evl(`(() => { const m=__m.ents.filter(e=>e.team==='ice'&&!e.isPlayer&&!e.frozen).sort((a,b)=>b.brave-a.brave)[0];
      if(m){m.x=__m.player.x+.5;m.z=__m.player.z;} return 1; })()`);
    await sleep(1200);
    R.thawed = await evl(`!__m.player.frozen`);
  } else R.skipped = 'player was water';

  // ============ B. SAFE ZONE — protection + expiry push-out ============
  if (R.team === 'ice' && R.thawed !== false) {
    await evl(`(() => { const sz=__m.world.safeZone, p=__m.player, w=__m.ents.find(e=>e.team==='water'&&!e.isPlayer);
      p.x=sz.x; p.z=sz.z; p.frozen=false; w.x=sz.x+.3; w.z=sz.z; return 1; })()`);
    await sleep(900);
    R.zoneProtected = await evl(`!__m.player.frozen`);
    R.safeTdrained = await evl(`__m.player.safeT < 4`);
    // burn the rest of the refuge → pushed out + taggable again
    await evl(`__m.player.safeT = .15; 'x'`);
    await sleep(1400);
    R.pushedOut = await evl(`(() => { const sz=__m.world.safeZone, p=__m.player;
      return (p.x-sz.x)**2 + (p.z-sz.z)**2 > sz.r*sz.r; })()`);
  } else R.safeSkipped = 'player was water or still frozen';

  // ============ C. DROPS — collect → twist → exit → WIN ============
  await evl(`location.href='http://localhost:5199/'; 'x'`); await sleep(4500);
  await evl(`document.getElementById('btnPlay').click(); 'x'`); await sleep(700);
  await evl(`[...document.querySelectorAll('.mode')].find(m=>m.textContent.includes('WATER RUN')).click(); 'x'`);
  await evl(`document.getElementById('btnStart').click(); 'x'`);
  await evl(`__m && (__m.cd = .1); 'x'`);
  await waitPlay();
  const need = await evl(`__m.dropsNeed`);
  for (let i = 0; i < need + 2; i++) {
    await evl(`(() => { const d=__m.drops.find(d=>!d.taken); if(d){__m.player.x=d.x;__m.player.z=d.z;__m.player.y=.2;} return 1; })()`);
    await sleep(500);
    if (await evl(`__m.twistDone`)) break;
  }
  R.twist = await evl(`__m.twistDone`);
  R.hunters = await evl(`__m.ents.filter(e=>e.team==='water').length`);
  R.noGhostDrops = await evl(`__m.drops.every(d=>d.taken)`);
  // hunters falling from the sky — reshoot frame while they're airborne
  await shot('12-twist');
  // reach exit → must end with ice win
  await evl(`(() => { const p=__m.player; p.x=__m.exitX; p.z=__m.exitZ; p.y=.2; p.frozen=false; return 1; })()`);
  await sleep(2500);
  R.dropsWin = await evl(`__m.over && __m.winTeam==='ice'`);
  await shot('13-exit');

  // ============ D. MAIDUGURI — NEPA darkness ============
  await evl(`__start({ch:5}); 'x'`);
  await evl(`__m && (__m.cd = .1); 'x'`);
  await waitPlay();
  await sleep(2500); // let the darkness + torch settle
  R.nepaEvent = await evl(`__m.event==='nepa'`);
  R.sunDimmed = await evl(`__m.world.sun.intensity < .6`);
  R.torchLit = await evl(`!!__m.torch`);
  await shot('14-nepa');

  // ============ E. ABUJA — school map + handicap 3v5 ============
  await evl(`__start({ch:3}); 'x'`);
  await evl(`__m && (__m.cd = .1); 'x'`);
  await waitPlay();
  R.schoolEnts = await evl(`__m.ents.length`);
  R.schoolObstacles = await evl(`__m.world.obstacles.length`);

  // ============ F. ROAD progress ============
  R.roadProg = await evl(`localStorage.getItem('iw3d-road')`);

  console.log(JSON.stringify(R, null, 1));
  process.exit(0);
}
main();
