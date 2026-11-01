import Phaser from 'phaser';
import { CONFIG } from './config';
import { levelDef } from './adventure';
import { loadPicks } from './meta';
import { requireAuth } from './xauth';
import { pullProgress, pullProfile, pushProfile } from './cloudsave';
import { TitleScene } from './scenes/TitleScene';
import { GameScene } from './scenes/GameScene';
import { LobbyScene } from './scenes/LobbyScene';
import { NetScene } from './scenes/NetScene';
import { AdventureScene } from './scenes/AdventureScene';
import { DropScene } from './scenes/DropScene';
import { OutfitScene } from './scenes/OutfitScene';
import { promptModal } from './fgui';

// mobile hygiene: no long-press menus, no pull-to-refresh scroll
document.addEventListener('contextmenu', (e) => e.preventDefault());

// keep the screen awake while playing (best-effort, silently ignored if unsupported)
const wakeLock = () => {
  try {
    void navigator.wakeLock?.request('screen').catch(() => {});
  } catch {
    /* unsupported — fine */
  }
};
window.addEventListener('pointerdown', wakeLock);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') wakeLock();
});

// wait for webfonts so Phaser text doesn't render in fallback fonts
const boot = () =>
  new Phaser.Game({
    type: Phaser.AUTO,
    width: CONFIG.view.width,
    height: CONFIG.view.height,
    // game-root's client box is the safe area — RESIZE therefore fits the
    // canvas inside notch/island insets instead of spilling under them
    parent: document.getElementById('game-root') ?? document.body,
    transparent: true, // the 3D stage canvas shows through in match scenes
    physics: {
      default: 'arcade',
      arcade: { debug: false },
    },
    input: {
      activePointers: 3, // multi-touch: joystick + sprint + button at once
    },
    dom: {
      createContainer: true, // lobby name/code inputs
    },
    scale: {
      mode: Phaser.Scale.RESIZE, // fill the whole window — no letterbox bars
      autoCenter: Phaser.Scale.CENTER_BOTH,
    },
    scene: [TitleScene, GameScene, LobbyScene, NetScene, AdventureScene, DropScene, OutfitScene],
  });

// page-load timestamp — the READY handler below holds #boot until the
// two-frame art sequence has had its >= 3s on screen
const bootShownAt = performance.now();

// honest loading % — raises the counter's cap at each real milestone;
// the page-side ticker drifts toward it, never past it
const bootPct = (n: number) =>
  (window as unknown as { __bootPct?: (n: number) => void }).__bootPct?.(n);

const go = () => {
  const game = boot();
  // debug/tests handle — lets tooling inspect scenes + input state
  (window as unknown as { __iwGame?: Phaser.Game }).__iwGame = game;
  // the 3D stage canvas sits behind (fixed, z:0) — the game canvas must be
  // positioned to stack above it, since a static element can't win on z
  game.canvas.style.position = 'relative';
  game.canvas.style.zIndex = '1';
  // ...and the DOM container rides ABOVE the game canvas (z:2) — inputs,
  // prompts and name fields live there; canvas z:1 was burying them all
  if (game.domContainer) game.domContainer.style.zIndex = '2';
  // mobile toolbars move the VISUAL viewport without emitting window.resize
  // (Chrome's dynamic-toolbar model; the page can't scroll past overflow:hidden
  // to trigger one). Phaser only listens to window resize, so the canvas stays
  // sized to the stale, taller viewport and flex-centering clips the top bar.
  // visualViewport.resize does fire there — we resize the game to the visual
  // height directly, which emits Phaser's own resize event, so scene restart
  // logic runs as usual (and the textInputFocused keyboard guard still holds).
  const vv = window.visualViewport;
  const root = document.getElementById('game-root') ?? document.body;
  const sync = () => {
    // measure the safe-area box, not the raw viewport — body padding keeps
    // the game clear of the island/home-bar zones
    const w = root.clientWidth;
    const h = root.clientHeight;
    const cur = game.scale.gameSize;
    if (cur.width !== w || cur.height !== h) game.scale.resize(w, h);
  };
  if (vv) {
    vv.addEventListener('resize', sync);
    vv.addEventListener('scroll', sync);
  }
  // drop the boot splash once Phaser is live — covers every scene entry,
  // including the dev hash jumps below that skip the title screen — but
  // hold it >= 3s from page start so the two-frame art sequence plays out
  game.events.once(Phaser.Core.Events.READY, () => {
    bootPct(100); // engine live — the art hands off
    const hold = Math.max(0, 3000 - (performance.now() - bootShownAt));
    setTimeout(() => document.getElementById('boot')?.remove(), hold);
    // dev shortcut — #adventure / #advance:5 / #gamelevel:3 / #lobby.
    // Route through the title scene's own plugin so `start` stops it — a bare
    // game.scene.start leaves the title running behind (its DOM hero leaks).
    const jumpTo = (key: string, data?: object) =>
      game.scene.getScene('title').scene.start(key, data);
    const [jump, arg] = location.hash.slice(1).split(':');
    if (jump === 'adventure') jumpTo('adventure');
    else if (jump === 'advance')
      jumpTo('adventure', { advance: Number(arg) || undefined });
    else if (jump === 'gamelevel')
      jumpTo('game', {
        adventure: levelDef(Number(arg) || 1),
        difficulty: loadPicks().difficulty,
      });
    else if (jump === 'drop')
      jumpTo('drop', { game: { adventure: levelDef(Number(arg) || 1) } });
    else if (jump) jumpTo(jump);
  });
  (window as unknown as { __game: Phaser.Game }).__game = game; // e2e/CDP hook
  (window as unknown as { __ui: { promptModal: typeof promptModal } }).__ui = { promptModal }; // e2e modal probe

  // RAF-death watchdog — Phaser's RequestAnimationFrame.step invokes the
  // frame callback unguarded: one exception anywhere in a frame (scene
  // update, queue op, render) and the next RAF is never scheduled, yet
  // `loop.running` still reads true. The game freezes on whatever frame was
  // last drawn — a dead scene that looks alive. `loop.frame` is the honest
  // heartbeat: if it stalls while the tab is visible, re-arm the step chain.
  let lastFrame = 0;
  window.setInterval(() => {
    if (document.visibilityState !== 'visible' || !game.isRunning) return;
    if (game.loop.frame === lastFrame) {
      const raf = game.loop.raf as unknown as {
        isRunning: boolean;
        callback: FrameRequestCallback;
        isSetTimeOut: boolean;
        delay: number;
        start: (cb: FrameRequestCallback, forceTimeout: boolean, delay: number) => void;
      };
      // isRunning stays true when the chain died — clear it so start()
      // doesn't early-return, then re-arm with the params it was born with
      if (raf.isRunning) {
        raf.isRunning = false;
        raf.start(raf.callback, raf.isSetTimeOut, raf.delay);
      }
    }
    lastFrame = game.loop.frame;
  }, 1500);
};

// the gate is the point: no verified X session, no game. A stored token
// boots silently; a missing one swaps the boot splash for the connect
// overlay and the promise simply never resolves until sign-in lands.
// (dev with no api configured passes through — see xauth.ts)
const start = () => {
  bootPct(15); // fonts landed — past the parse phase
  requireAuth().then((s) => {
    if (s === undefined) return; // unreachable, keeps the type honest
    bootPct(40); // session resolved (gate path stalls here on purpose)
    // cloud save: pull before scenes read progress, but never let a slow
    // api stall boot — late merges still land in storage for the map
    Promise.race([
      Promise.allSettled([pullProgress(2500), pullProfile(2500)]),
      new Promise((r) => setTimeout(r, 2500)),
    ]).then(() => {
      bootPct(75); // progression + profile merged (or capped)
      // upload whatever local-only fields remote lacked — converges both
      // directions; fire-and-forget, never gates the menu
      if (s) pushProfile();
      go();
    });
  });
};

if (document.fonts?.ready) {
  document.fonts.ready.then(start);
} else {
  start();
}
