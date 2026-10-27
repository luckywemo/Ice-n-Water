import Phaser from 'phaser';
import { Hero3D } from '../hero3d';
import { REDUCED_MOTION } from '../ui';
import { FG, FG_FONT, FG_BODY, fgRings } from '../fgui';
import { CHARACTERS, CharDef, charTitle, charTitleShort, charUnlocked, currentChar, currentPick, runnerName, setChar } from '../characters';
import { playerName } from '../leaderboard';
import { perfInterval, furQuality } from '../meta';
import { Sfx } from '../audio';

// OutfitScene — the wardrobe. Fall Guys' CUSTOMISE › OUTFITS layout:
// live bean on the podium left, a swatch card right with two tabs —
// CHARACTERS (the full cast, mini-bean tiles) and COLOUR (coat paints,
// diagonal coat/skin swatches like their colour tiles). Picks apply
// instantly: the podium bean wears it and setChar persists it for
// every scene that reads currentChar() — including gameplay sheets.

const sfx = Sfx.inst;

const VW = 1280,
  VH = 800;

type Tab = 'chars' | 'coat';

// coat paints — warm/bold tones only; crew blue (0x2e6f8e) and militia
// ice (0x9ccfe8) stay team colours so a repaint can't read as a chaser
const COATS: { name: string; body: number }[] = [
  { name: 'CHOCOLATE', body: 0x8a4f24 },
  { name: 'AGBALUMO', body: 0xb56a26 },
  { name: 'DARK ROAST', body: 0x553219 },
  { name: 'ZOBO', body: 0x8a2f3d },
  { name: 'PALM', body: 0x4f6b35 },
  { name: 'ASPHALT', body: 0x3a3a44 },
  { name: 'DANFO GOLD', body: 0xcf9a1f },
  { name: 'AGBERO', body: 0x6e4a2f },
  { name: 'OBA PURPLE', body: 0x5a3a6a },
  { name: 'PEPPER PINK', body: 0xe84393 },
  { name: 'ADIRE', body: 0x39408f },
];

// card geometry — right panel, swatch grid inside
const CARD = { x: 560, y: 130, w: 684, h: 586 };
const TILE = 116,
  TILE_GAP = 18,
  GRID_X = CARD.x + 34,
  GRID_Y = CARD.y + 96,
  COLS = 4;

export class OutfitScene extends Phaser.Scene {
  private hero3d?: Hero3D;
  private heroSrc?: HTMLCanvasElement;
  private heroCtx?: CanvasRenderingContext2D;
  private heroTex?: Phaser.Textures.CanvasTexture;
  private heroImg?: Phaser.GameObjects.Image;
  private heroLastT = 0;
  private heroMs = 33;
  private tab: Tab = 'chars';
  private grid?: Phaser.GameObjects.Container;
  private tabGfx?: Phaser.GameObjects.Graphics;
  private headName?: Phaser.GameObjects.Text;
  private headTag?: Phaser.GameObjects.Text;
  private modelSig = '';

  constructor() {
    super('outfit');
  }

  create() {
    const { width: W, height: H } = this.scale;
    const zoom = Math.min(W / VW, H / VH);
    this.cameras.main.setZoom(zoom).centerOn(VW / 2, VH / 2);
    this.heroMs = perfInterval();
    this.tab = 'chars';
    this.modelSig = '';

    // cyan field + rings — the wardrobe room (cooler than the lobby's yellow)
    this.cameras.main.setBackgroundColor(FG.cyan);
    fgRings(this, VW, VH, VW * 0.3, VH * 0.42, FG.cyan, 0x54cdf4);

    // top bar — the lobby's dark strip, flush to the top edge, no margin:
    // label at the left end, tab row centred in it
    const bar = this.add.graphics().setDepth(30);
    bar.fillStyle(FG.bar, 1).fillRect(-VW * 0.4, 0, VW * 1.8, 46);
    bar.lineStyle(2, 0x000000, 0.5).lineBetween(-VW * 0.4, 45, VW * 1.4, 45);
    this.add
      .text(16, 24, 'CUSTOMISE › OUTFITS', {
        fontFamily: FG_FONT,
        fontSize: '21px',
        fontStyle: 'italic',
        color: '#ffffff',
      })
      .setOrigin(0, 0.5)
      .setDepth(31);

    // ---- tab row — LB/RB bumpers flank two chamfered tabs ----
    this.buildTabs();

    // ---- podium + live bean (same pipeline as the lobby) ----
    const podX = 300,
      podTopY = 648;
    const pod = this.add.graphics().setDepth(2);
    pod.fillStyle(FG.podiumSide, 1).fillRect(podX - 170, podTopY, 340, VH - podTopY + 60);
    pod.fillStyle(FG.podiumTop, 1).fillEllipse(podX, podTopY, 340, 54);
    pod.fillStyle(0xffffff, 0.34).fillEllipse(podX, podTopY - 4, 288, 34);
    pod.lineStyle(4, FG.pinkDeep, 0.5).strokeEllipse(podX, podTopY, 340, 54);
    pod.fillStyle(FG.pinkDeep, 0.32).fillEllipse(podX, podTopY + 10, 124, 17);

    const ch = currentChar();
    this.modelSig = `${ch.shape ?? 'bean'}|${ch.gear ?? 'none'}|${ch.rage ? 'r' : ''}`;
    this.hero3d = new Hero3D(640, 700, 6.5, 1.3, 1.3, ch);
    this.hero3d.furQ = furQuality();
    if (this.hero3d.ok && this.hero3d.canvas) {
      this.hero3d.setVariant(ch.body, ch.skin);
      this.heroSrc = this.hero3d.canvas;
      const copy = document.createElement('canvas');
      copy.width = 640;
      copy.height = 700;
      this.heroCtx = copy.getContext('2d')!;
      if (this.textures.exists('outfit_hero')) this.textures.remove('outfit_hero');
      this.heroTex = this.textures.addCanvas('outfit_hero', copy) ?? undefined;
      this.heroImg = this.add
        .image(podX, podTopY - 240, 'outfit_hero')
        .setOrigin(0.5)
        .setDepth(3);
    }

    // ---- the swatch card ----
    const cg = this.add.graphics().setDepth(4);
    cg.fillStyle(0x0a0710, 0.5).fillRoundedRect(CARD.x + 6, CARD.y + 8, CARD.w, CARD.h, 18);
    cg.fillStyle(0xffffff, 1).fillRoundedRect(CARD.x - 2, CARD.y - 2, CARD.w + 4, CARD.h + 4, 18);
    cg.fillStyle(FG.cyan, 1).fillRoundedRect(CARD.x, CARD.y, CARD.w, CARD.h, 16);
    cg.fillStyle(0xffffff, 0.12).fillRoundedRect(CARD.x + 8, CARD.y + 6, CARD.w - 16, 34, 10);

    this.headName = this.add
      .text(CARD.x + 26, CARD.y + 34, '', {
        fontFamily: FG_FONT,
        fontSize: '24px',
        fontStyle: 'italic',
        color: '#ffffff',
      })
      .setOrigin(0, 0.5)
      .setDepth(6)
      .setShadow(0, 2, 'rgba(10,40,60,0.4)', 3);
    this.headTag = this.add
      .text(CARD.x + CARD.w - 26, CARD.y + 34, '', {
        fontFamily: FG_BODY,
        fontSize: '13px',
        fontStyle: '800',
        color: '#7cf7c4',
      })
      .setOrigin(1, 0.5)
      .setDepth(6);
    const div = this.add.graphics().setDepth(5);
    div.lineStyle(2, 0xffffff, 0.35).lineBetween(CARD.x + 20, CARD.y + 62, CARD.x + CARD.w - 20, CARD.y + 62);

    this.buildGrid();
    this.refreshHead();

    // footer — their Select/Confirm/Back row, our flavour
    this.add
      .text(34, VH - 30, '‹ › — browse   ·   Q/E — tabs   ·   esc — back', {
        fontFamily: FG_BODY,
        fontSize: '13px',
        fontStyle: '700',
        color: '#eef6ff',
      })
      .setDepth(5)
      .setAlpha(0.9);
    const dw = 130,
      dh = 42,
      dcx = VW - 100,
      dcy = VH - 44;
    const dg = this.add.graphics().setDepth(5);
    dg.fillStyle(0x0a0710, 1).fillRoundedRect(dcx - dw / 2, dcy - dh / 2 + 3, dw, dh, dh / 2);
    dg.fillStyle(0x17151f, 1).fillRoundedRect(dcx - dw / 2, dcy - dh / 2 - 4, dw, dh - 2, dh / 2);
    dg.fillStyle(0xffffff, 0.14).fillRoundedRect(dcx - dw / 2 + 7, dcy - dh / 2, dw - 14, 13, 7);
    this.add
      .text(dcx, dcy - 4, 'DONE', { fontFamily: FG_FONT, fontSize: '15px', color: '#f5efe0' })
      .setOrigin(0.5)
      .setDepth(6);
    this.add
      .zone(dcx - dw / 2, dcy - dh / 2 - 4, dw, dh + 4)
      .setOrigin(0, 0)
      .setDepth(6)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => this.back());

    // keys — esc/back, Q/E or arrows switch tabs, arrows browse the grid
    this.input.keyboard?.on('keydown-ESC', () => this.back());
    this.input.keyboard?.on('keydown-BACKSPACE', () => this.back());
    this.input.keyboard?.on('keydown-Q', () => this.setTab('chars'));
    this.input.keyboard?.on('keydown-E', () => this.setTab('coat'));

    this.cameras.main.fadeIn(200, 0x2b, 0xb8, 0xf0);
    this.events.once('shutdown', () => {
      this.hero3d?.dispose();
      this.hero3d = undefined;
      if (this.textures.exists('outfit_hero')) this.textures.remove('outfit_hero');
    });
  }

  private back() {
    this.cameras.main.fadeOut(160, 0x2b, 0xb8, 0xf0);
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () =>
      this.scene.start('title'),
    );
  }

  // ---- tabs: two chamfered pills between LB/RB bumpers ----
  private buildTabs() {
    const cx = VW / 2;
    const bump = (x: number, t: string) =>
      this.add
        .text(x, 24, t, { fontFamily: FG_BODY, fontSize: '13px', fontStyle: '800', color: '#8a8a99' })
        .setOrigin(0.5)
        .setDepth(31);
    bump(cx - 218, 'LB');
    bump(cx + 218, 'RB');
    this.tabGfx = this.add.graphics().setDepth(31);
    const tabs: { t: Tab; label: string; w: number }[] = [
      { t: 'chars', label: 'CHARACTERS', w: 172 },
      { t: 'coat', label: 'COLOUR', w: 140 },
    ];
    let x = cx - (172 + 8 + 140) / 2;
    for (const tb of tabs) {
      const bx = x;
      this.add
        .text(bx + tb.w / 2, 24, tb.label, {
          fontFamily: FG_FONT,
          fontSize: '15px',
          fontStyle: 'italic',
          color: '#ffffff',
        })
        .setOrigin(0.5)
        .setDepth(31)
        .setData('tab', tb.t);
      this.add
        .zone(bx, 5, tb.w, 36)
        .setOrigin(0, 0)
        .setDepth(32)
        .setInteractive({ useHandCursor: true })
        .on('pointerdown', () => this.setTab(tb.t));
      x += tb.w + 8;
    }
    this.drawTabs();
  }

  private drawTabs() {
    const g = this.tabGfx;
    if (!g) return;
    g.clear();
    const cx = VW / 2;
    const defs: { t: Tab; w: number }[] = [
      { t: 'chars', w: 172 },
      { t: 'coat', w: 140 },
    ];
    let x = cx - (172 + 8 + 140) / 2;
    defs.forEach((d, i) => {
      const on = this.tab === d.t;
      const cham = 7;
      const pts = [
        { x: i === 0 ? x + cham : x, y: 5 },
        { x: x + d.w, y: 5 },
        { x: i === defs.length - 1 ? x + d.w - cham : x + d.w, y: 41 },
        { x, y: 41 },
      ];
      g.fillStyle(on ? 0x9c2160 : 0x1d8fc4, 1).fillPoints(
        pts.map((p) => ({ x: p.x, y: p.y + 2 })),
        true,
      );
      g.fillStyle(on ? FG.pink : FG.cyan, 1).fillPoints(pts, true);
      g.lineStyle(2.5, 0xffffff, 0.9).strokePoints(pts, true);
      x += d.w + 8;
    });
  }

  private setTab(t: Tab) {
    if (this.tab === t) return;
    this.tab = t;
    sfx.pickup();
    this.drawTabs();
    this.buildGrid();
    this.refreshHead();
  }

  /** strip labels shrink-wrap: 'OONI OF IFE' fits at 10px,
   *  'AMANYANABO OF PORT HARCOURT' wraps two lines at 7px */
  private fitLabel(t: Phaser.GameObjects.Text, text: string) {
    t.setText(text);
    const len = text.length;
    t.setFontSize(len <= 13 ? 10 : len <= 20 ? 8 : 7);
    t.setWordWrapWidth(TILE - 16, true).setLineSpacing(len > 20 ? -2 : 0);
  }

  private refreshHead() {
    const ch = currentChar();
    // podium convention — name on the left, the champion's title tagged right
    this.headName?.setText((playerName() || ch.name || 'RUNNER').toUpperCase().slice(0, 10));
    this.headTag?.setText(this.tab === 'coat' ? 'COLOUR' : charTitleShort(ch) || 'RUNNER');
  }

  // ---- tile helpers ----

  /** mini bean portrait — body ellipse + face oval + eyes + gear glyph */
  private drawMiniBean(g: Phaser.GameObjects.Graphics, cx: number, cy: number, def: CharDef) {
    const shX = def.shape === 'round' ? 1.2 : def.shape === 'tall' ? 0.82 : 1;
    const shY = def.shape === 'round' ? 0.92 : def.shape === 'tall' ? 1.08 : 1;
    g.fillStyle(0x0a0710, 0.25).fillEllipse(cx + 2, cy + 4, 46 * shX, 52 * shY);
    g.fillStyle(def.body, 1).fillEllipse(cx, cy, 46 * shX, 52 * shY);
    g.fillStyle(def.skin, 1).fillEllipse(cx, cy - 8 * shY, 20 * shX, 16 * shY);
    g.fillStyle(0x0c0c0c, 1);
    g.fillEllipse(cx - 4, cy - 8 * shY, 3.5, 5);
    g.fillEllipse(cx + 4, cy - 8 * shY, 3.5, 5);
    // head gear — tiny glyphs on the bean's crown
    const gy = cy - 8 * shY - 12 * shY;
    switch (def.gear) {
      case 'band':
        g.fillStyle(0xffffff, 1).fillRect(cx - 15 * shX, gy - 2, 30 * shX, 5);
        break;
      case 'cap':
        g.fillStyle(0xe84848, 1).fillEllipse(cx, gy + 2, 26 * shX, 12);
        g.fillStyle(0xb03030, 1).fillRect(cx - 18 * shX, gy + 4, 36 * shX, 4);
        break;
      case 'hardhat':
        g.fillStyle(0xf2b81c, 1).fillEllipse(cx, gy + 1, 26 * shX, 13);
        g.fillStyle(0xd99f0e, 1).fillRect(cx - 19 * shX, gy + 5, 38 * shX, 4);
        break;
      case 'spikes':
        g.fillStyle(0xecc98e, 1);
        for (let i = -1; i <= 1; i++)
          g.fillTriangle(cx + i * 9 * shX - 5, gy + 8, cx + i * 9 * shX, gy - 7, cx + i * 9 * shX + 5, gy + 8);
        break;
      case 'crown':
        g.fillStyle(0xffc93c, 1);
        g.fillRect(cx - 12, gy + 2, 24, 6);
        for (let i = -1; i <= 1; i++)
          g.fillTriangle(cx + i * 9 - 5, gy + 2, cx + i * 9, gy - 8, cx + i * 9 + 5, gy + 2);
        break;
    }
  }

  /** a locked runner — greyed portrait behind a padlock, milestone tells
   *  which champion to beat. No pointer zone: it can't be picked. */
  private lockedTile(gx: number, gy: number, def: CharDef) {
    const g = this.add.graphics();
    g.fillStyle(0x0a0710, 0.3).fillRoundedRect(gx + 3, gy + 4, TILE, TILE, 12);
    g.fillStyle(0x6fa8bd, 1).fillRoundedRect(gx, gy, TILE, TILE, 12);
    this.drawMiniBean(g, gx + TILE / 2, gy + TILE / 2 - 8, def);
    g.fillStyle(0x0a2030, 0.55).fillRoundedRect(gx, gy, TILE, TILE, 12); // veil
    // padlock — shackle + body, drawn not emoji'd
    const lx = gx + TILE / 2,
      ly = gy + TILE / 2 - 10;
    g.lineStyle(4, 0xffffff, 0.9).strokeCircle(lx, ly - 8, 8);
    g.fillStyle(0xffffff, 0.95).fillRoundedRect(lx - 11, ly - 9, 22, 19, 5);
    g.fillStyle(0x0a2030, 1).fillCircle(lx, ly - 1, 3).fillRect(lx - 1.5, ly, 3, 6);
    g.fillStyle(0x0a0710, 0.4).fillRoundedRect(gx + 6, gy + TILE - 26, TILE - 12, 20, 6);
    const hint = this.add
      .text(lx, ly + 24, `MILESTONE ${def.unlockAt}`, {
        fontFamily: FG_BODY,
        fontSize: '9px',
        fontStyle: '800',
        color: '#cfe8f5',
      })
      .setOrigin(0.5);
    const name = this.add
      .text(gx + TILE / 2, gy + TILE - 16, '', {
        fontFamily: FG_BODY,
        fontSize: '10px',
        fontStyle: '800',
        color: '#ffffff',
        align: 'center',
      })
      .setOrigin(0.5)
      .setAlpha(0.65);
    this.fitLabel(name, charTitle(def)); // the boss's name in full — BAALE OF SURULERE
    this.grid!.add([g, hint, name]);
  }

  /** swatch tile frame — rim, hover ring, equipped check */
  private tile(
    gx: number,
    gy: number,
    label: string,
    equipped: boolean,
    draw: (g: Phaser.GameObjects.Graphics) => void,
    onPick: () => void,
  ) {
    const g = this.add.graphics();
    const paint = (hover: boolean) => {
      g.clear();
      g.fillStyle(0x0a0710, 0.3).fillRoundedRect(gx + 3, gy + 4, TILE, TILE, 12);
      g.fillStyle(0x9fdcf2, 1).fillRoundedRect(gx, gy, TILE, TILE, 12);
      draw(g);
      if (hover || equipped) {
        g.lineStyle(hover ? 3.5 : 4.5, 0xffffff, 1).strokeRoundedRect(gx + 1, gy + 1, TILE - 2, TILE - 2, 11);
      }
      if (equipped) {
        const ex = gx + TILE - 14,
          ey = gy + 14;
        g.fillStyle(0x2fd48c, 1).fillCircle(ex, ey, 9);
        g.lineStyle(2.5, 0xffffff, 1).strokeCircle(ex, ey, 9);
        g.lineStyle(2.5, 0xffffff, 1);
        g.beginPath();
        g.moveTo(ex - 4, ey);
        g.lineTo(ex - 1, ey + 3.5);
        g.lineTo(ex + 5, ey - 3.5);
        g.stroke();
      }
      // name strip at the tile's foot
      g.fillStyle(0x0a0710, 0.4).fillRoundedRect(gx + 6, gy + TILE - 26, TILE - 12, 20, 6);
    };
    paint(false);
    const name = this.add
      .text(gx + TILE / 2, gy + TILE - 16, '', {
        fontFamily: FG_BODY,
        fontSize: '10px',
        fontStyle: '800',
        color: '#ffffff',
        align: 'center',
      })
      .setOrigin(0.5);
    this.fitLabel(name, label);
    const z = this.add
      .zone(gx, gy, TILE, TILE)
      .setOrigin(0, 0)
      .setInteractive({ useHandCursor: true });
    z.on('pointerover', () => paint(true));
    z.on('pointerout', () => paint(false));
    z.on('pointerdown', () => {
      onPick();
      sfx.pickup();
      this.hero3d?.poke();
      this.buildGrid(); // re-mark equipped + rings
      this.refreshHead();
    });
    this.grid!.add([g, name, z]);
  }

  private buildGrid() {
    this.grid?.destroy(true);
    this.grid = this.add.container(0, 0).setDepth(5);
    const pick = currentPick();
    const ch = currentChar();

    if (this.tab === 'chars') {
      CHARACTERS.forEach((def, i) => {
        const gx = GRID_X + (i % COLS) * (TILE + TILE_GAP);
        const gy = GRID_Y + Math.floor(i / COLS) * (TILE + TILE_GAP);
        if (!charUnlocked(def)) return this.lockedTile(gx, gy, def);
        this.tile(
          gx,
          gy,
          def.unlockAt ? charTitle(def) : runnerName(def), // champs: full title — the hero: your name
          def.id === ch.id,
          (g) => this.drawMiniBean(g, gx + TILE / 2, gy + TILE / 2 - 8, def),
          () => this.pickChar(def),
        );
      });
    } else {
      // AUTO clears the override — the character's own coat
      this.tile(
        GRID_X,
        GRID_Y,
        'AUTO',
        pick.body === undefined,
        (g) => {
          g.fillStyle(ch.body, 1).fillTriangle(GRID_X, GRID_Y, GRID_X, GRID_Y + TILE, GRID_X + TILE, GRID_Y + TILE);
          g.fillStyle(ch.skin, 1).fillTriangle(GRID_X, GRID_Y, GRID_X + TILE, GRID_Y, GRID_X + TILE, GRID_Y + TILE);
        },
        () => this.pickCoat(null),
      );
      COATS.forEach((coat, i) => {
        const k = i + 1;
        const gx = GRID_X + (k % COLS) * (TILE + TILE_GAP);
        const gy = GRID_Y + Math.floor(k / COLS) * (TILE + TILE_GAP);
        this.tile(
          gx,
          gy,
          coat.name,
          pick.body === coat.body,
          (g) => {
            g.fillStyle(coat.body, 1).fillTriangle(gx, gy, gx, gy + TILE, gx + TILE, gy + TILE);
            g.fillStyle(ch.skin, 1).fillTriangle(gx, gy, gx + TILE, gy, gx + TILE, gy + TILE);
          },
          () => this.pickCoat(coat.body),
        );
      });
    }
  }

  private pickChar(def: CharDef) {
    setChar(def.id); // keeps the coat paint
    const ch = currentChar();
    const sig = `${ch.shape ?? 'bean'}|${ch.gear ?? 'none'}|${ch.rage ? 'r' : ''}`;
    if (sig !== this.modelSig) {
      // shape/gear is mesh-level — rebuild the rig like the lobby's picker
      this.modelSig = sig;
      this.hero3d?.dispose();
      this.hero3d = new Hero3D(640, 700, 6.5, 1.3, 1.3, ch);
      this.hero3d.furQ = furQuality();
      this.heroSrc = this.hero3d.ok ? this.hero3d.canvas : undefined;
    }
    this.hero3d?.setVariant(ch.body, ch.skin);
  }

  private pickCoat(body: number | null) {
    setChar(currentChar().id, body);
    const ch = currentChar();
    this.hero3d?.setVariant(ch.body, ch.skin); // repaint — no rebuild needed
  }

  update() {
    const p = this.input.activePointer;
    if (this.hero3d && p && (p.x !== 0 || p.y !== 0)) {
      this.hero3d.setGaze(
        (p.x - this.scale.width / 2) / (this.scale.width / 2),
        (p.y - this.scale.height / 2) / (this.scale.height / 2),
      );
    }
    // fur composite at the Bean FPS pick — same throttle as every scene
    if (this.time.now - this.heroLastT < this.heroMs) return;
    this.heroLastT = this.time.now;
    this.hero3d?.update(this.time.now);
    if (this.heroSrc && this.heroCtx && this.heroTex) {
      this.heroCtx.clearRect(0, 0, 640, 700);
      this.heroCtx.drawImage(this.heroSrc, 0, 0);
      if (this.heroImg && !REDUCED_MOTION) {
        const lx = p ? p.worldX - this.heroImg.x + 320 : -1;
        const ly = p ? p.worldY - this.heroImg.y + 350 : -1;
        this.hero3d?.drawFur(this.heroCtx, lx, ly);
      }
      this.heroTex.refresh();
    }
  }
}
