import Phaser from 'phaser';
import { CONFIG } from './config';
import { levelDef } from './adventure';
import { requireAuth } from './xauth';
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
    parent: document.body,
    backgroundColor: '#0d1b2a',
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

const go = () => {
  const game = boot();
  // mobile toolbars move the VISUAL viewport without emitting window.resize
  // (Chrome's dynamic-toolbar model; the page can't scroll past overflow:hidden
  // to trigger one). Phaser only listens to window resize, so the canvas stays
  // sized to the stale, taller viewport and flex-centering clips the top bar.
  // visualViewport.resize does fire there — we resize the game to the visual
  // height directly, which emits Phaser's own resize event, so scene restart
  // logic runs as usual (and the textInputFocused keyboard guard still holds).
  const vv = window.visualViewport;
  if (vv) {
    const sync = () => {
      // vv dims are already CSS px of the visible area; scale ≈ pinch zoom.
      // resize() only emits when the size actually changes — no-op on desktop.
      const w = Math.round(vv.width * vv.scale);
      const h = Math.round(vv.height * vv.scale);
      const cur = game.scale.gameSize;
      if (cur.width !== w || cur.height !== h) game.scale.resize(w, h);
    };
    vv.addEventListener('resize', sync);
    vv.addEventListener('scroll', sync);
  }
  // drop the boot splash once Phaser is live — covers every scene entry,
  // including the dev hash jumps below that skip the title screen
  game.events.once(Phaser.Core.Events.READY, () => {
    document.getElementById('boot')?.remove();
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
      jumpTo('game', { adventure: levelDef(Number(arg) || 1) });
    else if (jump === 'drop')
      jumpTo('drop', { game: { adventure: levelDef(Number(arg) || 1) } });
    else if (jump) jumpTo(jump);
  });
  (window as unknown as { __game: Phaser.Game }).__game = game; // e2e/CDP hook
  (window as unknown as { __ui: { promptModal: typeof promptModal } }).__ui = { promptModal }; // e2e modal probe
};

// the gate is the point: no verified X session, no game. A stored token
// boots silently; a missing one swaps the boot splash for the connect
// overlay and the promise simply never resolves until sign-in lands.
// (dev with no api configured passes through — see xauth.ts)
const start = () =>
  requireAuth().then((s) => {
    if (s === undefined) return; // unreachable, keeps the type honest
    go();
  });

if (document.fonts?.ready) {
  document.fonts.ready.then(start);
} else {
  start();
}
