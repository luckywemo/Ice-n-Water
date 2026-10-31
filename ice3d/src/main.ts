// boot — renderer, screens, HUD, match lifecycle
import * as THREE from 'three';
import { buildWorld, buildSchool, disposeWorld, updateWorld, type World, type MapId } from './game/world';
import { ensureEnv, makeBean, animBean, type Bean } from './game/beans';
import { CHARACTERS, charMove, charDefById } from './game/chars';
import { Match, MODES, ROAD_NORTH, type ModeCfg, type Mut, type Ent } from './game/match';
import { initInput, readInput, isTouch } from './game/input';
import * as AU from './game/audio';
import { $, clamp, store } from './game/util';

const canvas = $('gl') as unknown as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
const quality = store.get<'low' | 'high'>('quality', 'high');
renderer.setPixelRatio(Math.min(devicePixelRatio, quality === 'high' ? 2 : 1.25));

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xe8c9a0);
const camera = new THREE.PerspectiveCamera(52, innerWidth / innerHeight, .1, 300);

function resize() {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
}
addEventListener('resize', resize);
resize();

// ---------- screens ----------
const screens = ['loading', 'menu', 'setup', 'campaign', 'howto', 'settings', 'pause', 'results'];
function show(id: string | null) {
  for (const s of screens) $(s).classList.toggle('show', s === id);
}
function modal(id: string | null) { // overlay without hiding main screen context
  for (const s of ['howto', 'settings', 'pause']) $(s).classList.toggle('show', s === id);
}

// ---------- settings ----------
function syncSettings() {
  const sfx = AU.sfxOn(), mus = AU.musicOn();
  const q = store.get<'low' | 'high'>('quality', 'high');
  $('setSfx').textContent = sfx ? 'ON' : 'OFF';
  $('setSfx').classList.toggle('on', sfx);
  $('setMusic').textContent = mus ? 'ON' : 'OFF';
  $('setMusic').classList.toggle('on', mus);
  $('setQuality').textContent = q === 'high' ? 'HIGH' : 'LOW';
  $('setQuality').classList.toggle('on', q === 'high');
}
$('setSfx').onclick = () => { AU.setSfx(!AU.sfxOn()); syncSettings(); };
$('setMusic').onclick = () => { AU.setMusic(!AU.musicOn()); if (AU.musicOn()) AU.startMusic(); else AU.stopMusic(); syncSettings(); };
$('setQuality').onclick = () => {
  const q = store.get<'low' | 'high'>('quality', 'high') === 'high' ? 'low' : 'high';
  store.set('quality', q);
  renderer.setPixelRatio(Math.min(devicePixelRatio, q === 'high' ? 2 : 1.25));
  syncSettings();
};

// ---------- mode + map + swatch pickers ----------
let selMode: ModeCfg = MODES[0];
let selChar = store.get('char', 'koko');
let selMap = store.get<MapId>('map', 'street');
const MAPS: { id: MapId; name: string; sub: string }[] = [
  { id: 'street', name: 'STREET PITCH', sub: 'kiosks · danfo · the block' },
  { id: 'school', name: 'SCHOOL COMPOUND', sub: 'assembly ground · class lanes' },
];
for (const mp of MAPS) {
  const b = document.createElement('button');
  b.className = 'mapbtn' + (mp.id === selMap ? ' sel' : '');
  b.innerHTML = `<b>${mp.name}</b><span>${mp.sub}</span>`;
  b.onclick = () => {
    selMap = mp.id;
    store.set('map', selMap);
    $('mapList').querySelectorAll('.mapbtn').forEach((x) => x.classList.remove('sel'));
    b.classList.add('sel');
  };
  $('mapList').appendChild(b);
}
for (const m of MODES) {
  const b = document.createElement('button');
  b.className = 'mode' + (m === selMode ? ' sel' : '');
  b.innerHTML = `<b>${m.name}</b><span>${m.sub}</span>`;
  b.onclick = () => {
    selMode = m;
    $('modeList').querySelectorAll('.mode').forEach((x) => x.classList.remove('sel'));
    b.classList.add('sel');
  };
  $('modeList').appendChild(b);
}
function syncChar() {
  const def = charDefById(selChar);
  $('charName').textContent = def.name ?? def.id.toUpperCase();
  $('charMove').textContent = charMove(selChar).toUpperCase();
}
// podium preview — the real 3D cast spinning on the setup screen
const podiumCv = $('podium') as unknown as HTMLCanvasElement;
const podRen = new THREE.WebGLRenderer({ canvas: podiumCv, antialias: true, alpha: true });
podRen.setSize(170, 190, false);
podRen.outputColorSpace = THREE.SRGBColorSpace;
const podScene = new THREE.Scene();
const podCam = new THREE.PerspectiveCamera(34, 170 / 190, .1, 20);
podCam.position.set(0, 1.7, 3.4);
podCam.lookAt(0, .8, 0);
podScene.add(new THREE.HemisphereLight(0xcfe4ff, 0x8a5a34, 1.1));
const podKey = new THREE.DirectionalLight(0xffe2b0, 2.2);
podKey.position.set(2, 4, 3);
podScene.add(podKey);
const podDisc = new THREE.Mesh(new THREE.CylinderGeometry(1, 1.1, .14, 24),
  new THREE.MeshStandardMaterial({ color: 0x2a2438, roughness: .6 }));
podDisc.position.y = -.08;
podScene.add(podDisc);
let podBean: Bean | null = null;
function syncPodium() {
  if (podBean) podScene.remove(podBean.root);
  podBean = makeBean(charDefById(selChar));
  podScene.add(podBean.root);
}
for (const c of CHARACTERS) {
  const s = document.createElement('button');
  s.className = 'swatch' + (c.id === selChar ? ' sel' : '');
  s.style.background = '#' + c.body.toString(16).padStart(6, '0');
  s.title = c.name ?? c.id;
  s.onclick = () => {
    selChar = c.id;
    store.set('char', selChar);
    syncChar(); syncPodium();
    $('swatches').querySelectorAll('.swatch').forEach((x) => x.classList.remove('sel'));
    s.classList.add('sel');
  };
  $('swatches').appendChild(s);
}
syncChar();
syncPodium();

// ---------- HUD ----------
const hud = $('hud'), touch = $('touch'), cdEl = $('countdown');
let toastT = 0;
function toast(msg: string, ms = 1400) {
  const t = $('hudToast');
  t.textContent = msg;
  t.classList.add('show');
  toastT = ms / 1000;
}
function setTimer(s: number) {
  const el = $('hudTimer');
  const m = Math.floor(Math.max(0, s) / 60), sec = Math.floor(Math.max(0, s) % 60);
  el.textContent = `${m}:${sec.toString().padStart(2, '0')}`;
  el.classList.toggle('low', s <= 10.5);
}
function hudFor(m: Match) {
  const teamEl = $('hudTeam');
  teamEl.textContent = m.player.team === 'water' ? 'YOU: WATER 💧' : 'YOU: ICE 🧊';
  teamEl.classList.toggle('water', m.player.team === 'water');
  const drops = m.drops.length ? ` · 💧${m.dropsGot}/${m.dropsNeed}` : '';
  $('hudFrozen').textContent = `${m.iceFrozenCount} FROZEN${drops}`;
  setTimer(m.timeLeft);
  // crew dots — one per ICE runner, frozen ones go ice-blue
  const dots = $('crewDots');
  const ice = m.ents.filter((e) => e.team === 'ice');
  if (dots.children.length !== ice.length) {
    dots.innerHTML = '';
    for (const e of ice) {
      const d = document.createElement('div');
      d.className = 'crew-dot' + (e.isPlayer ? ' you' : '');
      dots.appendChild(d);
    }
  }
  ice.forEach((e, i) => dots.children[i]?.classList.toggle('frozen', e.frozen));
  // skill label
  const sk = $('hudSkill');
  sk.textContent = m.skillT > 0 ? `${m.playerMove.toUpperCase()} · ${Math.ceil(m.skillT)}s` : `F — ${m.playerMove.toUpperCase()}`;
  sk.classList.toggle('cd', m.skillT > 0);
}

// radar — limited local coverage like the 2D game: who is NEAR you
const radar = $('radar') as unknown as HTMLCanvasElement;
const rctx = radar.getContext('2d')!;
function drawRadar(m: Match) {
  const R = 60, RANGE = 20;
  const p = m.player;
  rctx.clearRect(0, 0, 120, 120);
  rctx.save();
  rctx.translate(R, R);
  // rings
  rctx.strokeStyle = 'rgba(245,239,224,.18)';
  for (const r of [20, 40, 58]) { rctx.beginPath(); rctx.arc(0, 0, r, 0, 7); rctx.stroke(); }
  const px = (x: number) => (x - p.x) / RANGE * (R - 4);
  const pz = (z: number) => (z - p.z) / RANGE * (R - 4);
  for (const e of m.ents) {
    if (e.isPlayer) continue;
    const dx = e.x - p.x, dz = e.z - p.z;
    if (dx * dx + dz * dz > RANGE * RANGE) continue; // radar only reads nearby
    rctx.fillStyle = e.frozen ? '#4dd0e1' : e.team === 'water' ? '#ff9c5a' : '#f5efe0';
    rctx.beginPath(); rctx.arc(px(e.x), pz(e.z), 3.4, 0, 7); rctx.fill();
  }
  // drops + exit markers on the objective mode
  for (const d of m.drops) if (!d.taken) {
    const dx = d.x - p.x, dz = d.z - p.z;
    if (dx * dx + dz * dz < RANGE * RANGE) {
      rctx.fillStyle = '#6fd4ff';
      rctx.beginPath(); rctx.arc(px(d.x), pz(d.z), 2.6, 0, 7); rctx.fill();
    }
  }
  if (m.exitRing) {
    rctx.strokeStyle = '#4ecb71'; rctx.lineWidth = 2;
    rctx.beginPath(); rctx.arc(px(m.exitX), pz(m.exitZ), 5, 0, 7); rctx.stroke();
  }
  // police refuge
  const sz = m.world.safeZone;
  if (sz) {
    rctx.strokeStyle = 'rgba(77,208,225,.7)'; rctx.lineWidth = 1.6;
    rctx.beginPath(); rctx.arc(px(sz.x), pz(sz.z), sz.r / 20 * (R - 4), 0, 7); rctx.stroke();
  }
  // you
  rctx.fillStyle = '#ffc93c';
  rctx.beginPath(); rctx.arc(0, 0, 4, 0, 7); rctx.fill();
  rctx.restore();
}

// ---------- game state ----------
type Phase = 'menu' | 'intro' | 'play' | 'paused' | 'over';
let phase: Phase = 'menu';
let world: World | null = null;
let worldMap: MapId | null = null;
let match: Match | null = null;
let introT = 0, cdShown = -1;
let chapter: number | null = null; // ROAD NORTH index, or free play

function startMatch(opts: { cfg?: ModeCfg; map?: MapId; mut?: Mut; ch?: number } = {}) {
  chapter = opts.ch ?? null;
  const def = chapter !== null ? ROAD_NORTH[chapter] : null;
  const cfg = opts.cfg ?? def?.cfg ?? selMode;
  const map = opts.map ?? def?.map ?? selMap;
  const mut = opts.mut ?? def?.mut ?? {};
  if (!world || worldMap !== map) {
    if (world) disposeWorld(scene, world);
    world = map === 'school' ? buildSchool(scene) : buildWorld(scene);
    worldMap = map;
  }
  match?.dispose();
  match = new Match(scene, world, cfg, selChar, onMatchEvent, mut);
  (window as unknown as Record<string, unknown>).__m = match;
  phase = 'intro';
  introT = 0; cdShown = -1;
  show(null);
  hud.classList.add('show');
  if (isTouch()) touch.classList.add('show');
  hudFor(match);
  const teamMsg = chapter !== null
    ? `${ROAD_NORTH[chapter].city} — ${ROAD_NORTH[chapter].sub}`
    : match.player.team === 'water' ? 'You are WATER — freeze them all!' : 'You are ICE — stay free till the whistle!';
  toast(teamMsg, 2600);
  AU.initAudio();
}
(window as unknown as Record<string, unknown>).__start = startMatch;

function endMatch() {
  if (!match) return;
  phase = 'over';
  hud.classList.remove('show');
  touch.classList.remove('show');
  const s = match.stats;
  // road progress — winning a stop unlocks the next
  if (chapter !== null && s.won) {
    const prog = store.get<number>('road', 0);
    if (chapter >= prog) store.set('road', chapter + 1);
  }
  const banner = $('resBanner');
  banner.textContent = s.won ? 'YOU WIN! 🏆' : 'YOU LOSE';
  banner.classList.toggle('lose', !s.won);
  $('resSub').textContent = chapter !== null
    ? (s.won ? `${ROAD_NORTH[chapter].city} cleared. The road goes on.` : `${ROAD_NORTH[chapter].city} held you back.`)
    : s.yourTeam === 'water'
      ? (s.won ? 'Every single one of them — frozen solid.' : 'They slipped through your fingers.')
      : (s.won ? 'You stayed free till the whistle. Legend.' : 'The water got everybody.');
  const next = $('btnNextCh');
  const hasNext = chapter !== null && s.won && chapter + 1 < ROAD_NORTH.length;
  next.style.display = hasNext ? '' : 'none';
  $('resStats').innerHTML =
    `<div><b>${s.frozenByYou}</b>frozen by you</div>` +
    `<div><b>${s.rescuesByYou}</b>rescues</div>` +
    `<div><b>${s.timesFrozen}</b>times frozen</div>` +
    `<div><b>${s.yourTeam.toUpperCase()}</b>your team</div>`;
  setTimeout(() => show('results'), 1200);
}

function onMatchEvent(e: string, ent?: Ent) {
  if (!match) return;
  if (e === 'frozen') {
    toast(ent?.isPlayer ? 'YOU ARE FROZEN! E — call your crew!' : `${ent?.name} IS FROZEN!`);
  } else if (e === 'thaw') {
    toast(ent?.isPlayer ? 'SAVED! Run!' : `${ent?.name} is free!`);
  } else if (e === 'drop') {
    toast(`WATER DROP ${match.dropsGot}/${match.dropsNeed}`);
  } else if (e === 'twist') {
    toast('THE DROPS TURN — RUN FOR THE EXIT!', 2400);
  } else if (e === 'nepa') {
    toast('NEPA DON TAKE LIGHT! 💡', 2200);
  } else if (e === 'rain') {
    toast('RAIN DEY FALL! 🌧', 2200);
  } else if (e === 'exit') {
    toast('HOME FREE!');
  } else if (e === 'marked') {
    toast('THEY HEARD YOU — RUN!', 1800);
  } else if (e === 'safe') {
    toast('POLICE REFUGE — safe while it lasts', 2000);
  } else if (e === 'safeout') {
    toast('REFUGE EXPIRED — MOVE!', 1800);
  } else if (e === 'end') {
    endMatch();
  }
  hudFor(match);
}

function quitToMenu() {
  match?.dispose(); match = null;
  phase = 'menu';
  hud.classList.remove('show');
  touch.classList.remove('show');
  $('countdown').classList.remove('show');
  show('menu');
  AU.stopMusic();
}

function pauseGame() {
  if (phase !== 'play' || !match || match.over) return;
  phase = 'paused';
  modal('pause');
}
function resumeGame() {
  if (phase !== 'paused') return;
  phase = 'play';
  modal(null);
}

// ---------- THE ROAD NORTH — chapter list ----------
function buildRoad() {
  const list = $('roadList');
  list.innerHTML = '';
  const prog = store.get<number>('road', 0);
  ROAD_NORTH.forEach((ch, i) => {
    const done = i < prog, open = i <= prog;
    const b = document.createElement('button');
    b.className = 'road-node' + (done ? ' done' : '') + (open ? '' : ' lock');
    b.innerHTML =
      `<span class="road-num">${done ? '✓' : open ? '●' : '🔒'}</span>` +
      `<span class="road-city">${ch.city}</span>` +
      `<span class="road-desc">${ch.sub}</span>` +
      `<span class="road-map">${ch.map === 'school' ? '🏫' : '🏘'} ${ch.cfg.name}</span>`;
    b.onclick = () => {
      if (!open) { toast('Clear the earlier stops first!', 1600); return; }
      AU.unlockAudio();
      startMatch({ ch: i });
    };
    list.appendChild(b);
  });
}

// ---------- buttons ----------
$('btnPlay').onclick = () => { AU.unlockAudio(); show('setup'); };
$('btnRoad').onclick = () => { AU.unlockAudio(); buildRoad(); show('campaign'); };
$('btnRoadBack').onclick = () => show('menu');
$('btnNextCh').onclick = () => {
  if (chapter !== null && chapter + 1 < ROAD_NORTH.length) startMatch({ ch: chapter + 1 });
};
$('btnHow').onclick = () => modal('howto');
$('btnHowClose').onclick = () => modal(null);
$('btnSettings').onclick = () => { syncSettings(); modal('settings'); };
$('btnSetClose').onclick = () => modal(null);
$('btnBack').onclick = () => show('menu');
$('btnStart').onclick = () => { AU.unlockAudio(); startMatch(); };
$('btnPause').onclick = pauseGame;
$('btnResume').onclick = resumeGame;
$('btnRestart').onclick = () => { modal(null); startMatch(); };
$('btnQuit').onclick = () => { modal(null); quitToMenu(); };
$('btnRematch').onclick = () => startMatch(chapter !== null ? { ch: chapter } : {});
$('btnResMenu').onclick = quitToMenu;

document.addEventListener('visibilitychange', () => { if (document.hidden) pauseGame(); });

// ---------- friend invite link: ?join=CODE ----------
// The code is kept for the room hookup — the chip makes the invite visible.
const joinCode = new URLSearchParams(location.search).get('join');
if (joinCode) {
  store.set('joinCode', joinCode);
  const chip = $('joinChip');
  chip.textContent = `FRIEND INVITE · ${joinCode.toUpperCase()} — online rooms loading soon`;
  chip.classList.add('show');
}

// ---------- boot ----------
initInput(canvas);
const clock = new THREE.Clock();

// fake-but-honest progress: world builds in a couple of frames
const LOAD_STEPS = ['warming up the pitch…', 'painting the lines…', 'calling the spectators…', 'finding the danfo…'];
let loadStep = 0;
const loadInt = setInterval(() => {
  loadStep++;
  ($('loadFill') as HTMLElement).style.width = Math.min(100, loadStep * 26) + '%';
  $('loadMsg').textContent = LOAD_STEPS[Math.min(loadStep, LOAD_STEPS.length - 1)];
  if (loadStep >= 4) {
    clearInterval(loadInt);
    world = buildWorld(scene);
    ensureEnv(renderer, scene);
    setTimeout(() => show('menu'), 250);
  }
}, 220);

function tick(dt: number) {
  const inp = readInput();

  if (world) updateWorld(world, dt);

  if (match) {
    if (inp.pauseDown) {
      if (phase === 'paused') resumeGame(); else pauseGame();
    }
    if (phase === 'intro') {
      introT += dt;
      match.introCam(Math.min(introT, 2.6) / 2.6 * 1.2 + .6, camera);
      // camera sweeps in during countdown too
      const cd = match.cd;
      const n = Math.ceil(cd);
      if (n !== cdShown && n > 0) {
        cdShown = n;
        cdEl.textContent = String(n);
        cdEl.classList.add('show');
        AU.sCount(false);
      }
      if (introT > 1.4) {
        // transition to sim countdown
        match.update(dt, inp, camera);
      }
      if (match.phase === 'play') {
        cdEl.textContent = 'GO!';
        AU.sCount(true);
        setTimeout(() => cdEl.classList.remove('show'), 600);
        phase = 'play';
      }
    } else if (phase === 'play') {
      match.update(dt, inp, camera);
      hudFor(match);
    } else if (phase === 'over') {
      match.update(dt, inp, camera);
    }
    // toast decay
    if (toastT > 0) { toastT -= dt; if (toastT <= 0) $('hudToast').classList.remove('show'); }
    // stamina
    const sf = $('stamFill') as HTMLElement;
    sf.style.width = (match.player.stamina * 100).toFixed(0) + '%';
    sf.classList.toggle('low', match.player.stamina < .3);
    drawRadar(match);
  } else {
    // idle menu camera — slow orbit over the pitch
    const t = clock.elapsedTime * .08;
    camera.position.set(Math.sin(t) * 30, 17, Math.cos(t) * 30);
    camera.lookAt(0, 0, 0);
  }

  // podium preview only renders while the setup screen is up
  if ($('setup').classList.contains('show') && podBean) {
    podBean.root.rotation.y += dt * 1.2;
    animBean(podBean, dt, 0, false, false);
    podRen.render(podScene, podCam);
  }

  renderer.render(scene, camera);
}

function frame() {
  requestAnimationFrame(frame);
  tick(clamp(clock.getDelta(), 0, .05));
}
(window as unknown as Record<string, unknown>).__tick = tick;
frame();
