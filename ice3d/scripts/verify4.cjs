// verify4 — deterministic full-system pass via window.__tick (immune to rAF throttling)
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
  const pump = (n) => evl(`(()=>{for(let i=0;i<${n};i++)__tick(.05);return __m.phase})()`);
  const toPlay = async () => { // land the skydive, skip the countdown, reach 'play'
    await evl(`__m && (__m.cd = .05); 1`);
    for (let i = 0; i < 12; i++) { if ((await pump(30)) === 'play') return true; }
    return false;
  };
  const boot = async (url) => {
    await evl(`location.href='${url}'; 'x'`);
    await sleep(5000);
    for (let i = 0; i < 20; i++) { if (await evl('typeof __tick==="function"&&typeof __start==="function"')) return; await sleep(500); }
  };
  const R = {};

  await send('Page.enable');
  await boot('http://localhost:5199/');

  // ============ A. classic street match boots to play — re-roll until ICE ============
  for (let i = 0; i < 8; i++) {
    await evl(`__start({map:'street'})`);
    await toPlay();
    if ((await evl(`__m.player.team`)) === 'ice') break;
  }
  R.phasePlay = await evl(`__m.phase`);
  R.ents = await evl(`__m.ents.length`);
  R.playerTeam = await evl(`__m.player.team`);

  // ============ B. near-miss — arm the pair, then break away ============
  await evl(`(()=>{
    const ws=__m.ents.filter(e=>e.team==='water'&&!e.isPlayer);
    const t=__m.ents.find(e=>e.team==='ice'&&!e.frozen&&!e.isPlayer) || __m.player;
    ws.forEach((w,i)=>{ w.x = i===0 ? t.x+1.9 : -60; w.z = i===0 ? t.z : -30; w.vx=w.vz=0; });
    return 1;})()`);
  await pump(3);
  await evl(`(()=>{const w=__m.ents.find(e=>e.team==='water'&&!e.isPlayer);w.x=-60;w.z=-30;return 1})()`);
  await pump(4);
  R.nearMisses = await evl(`__m.nearMisses`);
  R.pairsLeft = await evl(`__m.nearPairs.size`);

  // ============ C. taunt — ICE only gets boost+mark ============
  if (R.playerTeam === 'ice') {
    await evl(`(()=>{const w=__m.ents.find(e=>e.team==='water'&&!e.isPlayer);
      w.x=__m.player.x+6; w.z=__m.player.z; w.vx=w.vz=0; return 1})()`);
    await evl(`__m.taunt()`);
    R.tauntBoost = await evl(`__m.tauntT>0`);
    R.tauntMark = await evl(`__m.markT>0`);
    R.hunterHeard = await evl(`__m.ents.some(e=>e.team==='water'&&e.tgt===__m.player)`);
  } else {
    await evl(`__m.taunt()`);
    R.tauntBoost = await evl(`__m.tauntT`);  // water shout = just a voice line
    R.markedIce = await evl(`__m.ents.some(e=>e.team==='ice'&&e===__m.player&&__m.markT>0)`);
  }

  // ============ D. safe zone — protect, block tag, drain, push out ============
  const sz = await evl(`JSON.stringify(__m.world.safeZone)`);
  if (sz && sz !== 'null') {
    await evl(`(()=>{const s=__m.world.safeZone,p=__m.player;
      p.x=s.x;p.z=s.z;p.frozen=false;
      const w=__m.ents.find(e=>e.team==='water'&&!e.isPlayer);
      if(w){w.x=s.x+s.r+1;w.z=s.z;w.vx=w.vz=0;} // lurk at the edge, don't body-push the player out
      return 1})()`);
    await pump(4);
    R.safeProtected = await evl(`__m.player.safeT>0`);
    R.notTaggedInZone = await evl(`!__m.player.frozen`);
    R.safeInsideEvt = await evl(`__m.safeInside`);
    await pump(120); // 6s — outlast the 4s refuge
    const out = await evl(`(()=>{const s=__m.world.safeZone,p=__m.player;
      return Math.hypot(p.x-s.x,p.z-s.z)})()`);
    R.pushedOut = out > 3.5;
    R.safeDrained = await evl(`__m.player.safeT<=0`);
  }

  // ============ E. COME SAVE ME — coward emote + brave rescue target ============
  await evl(`(()=>{const p=__m.player,w=__m.ents.find(e=>e.team==='water'&&!e.isPlayer);
    if(p.team!=='ice')return'water';
    const s=__m.world.safeZone; if(s){p.x=s.x+20;p.z=s.z;}
    w.x=p.x;w.z=p.z;w.vx=w.vz=0;return'ok'})()`);
  await pump(6);
  R.playerFrozen = await evl(`__m.player.frozen`);
  if (R.playerFrozen === true) {
    await evl(`__m.pingCrew()`);
    await pump(3);
    R.emotesShown = await evl(`__m.emotes.length`);
    R.cowardBubble = await evl(`__m.ents.some(e=>!e.isPlayer&&e.team==='ice'&&e.bean.emote.visible)`);
    R.braveRescues = await evl(`__m.ents.some(e=>!e.isPlayer&&e.team==='ice'&&!e.frozen&&e.brave>=.5&&e.tgt===__m.player)`);
    // let a brave mate thaw the player so later sections run on a live player
    await evl(`(()=>{const m=__m.ents.filter(e=>!e.isPlayer&&e.team==='ice'&&!e.frozen).sort((a,b)=>b.brave-a.brave)[0];
      if(m){m.x=__m.player.x+.4;m.z=__m.player.z;} return 1})()`);
    await pump(6);
    R.thawed = await evl(`!__m.player.frozen`);
  }

  // ============ F. chapter 1 = drops on street — collect, twist, exit, win ============
  for (let i = 0; i < 8; i++) {
    await evl(`__start({ch:1})`);
    await toPlay();
    if ((await evl(`__m.player.team`)) === 'ice') break;
  }
  R.ch1_isDrops = await evl(`__m.dropsNeed===6`);
  R.ch1_team = await evl(`__m.player.team`);
  const need = await evl(`__m.dropsNeed`) || 6;
  for (let i = 0; i < need + 3; i++) {
    await evl(`(()=>{
      __m.ents.forEach(e=>{if(e.team==='water'&&!e.isPlayer){e.x=-15;e.z=-22;e.vx=e.vz=0;}});
      const p=__m.player;p.frozen=false;
      const d=__m.drops.find(d=>!d.taken);
      if(d){p.x=d.x;p.z=d.z;p.y=.2;}
      return 1})()`);
    await pump(3);
    if (await evl(`__m.twistDone`)) break;
  }
  R.twist = await evl(`__m.twistDone`);
  R.waterAfterTwist = await evl(`__m.ents.filter(e=>e.team==='water').length`);
  R.noGhostDrops = await evl(`__m.drops.every(d=>d.taken)`);
  R.exitShown = await evl(`!!__m.exitRing&&__m.exitRing.visible`);
  await evl(`(()=>{const p=__m.player;p.x=__m.exitX;p.z=__m.exitZ;p.y=.2;p.frozen=false;
    __m.ents.forEach(e=>{if(e.team==='water'&&!e.isPlayer){e.x=0;e.z=-24;e.vx=e.vz=0;}});return 1})()`);
  await pump(12);
  R.dropsWin = await evl(`JSON.stringify({over:__m.over,win:__m.winTeam})`);

  // ============ G. school map — distinct world, obstacles ============
  await evl(`__start({map:'school'})`);
  await toPlay();
  R.schoolEnts = await evl(`__m.ents.length`);
  R.schoolObstacles = await evl(`__m.world.obstacles.length`);

  // ============ H. chapter 0 win → iw3d-road persists ============
  await evl(`__start({ch:0})`);
  await toPlay();
  const team0 = await evl(`__m.player.team`);
  if (team0 === 'ice') {
    await evl(`(()=>{const p=__m.player;p.frozen=false;p.x=20;p.z=-20;__m.timeLeft=.1;return 1})()`);
  } else {
    await evl(`(()=>{const ws=__m.ents.filter(e=>e.team==='water');
      __m.ents.filter(e=>e.team==='ice').forEach((t,i)=>{const w=ws[i%ws.length];w.x=t.x;w.z=t.z;});
      return 1})()`);
  }
  await pump(40);
  R.ch0over = await evl(`__m.over`);
  R.ch0won = await evl(`__m.winTeam===__m.player.team`);
  await sleep(1200); // endMatch() runs inside tick already; storage write is sync
  R.roadSaved = await evl(`localStorage.getItem('iw3d-road')`);

  // ============ I. reload → road screen reflects unlock ============
  await boot('http://localhost:5199/');
  await evl(`document.getElementById('btnRoad').click()`);
  await sleep(600);
  R.roadNodes = await evl(`document.querySelectorAll('.road-node').length`);
  R.roadDone = await evl(`document.querySelectorAll('.road-node.done').length`);
  R.roadUnlocked = await evl(`[...document.querySelectorAll('.road-node')].filter(n=>!n.classList.contains('lock')).length`);

  // ============ J. ?join= chip ============
  await boot('http://localhost:5199/?join=KANO9');
  await sleep(800);
  R.joinChipVisible = await evl(`document.getElementById('joinChip')?.classList.contains('show')`);
  R.joinChipText = await evl(`document.getElementById('joinChip')?.textContent?.trim()`);

  // ============ K. rain chapter persists (ch2 ILORIN, school+rain) ============
  await evl(`__start({ch:2})`);
  await toPlay();
  R.rainEvent = await evl(`__m.event`);
  R.rainPts = await evl(`!!__m.rainPts`);
  R.ch2school = await evl(`__m.world.obstacles.length>=15`);

  // ============ L. NEPA chapter + restore on new match ============
  await evl(`__start({ch:5})`);
  await toPlay();
  R.nepaEvent = await evl(`__m.event`);
  R.envDimmed = await evl(`__m.scene.environmentIntensity<0.2`);
  R.torch = await evl(`!!__m.torch`);
  await evl(`__start({map:'street'})`); // new match — lights must be back
  await toPlay();
  R.lightsRestored = await evl(`__m.world.sun.intensity>2`);

  console.log(JSON.stringify(R, null, 1));
  process.exit(0);
}
main().catch((e) => { console.log('FATAL', e); process.exit(1); });
