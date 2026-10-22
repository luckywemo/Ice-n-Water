import Phaser from 'phaser';
import { CONFIG } from './config';
import { levelDef } from './adventure';
import { TitleScene } from './scenes/TitleScene';
import { GameScene } from './scenes/GameScene';
import { LobbyScene } from './scenes/LobbyScene';
import { NetScene } from './scenes/NetScene';
import { AdventureScene } from './scenes/AdventureScene';

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
    scene: [TitleScene, GameScene, LobbyScene, NetScene, AdventureScene],
  });

const go = () => {
  const game = boot();
  (window as unknown as { __game: Phaser.Game }).__game = game; // e2e/CDP hook
  // dev shortcut — #adventure / #adventure:police / #advance:ice:5 / #gamelevel:ice:3 / #lobby
  const [jump, arg, arg2] = location.hash.slice(1).split(':');
  const track = arg === 'police' ? 'police' : 'ice';
  if (jump === 'adventure') game.scene.start('adventure', { track });
  else if (jump === 'advance')
    game.scene.start('adventure', { track, advance: Number(arg2) || undefined });
  else if (jump === 'gamelevel')
    game.scene.start('game', { adventure: levelDef(track, Number(arg2) || 1) });
  else if (jump) game.scene.start(jump);
};

if (document.fonts?.ready) {
  document.fonts.ready.then(go);
} else {
  go();
}
