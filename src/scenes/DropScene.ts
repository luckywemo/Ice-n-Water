import Phaser from 'phaser';
import { Hero3D } from '../hero3d';
import { DISPLAY_FONT, UI_FONT, REDUCED_MOTION } from '../ui';
import { FG, FG_FONT } from '../fgui';
import { DIFFS, Difficulty, perfInterval, furQuality } from '../meta';
import { LevelDef } from '../adventure';
import { currentChar } from '../characters';
import { fitZoom } from '../mobile';
import { viaWipe, wipeTo } from '../wipe';

// DropScene — the FALL GUYS "populating" beat, retold our way: the furry
// bean skydives through a cyan sky while the level name lands under it.
// Pure theatre — ~2.4s, then it hands the payload straight to GameScene.
// SKIP (tap / SPACE) cuts it short; in-game restarts bypass it entirely.

const VW = 1280,
  VH = 800;
const HOLD = 2400; // ms on screen before the level starts

interface DropData {
  game?: { adventure?: LevelDef; difficulty?: Difficulty };
}

export class DropScene extends Phaser.Scene {
  private hero3d?: Hero3D;
  private heroCv?: HTMLCanvasElement;
  private heroCtx?: CanvasRenderingContext2D;
  private heroImg?: Phaser.GameObjects.Image;
  private heroLastT = 0; // throttle on the composite
  private heroMs = 33; // ms between composites — the Bean FPS pick
  private streaks: Phaser.GameObjects.Rectangle[] = [];
  private gone = false;

  constructor() {
    super('drop');
  }

  create(data: DropData) {
    const gameData = data?.game ?? (data as DropData['game']) ?? {};
    this.heroMs = perfInterval(); // re-read per create — the pick can change
    // scene instance persists — a restart (resize mid-drop) would otherwise
    // leave `gone` latched and finish() permanently unreachable
    this.gone = false;
    this.streaks = [];
    const W = this.scale.width,
      H = this.scale.height;
    const zoom = fitZoom(W, H, VW, VH);
    this.cameras.main.setZoom(zoom).centerOn(VW / 2, VH / 2);

    // sky — oversized so letterbox margins stay blue at any aspect
    this.add.rectangle(VW / 2, VH / 2, VW * 3, VH * 3, FG.sky);
    // soft vertical cloud-shadow bands
    for (let i = 0; i < 9; i++) {
      this.add
        .rectangle(-400 + i * 260, VH / 2, 130, VH * 3, 0x0e6fae)
        .setAlpha(0.09);
    }
    // speed lines — thin white streaks racing down sell the fall
    for (let i = 0; i < 22; i++) {
      const r = this.add
        .rectangle(
          -300 + Math.random() * (VW + 600),
          -200 - Math.random() * 900,
          2 + Math.random() * 3,
          80 + Math.random() * 140,
          0xffffff,
          0.55 + Math.random() * 0.4,
        )
        .setData('v', 1400 + Math.random() * 900);
      this.streaks.push(r);
    }

    // the bean, mid-dive — deep + high camera on a tall buffer: spread
    // flippers and trailing feet keep full margins, and the top-down
    // angle keeps the face readable in the belly-first posture
    const pc = currentChar(); // the skydiver wears your picked bean
    const hero = (this.hero3d = new Hero3D(760, 700, 6.5, 3.1, 0.85, pc));
    hero.furQ = furQuality(); // the Bean FPS pick carries the coat
    if (hero.ok && hero.canvas) {
      hero.skydiving = true;
      hero.setVariant(pc.body, pc.skin);
      const cv = (this.heroCv = document.createElement('canvas'));
      cv.width = 760;
      cv.height = 700;
      this.heroCtx = cv.getContext('2d')!;
      this.textures.addCanvas('drop_hero', cv);
      this.heroImg = this.add.image(VW / 2, 290, 'drop_hero').setScale(1);
    }

    // what's next — big chunky label under the bean, FG-counter style
    const adv = gameData.adventure;
    const big = adv ? `LEVEL ${adv.n}` : 'CLASSIC';
    const small = adv
      ? `${adv.name.toUpperCase()}${adv.town ? ' — ' + adv.town.toUpperCase() : ''}${adv.boss ? ' · BOSS' : ''}`
      : (DIFFS[gameData.difficulty ?? 'normal'].label ?? 'NORMAL').toUpperCase();
    const mk = (y: number, size: number, str: string, alpha = 1) =>
      this.add
        .text(VW / 2, y, str, {
          fontFamily: DISPLAY_FONT,
          fontSize: `${size}px`,
          color: '#ffffff',
          stroke: '#0e6fae',
          strokeThickness: size * 0.09,
        })
        .setOrigin(0.5)
        .setAlpha(alpha)
        .setShadow(0, size * 0.08, 'rgba(10,60,90,0.35)', 6);
    mk(575, 58, big);
    mk(632, 24, small, 0.95);

    this.add
      .text(34, VH - 34, 'the militia is waiting…', {
        fontFamily: UI_FONT,
        fontSize: '15px',
        color: '#ffffff',
        fontStyle: 'italic',
      })
      .setAlpha(0.85);

    // SKIP — bottom-right pill, same slot as their CANCEL
    const skip = this.add
      .text(VW - 34, VH - 34, 'SKIP ▸', {
        fontFamily: FG_FONT,
        fontSize: '20px',
        color: '#ffffff',
        backgroundColor: '#0e6fae',
        padding: { x: 16, y: 10 },
      })
      .setOrigin(1, 0.5)
      .setInteractive({ useHandCursor: true });
    skip.on('pointerdown', () => this.go(gameData));
    this.input.keyboard?.once('keydown-SPACE', () => this.go(gameData));

    this.time.delayedCall(REDUCED_MOTION ? 1200 : HOLD, () => this.go(gameData));
    if (!viaWipe(data)) this.cameras.main.fadeIn(240, 98, 200, 242);
    this.events.once('shutdown', () => {
      this.hero3d?.dispose();
      this.hero3d = undefined;
      if (this.textures.exists('drop_hero')) this.textures.remove('drop_hero');
    });
  }

  private go(gameData: DropData['game']) {
    if (this.gone) return;
    this.gone = true;
    wipeTo(this, 'game', gameData);
  }

  update(_t: number, delta: number) {
    // streaks fall; bean stays put — the world moves, not the diver
    for (const r of this.streaks) {
      r.y += (r.getData('v') as number) * (delta / 1000);
      if (r.y > VH + 400) {
        r.y = -500 - Math.random() * 400;
        r.x = -300 + Math.random() * (VW + 600);
      }
    }
    if (this.hero3d?.ok && this.hero3d.canvas && this.heroCtx && this.time.now - this.heroLastT >= this.heroMs) {
      // the dive is slow — the user's Bean FPS pick is plenty
      this.heroLastT = this.time.now;
      this.hero3d.update(this.time.now);
      this.heroCtx.clearRect(0, 0, 760, 700);
      this.heroCtx.drawImage(this.hero3d.canvas, 0, 0);
      this.hero3d.drawFur(this.heroCtx, -1, -1);
      (this.textures.get('drop_hero') as Phaser.Textures.CanvasTexture).refresh();
    }
  }
}
