import Phaser from 'phaser';
import { CONFIG } from './config';

// All "art" is generated at runtime into textures — zero asset files.

export function makeTextures(scene: Phaser.Scene) {
  const g = scene.add.graphics();
  const { runner, chaser, colors } = CONFIG;

  // Top-down kid: shirt body + skin head nudged toward +x (the facing
  // direction), with a hair cap behind it. Rotating the sprite = turning.
  const character = (
    key: string,
    skin: number,
    shirt: number,
    opts: { ring?: number; uniform?: boolean } = {},
  ) => {
    const R = runner.radius;
    const c = R + 6; // canvas center with margin
    const s = c * 2;
    g.clear();
    // body (shirt)
    g.fillStyle(shirt, 1);
    g.fillCircle(c, c, R);
    // uniform sash for the militia
    if (opts.uniform) {
      g.fillStyle(0x7a1c1c, 1);
      g.fillRect(c - 2.5, c - R, 5, R * 2);
    }
    // head, offset toward +x = facing
    g.fillStyle(skin, 1);
    g.fillCircle(c + R * 0.34, c, R * 0.6);
    // hair cap behind the head
    g.fillStyle(0x1d1512, 1);
    g.fillCircle(c + R * 0.12, c, R * 0.42);
    // player ring
    if (opts.ring !== undefined) {
      g.lineStyle(3, opts.ring, 1);
      g.strokeCircle(c, c, R - 1);
    }
    g.generateTexture(key, s, s);
  };

  character('player', colors.skin2, colors.player, { ring: 0xffffff });
  character('runner', colors.skin1, colors.runner);
  character('chaser', colors.skin3, colors.chaser, { uniform: true });

  // podium hero — front-facing kid for the title stage (sign-painted flat)
  // baked at 3x so it stays sharp at podium scale
  g.clear();
  const hx = 138; // character center-x inside the 276×384 canvas
  const skin = colors.skin2;
  const shirt = colors.player;
  // sandals
  g.fillStyle(0x1d1512, 1);
  g.fillEllipse(hx - 42, 366, 66, 24);
  g.fillEllipse(hx + 42, 366, 66, 24);
  // legs
  g.fillStyle(skin, 1);
  g.fillRoundedRect(hx - 57, 276, 39, 84, 15);
  g.fillRoundedRect(hx + 18, 276, 39, 84, 15);
  // shorts
  g.fillStyle(0x1c1626, 1);
  g.fillRoundedRect(hx - 66, 222, 132, 72, 21);
  // torso — player blue jersey with a chalk collar
  g.fillStyle(shirt, 1);
  g.fillRoundedRect(hx - 72, 108, 144, 132, 36);
  g.fillStyle(0xf5efe0, 0.9);
  g.fillRoundedRect(hx - 24, 108, 48, 21, 9);
  // arms hanging easy
  g.fillStyle(skin, 1);
  g.fillEllipse(hx - 84, 174, 36, 90);
  g.fillEllipse(hx + 84, 174, 36, 90);
  // head
  g.fillStyle(skin, 1);
  g.fillCircle(hx, 60, 54);
  // hair cap
  g.fillStyle(0x1d1512, 1);
  g.fillCircle(hx, 30, 45);
  g.fillRect(hx - 45, 24, 90, 18);
  // face — two dots + a grin
  g.fillStyle(0x12090a, 1);
  g.fillCircle(hx - 18, 60, 7.2);
  g.fillCircle(hx + 18, 60, 7.2);
  g.lineStyle(8, 0x12090a, 1);
  g.beginPath();
  g.arc(hx, 75, 21, Math.PI * 0.15, Math.PI * 0.85);
  g.strokePath();
  // danfo-yellow headband — the brand stripe
  g.fillStyle(0xf2c531, 1);
  g.fillRoundedRect(hx - 51, 18, 102, 21, 9);
  g.generateTexture('hero', 276, 384);

  // soft drop shadow
  g.clear();
  g.fillStyle(0x000000, 0.28);
  g.fillEllipse(18, 8, 32, 9);
  g.generateTexture('shadow', 36, 16);

  // particle dot (white — tint at emit time)
  g.clear();
  g.fillStyle(0xffffff, 1);
  g.fillCircle(3, 3, 3);
  g.generateTexture('dot', 6, 6);

  // dust puff
  g.clear();
  g.fillStyle(0xcbb894, 1);
  g.fillCircle(4, 4, 4);
  g.generateTexture('dust', 8, 8);

  // ice block overlay for frozen runners
  g.clear();
  g.fillStyle(0x9adcf0, 0.55);
  g.fillRoundedRect(0, 0, 44, 44, 8);
  g.lineStyle(2, 0xeafcff, 0.9);
  g.strokeRoundedRect(1, 1, 42, 42, 8);
  g.generateTexture('iceblock', 44, 44);

  // items — same circle language, distinct colors + markings
  const item = (key: string, color: number, mark: (c: number) => void) => {
    g.clear();
    g.fillStyle(0x2b2115, 1);
    g.fillCircle(11, 11, 11);
    g.fillStyle(color, 1);
    g.fillCircle(11, 11, 9);
    mark(11);
    g.generateTexture(key, 22, 22);
  };

  item('slippers', colors.slippers, (c) => {
    // flip-flop strap
    g.lineStyle(2, 0x2b2115, 0.9);
    g.lineBetween(c - 5, c - 3, c, c + 2);
    g.lineBetween(c + 5, c - 3, c, c + 2);
  });
  item('charm', colors.charm, (c) => {
    // little star
    g.fillStyle(0xf3e8ff, 1);
    g.fillTriangle(c, c - 6, c - 4, c + 3, c + 4, c + 3);
  });
  item('water', colors.water, (c) => {
    // sachet glint
    g.fillStyle(0xe0faff, 0.95);
    g.fillCircle(c - 2, c - 2, 3);
  });

  // danfo bus — Lagos yellow with the black stripe
  g.clear();
  g.fillStyle(0xf2c531, 1);
  g.fillRoundedRect(0, 6, 150, 42, 10);
  g.fillStyle(0x1d1d1d, 1);
  g.fillRect(0, 26, 150, 7); // the stripe
  g.fillStyle(0xbfe3f0, 1);
  for (let i = 0; i < 4; i++) g.fillRoundedRect(12 + i * 32, 12, 24, 12, 3); // windows
  g.fillStyle(0x222222, 1);
  g.fillCircle(30, 50, 9);
  g.fillCircle(118, 50, 9); // wheels
  g.generateTexture('bus', 150, 60);

  // decor
  g.clear();
  g.lineStyle(5, 0x2e2a26, 1);
  g.strokeCircle(14, 14, 10);
  g.generateTexture('tire', 28, 28);

  g.clear();
  g.fillStyle(0x9a8f80, 1);
  g.fillEllipse(10, 7, 18, 12);
  g.generateTexture('rock', 20, 14);

  g.destroy();

  // danger vignette — screen-space overlay, sized to the viewport
  const { width, height } = CONFIG.view;
  if (scene.textures.exists('vignette')) return;
  const vt = scene.textures.createCanvas('vignette', width, height);
  if (vt) {
    const ctx = vt.getContext();
    const grad = ctx.createRadialGradient(
      width / 2,
      height / 2,
      height * 0.32,
      width / 2,
      height / 2,
      height * 0.75,
    );
    grad.addColorStop(0, 'rgba(180,20,20,0)');
    grad.addColorStop(1, 'rgba(180,20,20,0.55)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, width, height);
    vt.refresh();
  }
}

// Chalk pitch markings + a bit of set dressing so the sand reads as a
// Nigerian schoolyard football field, not an empty box.
// rng: pass a seeded RNG so every net client decorates identically.
// Returns everything it created so scenes can rebuild on a new layout.
export function decorateYard(
  scene: Phaser.Scene,
  obstacleRects: Phaser.Geom.Rectangle[],
  rng: () => number = Math.random,
): Phaser.GameObjects.GameObject[] {
  const { width, height, wall } = CONFIG.arena;
  const out: Phaser.GameObjects.GameObject[] = [];
  const d = scene.add.graphics().setDepth(0);
  out.push(d);
  d.lineStyle(3, CONFIG.colors.chalk, 0.4);

  d.strokeRect(wall + 4, wall + 4, width - wall * 2 - 8, height - wall * 2 - 8);
  d.lineBetween(width / 2, wall + 4, width / 2, height - wall - 4);
  d.strokeCircle(width / 2, height / 2, 150);
  // goal boxes
  d.strokeRect(wall + 4, height / 2 - 120, 96, 240);
  d.strokeRect(width - wall - 100, height / 2 - 120, 96, 240);

  // danfo-yellow dashed boundary just inside the chalk — the brand accent
  const ins = wall + 16;
  const dash = (x1: number, y1: number, x2: number, y2: number) =>
    d.lineBetween(x1, y1, x2, y2);
  d.lineStyle(4, 0xf7bd14, 0.55);
  for (let x = ins; x < width - ins - 14; x += 30) {
    dash(x, ins, x + 14, ins);
    dash(x, height - ins, x + 14, height - ins);
  }
  for (let y = ins; y < height - ins - 14; y += 30) {
    dash(ins, y, ins, y + 14);
    dash(width - ins, y, width - ins, y + 14);
  }

  // scattered junk — tires and rocks, kept clear of obstacles
  for (let i = 0; i < 26; i++) {
    const x = wall + 40 + rng() * (width - wall * 2 - 80);
    const y = wall + 40 + rng() * (height - wall * 2 - 80);
    const inside = obstacleRects.some((r) =>
      Phaser.Geom.Rectangle.Contains(
        new Phaser.Geom.Rectangle(r.x - 30, r.y - 30, r.width + 60, r.height + 60),
        x,
        y,
      ),
    );
    if (inside) continue;
    const key = rng() < 0.4 ? 'tire' : 'rock';
    const s = scene.add.sprite(x, y, key).setDepth(0.1);
    s.setAngle(Math.floor(rng() * 360));
    s.setAlpha(0.85);
    out.push(s);
  }
  return out;
}
