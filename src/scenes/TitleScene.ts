import Phaser from 'phaser';
import { CONFIG } from '../config';
import { makeTextures } from '../art';
import { Sfx } from '../audio';
import { DISPLAY_FONT, UI_FONT, UI, keyChip, panel } from '../ui';
import { loadStats, loadPicks, savePicks, DIFFS, Mode, Difficulty, JoyMode } from '../meta';
import { TouchControls } from '../mobile';

const sfx = Sfx.inst;

const MODES: { id: Mode; title: string; sub: string }[] = [
  { id: 'ice', title: 'ICE & WATER', sub: 'tagged = frozen · touch to thaw' },
  { id: 'police', title: 'POLICE & THIEF', sub: 'caught = jailed · break them out' },
];
const DIFF_ORDER: Difficulty[] = ['easy', 'normal', 'hard'];
const JOY_ORDER: JoyMode[] = ['floating', 'sticky'];
const JOY_LABEL: Record<JoyMode, string> = { floating: 'FLOATING', sticky: 'STICKY' };

export class TitleScene extends Phaser.Scene {
  private mode: Mode = 'ice';
  private diff: Difficulty = 'normal';
  private joy: JoyMode = 'floating';
  private modeBorders: Phaser.GameObjects.Graphics[] = [];
  private diffChips: Phaser.GameObjects.Container[] = [];
  private joyChips: Phaser.GameObjects.Container[] = [];

  constructor() {
    super('title');
  }

  create() {
    const { width, height } = this.scale;
    makeTextures(this);
    const picks = loadPicks();
    this.mode = picks.mode;
    this.diff = picks.difficulty;
    this.joy = picks.joy;
    this.modeBorders = [];
    this.diffChips = [];
    this.joyChips = [];

    this.cameras.main.setBackgroundColor(UI.bg);
    this.cameras.main.fadeIn(350, 0, 0, 0);

    // ambient floating drops
    for (let i = 0; i < 14; i++) {
      const drop = this.add
        .sprite(Phaser.Math.Between(20, width - 20), Phaser.Math.Between(20, height - 20), 'dot')
        .setTint(i % 3 === 0 ? UI.ice : UI.water)
        .setAlpha(Phaser.Math.FloatBetween(0.06, 0.22))
        .setScale(Phaser.Math.FloatBetween(0.6, 1.8))
        .setDepth(0);
      this.tweens.add({
        targets: drop,
        y: drop.y - Phaser.Math.Between(18, 46),
        duration: Phaser.Math.Between(1600, 3200),
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      });
    }

    // ------- animated logo -------
    const logoY = height * 0.17;
    const parts: { text: string; color: string; size: number }[] = [
      { text: 'ICE', color: '#7fd8f0', size: 72 },
      { text: "'N'", color: '#f5efe0', size: 40 },
      { text: 'WATER', color: '#4dd0e1', size: 72 },
    ];
    const letters: Phaser.GameObjects.Text[] = [];
    let cursor = 0;
    for (const part of parts) {
      for (const ch of part.text) {
        const t = this.add
          .text(0, logoY, ch, {
            fontFamily: DISPLAY_FONT,
            fontSize: `${part.size}px`,
            color: part.color,
            stroke: '#081420',
            strokeThickness: 8,
          })
          .setOrigin(0.5)
          .setDepth(5);
        letters.push(t);
        cursor += t.width * 0.92;
      }
      cursor += part.size * 0.45;
    }
    let x = (width - cursor) / 2;
    letters.forEach((t, i) => {
      x += t.width * 0.46;
      const homeX = x;
      t.setPosition(homeX, logoY - 120).setAlpha(0).setAngle(Phaser.Math.Between(-14, 14));
      this.tweens.add({
        targets: t,
        y: logoY,
        alpha: 1,
        angle: 0,
        delay: 120 + i * 50,
        duration: 500,
        ease: 'Back.easeOut',
        onComplete: () => {
          this.tweens.add({
            targets: t,
            y: logoY - 6,
            duration: 900,
            delay: i * 70,
            yoyo: true,
            repeat: -1,
            ease: 'Sine.easeInOut',
          });
        },
      });
      x += t.width * 0.46 + 2;
    });

    this.add
      .text(width / 2, logoY + 66, 'the playground chase game', {
        fontFamily: UI_FONT,
        fontSize: '17px',
        fontStyle: '500',
        color: '#b7a98c',
      })
      .setOrigin(0.5);

    // leaderboard shortcut — opens the board straight from the road map
    const board = this.add
      .text(width - 16, 16, 'LEADERBOARD', {
        fontFamily: DISPLAY_FONT,
        fontSize: '15px',
        color: '#ffd54a',
      })
      .setOrigin(1, 0)
      .setDepth(6)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => {
        sfx.ensure();
        sfx.pickup();
        this.scene.start('adventure', { board: true });
      });
    board
      .on('pointerover', () => board.setColor('#f5efe0'))
      .on('pointerout', () => board.setColor('#ffd54a'));

    // ------- mode cards -------
    const cardW = 330;
    const cardH = 104;
    const gap = 36;
    const cardY = height * 0.4;
    MODES.forEach((m, i) => {
      const cx = width / 2 + (i - 0.5) * (cardW + gap);
      panel(this, cx - cardW / 2, cardY, cardW, cardH, { alpha: 0.55, depth: 4 });
      const border = this.add.graphics().setDepth(6);
      border.lineStyle(3, UI.ice, 1);
      border.strokeRoundedRect(cx - cardW / 2 + 2, cardY + 2, cardW - 4, cardH - 4, 10);
      this.modeBorders.push(border);

      this.add
        .text(cx, cardY + 36, m.title, {
          fontFamily: DISPLAY_FONT,
          fontSize: '24px',
          color: '#f5efe0',
        })
        .setOrigin(0.5)
        .setDepth(5);
      this.add
        .text(cx, cardY + 70, m.sub, {
          fontFamily: UI_FONT,
          fontSize: '14px',
          fontStyle: '500',
          color: '#9db4c4',
        })
        .setOrigin(0.5)
        .setDepth(5);

      this.add
        .zone(cx - cardW / 2, cardY, cardW, cardH)
        .setOrigin(0, 0)
        .setInteractive({ useHandCursor: true })
        .on('pointerdown', () => {
          this.mode = m.id;
          this.refreshPicks();
        });
    });

    // ------- difficulty chips -------
    this.add
      .text(width / 2, cardY + cardH + 26, 'DIFFICULTY', {
        fontFamily: UI_FONT,
        fontSize: '13px',
        fontStyle: '600',
        color: '#7d93a5',
      })
      .setOrigin(0.5);
    const chipY = cardY + cardH + 44;
    const chipW = 120;
    DIFF_ORDER.forEach((d, i) => {
      const cx = width / 2 + (i - 1) * (chipW + 14);
      const g = this.add.graphics();
      g.fillStyle(0x12293f, 0.8);
      g.fillRoundedRect(0, 0, chipW, 34, 17);
      const txt = this.add
        .text(chipW / 2, 17, DIFFS[d].label, {
          fontFamily: UI_FONT,
          fontSize: '15px',
          fontStyle: '600',
          color: '#9db4c4',
        })
        .setOrigin(0.5);
      const c = this.add.container(cx - chipW / 2, chipY, [g, txt]).setDepth(5);
      this.diffChips.push(c);
      this.add
        .zone(cx - chipW / 2, chipY, chipW, 34)
        .setOrigin(0, 0)
        .setInteractive({ useHandCursor: true })
        .on('pointerdown', () => {
          this.diff = d;
          this.refreshPicks();
        });
    });

    // ------- big actions: adventure journey + online -------
    const onlineY = chipY + 52;
    const bw = 250;
    const bgap = 14;
    const makeBigBtn = (
      x: number,
      label: string,
      sub: string,
      fill: number,
      edge: number,
      go: () => void,
    ) => {
      const g = this.add.graphics().setDepth(4);
      g.fillStyle(fill, 1);
      g.fillRoundedRect(x, onlineY, bw, 46, 12);
      g.lineStyle(2, edge, 0.7);
      g.strokeRoundedRect(x + 1, onlineY + 1, bw - 2, 44, 12);
      this.add
        .text(x + bw / 2, onlineY + 16, label, {
          fontFamily: DISPLAY_FONT,
          fontSize: '16px',
          color: '#f5efe0',
        })
        .setOrigin(0.5)
        .setDepth(5);
      this.add
        .text(x + bw / 2, onlineY + 34, sub, {
          fontFamily: UI_FONT,
          fontSize: '11px',
          color: '#b7c8d4',
        })
        .setOrigin(0.5)
        .setDepth(5);
      this.add
        .zone(x, onlineY, bw, 46)
        .setOrigin(0, 0)
        .setInteractive({ useHandCursor: true })
        .on('pointerdown', go);
    };
    const bx = width / 2 - bw - bgap / 2;
    makeBigBtn(bx, 'ADVENTURE', 'the road north — 500 levels', 0x2a5c3f, 0x4ecb71, () => {
      sfx.ensure();
      sfx.pickup();
      this.cameras.main.fadeOut(220, 0, 0, 0);
      this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () =>
        this.scene.start('adventure'),
      );
    });
    makeBigBtn(bx + bw + bgap, 'PLAY ONLINE', 'up to 10 friends', 0x1d4a66, 0x4dd0e1, () => {
      sfx.ensure();
      sfx.pickup();
      this.cameras.main.fadeOut(220, 0, 0, 0);
      this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () =>
        this.scene.start('lobby'),
      );
    });

    // ------- stats line -------
    const s = loadStats();
    this.add
      .text(
        width / 2,
        chipY + 116,
        s.games > 0
          ? `WINS ${s.wins}   ·   BEST ${s.bestSurvived}s   ·   STREAK ${s.streak}`
          : 'first round? good luck out there',
        { fontFamily: UI_FONT, fontSize: '14px', fontStyle: '500', color: '#7d93a5' },
      )
      .setOrigin(0.5);

    // ------- press to play + controls -------
    const isTouch = TouchControls.isTouchDevice();
    const press = this.add
      .text(width / 2, height * 0.79, isTouch ? 'TAP TO PLAY' : 'PRESS SPACE TO PLAY', {
        fontFamily: DISPLAY_FONT,
        fontSize: '26px',
        color: '#f5efe0',
        stroke: '#081420',
        strokeThickness: 6,
      })
      .setOrigin(0.5)
      .setDepth(5);
    this.tweens.add({
      targets: press,
      scale: 1.07,
      alpha: 0.6,
      duration: 620,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });

    const chipY2 = height * 0.87;
    if (isTouch) {
      // thumbstick style — floating spawns under your thumb, sticky stays put
      this.add
        .text(width / 2 - 80, chipY2 + 2, 'THUMBSTICK', {
          fontFamily: UI_FONT,
          fontSize: '13px',
          fontStyle: '600',
          color: '#7d93a5',
        })
        .setOrigin(1, 0.5);
      JOY_ORDER.forEach((j, i) => {
        const cw = 116;
        const cx = width / 2 - 60 + i * (cw + 12);
        const g = this.add.graphics();
        g.fillStyle(0x12293f, 0.8);
        g.fillRoundedRect(0, 0, cw, 30, 15);
        const txt = this.add
          .text(cw / 2, 15, JOY_LABEL[j], {
            fontFamily: UI_FONT,
            fontSize: '14px',
            fontStyle: '600',
            color: '#9db4c4',
          })
          .setOrigin(0.5);
        const c = this.add.container(cx, chipY2 - 13, [g, txt]).setDepth(5);
        this.joyChips.push(c);
        this.add
          .zone(cx, chipY2 - 13, cw, 30)
          .setOrigin(0, 0)
          .setInteractive({ useHandCursor: true })
          .on('pointerdown', () => {
            this.joy = j;
            this.refreshPicks();
          });
      });
      this.add
        .text(
          width / 2,
          chipY2 + 36,
          'left thumb — move  ·  RUN — sprint  ·  H₂O — use item',
          { fontFamily: UI_FONT, fontSize: '14px', color: '#7d93a5' },
        )
        .setOrigin(0.5);
    } else {
      const chips = [
        { chip: '◄ ▲ ▼ ►', label: 'move / select' },
        { chip: 'SHIFT', label: 'sprint' },
        { chip: 'E', label: 'pure water' },
      ];
      const chipObjs = chips.map((c) => keyChip(this, 0, 0, c.chip));
      let cx2 = width / 2 - (chipObjs.reduce((a, c) => a + c.width + 96, 0) - 96 + 16) / 2;
      chips.forEach((c, i) => {
        chipObjs[i].container.setPosition(cx2, chipY2);
        this.add
          .text(cx2 + chipObjs[i].width + 8, chipY2 + 16, c.label, {
            fontFamily: UI_FONT,
            fontSize: '14px',
            color: '#7d93a5',
          })
          .setOrigin(0, 0.5);
        cx2 += chipObjs[i].width + 96;
      });
    }

    this.refreshPicks();

    // ------- input -------
    const start = () => {
      sfx.ensure();
      sfx.shortWhistle();
      savePicks(this.mode, this.diff, this.joy);
      this.cameras.main.fadeOut(220, 0, 0, 0);
      this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () =>
        this.scene.start('game', { mode: this.mode, difficulty: this.diff }),
      );
    };
    this.input.keyboard!.on('keydown-SPACE', start);
    this.input.keyboard!.on('keydown-LEFT', () => {
      this.mode = 'ice';
      this.refreshPicks();
    });
    this.input.keyboard!.on('keydown-RIGHT', () => {
      this.mode = 'police';
      this.refreshPicks();
    });
    this.input.keyboard!.on('keydown-UP', () => this.cycleDiff(-1));
    this.input.keyboard!.on('keydown-DOWN', () => this.cycleDiff(1));
    this.input.keyboard!.on('keydown-ENTER', start);
    press.setInteractive({ useHandCursor: true }).on('pointerdown', start);
  }

  private cycleDiff(step: number) {
    const i = DIFF_ORDER.indexOf(this.diff);
    this.diff = DIFF_ORDER[(i + step + DIFF_ORDER.length) % DIFF_ORDER.length];
    this.refreshPicks();
  }

  private refreshPicks() {
    MODES.forEach((m, i) => {
      const selected = m.id === this.mode;
      this.modeBorders[i].setVisible(selected);
      this.modeBorders[i].setAlpha(selected ? 1 : 0);
      this.tweens.add({
        targets: this.modeBorders[i],
        alpha: selected ? 1 : 0,
        duration: 150,
      });
    });
    DIFF_ORDER.forEach((d, i) => {
      const selected = d === this.diff;
      const chip = this.diffChips[i];
      const txt = chip.list[1] as Phaser.GameObjects.Text;
      txt.setColor(selected ? '#7fd8f0' : '#9db4c4');
      this.tweens.add({ targets: chip, scale: selected ? 1.12 : 1, duration: 140 });
    });
    JOY_ORDER.forEach((j, i) => {
      const selected = j === this.joy;
      const chip = this.joyChips[i];
      if (!chip) return;
      const txt = chip.list[1] as Phaser.GameObjects.Text;
      txt.setColor(selected ? '#7fd8f0' : '#9db4c4');
      this.tweens.add({ targets: chip, scale: selected ? 1.12 : 1, duration: 140 });
    });
  }
}
