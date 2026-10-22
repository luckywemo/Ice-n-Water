import Phaser from 'phaser';
import { Client, Room } from 'colyseus.js';
import { CONFIG } from '../config';
import { SERVER_URL } from '../net';
import { DISPLAY_FONT, UI_FONT, UI, panel } from '../ui';
import { makeTextures } from '../art';
import { loadPicks } from '../meta';

type LobbyPlayer = {
  name: string;
  ready: boolean;
  team: string;
};

type LobbyStateShape = {
  mode: string;
  phase: string;
  host: string;
  players: Map<string, LobbyPlayer>;
};

/** Online lobby — create or join a room, ready up, host starts the match. */
export class LobbyScene extends Phaser.Scene {
  private client = new Client(SERVER_URL);
  private room: Room<LobbyStateShape> | null = null;
  private lobbyMode: 'infection' | 'rounds' = 'infection';

  private statusText!: Phaser.GameObjects.Text;
  private codeText!: Phaser.GameObjects.Text;
  private listText!: Phaser.GameObjects.Text;
  private hintText!: Phaser.GameObjects.Text;
  private nameInput: HTMLInputElement | null = null;
  private codeInput: HTMLInputElement | null = null;
  private readyBtn!: Phaser.GameObjects.Container;
  private startBtn!: Phaser.GameObjects.Container;
  private lobbyPhase: 'menu' | 'in-room' = 'menu';

  constructor() {
    super('lobby');
  }

  create() {
    const { width, height } = this.scale;
    makeTextures(this);
    this.room = null;
    this.lobbyPhase = 'menu';
    this.cameras.main.setBackgroundColor(UI.bg);
    this.cameras.main.fadeIn(300, 0, 0, 0);

    this.add
      .text(width / 2, 60, 'ONLINE', {
        fontFamily: DISPLAY_FONT,
        fontSize: '54px',
        color: '#7fd8f0',
        stroke: '#081420',
        strokeThickness: 8,
      })
      .setOrigin(0.5);
    this.add
      .text(width / 2, 110, 'up to 10 players · police vs thieves', {
        fontFamily: UI_FONT,
        fontSize: '16px',
        fontStyle: '500',
        color: '#9db4c4',
      })
      .setOrigin(0.5);

    // name + room code inputs (DOM elements over the canvas)
    this.nameInput = this.makeInput(width / 2 - 140, 150, 'your name', 12);
    this.codeInput = this.makeInput(width / 2 + 20, 150, '4-digit code', 4);
    const savedName = localStorage.getItem('icenwater_name');
    if (savedName) this.nameInput.value = savedName;

    // mode picker (for room creation)
    this.add
      .text(width / 2, 215, 'RULESET', {
        fontFamily: UI_FONT,
        fontSize: '13px',
        fontStyle: '600',
        color: '#7d93a5',
      })
      .setOrigin(0.5);
    const modes: { id: 'infection' | 'rounds'; label: string }[] = [
      { id: 'infection', label: 'INFECTION — caught thieves join police' },
      { id: 'rounds', label: 'ROUNDS — 5v5, caught all → swap sides' },
    ];
    modes.forEach((m, i) => {
      const y = 236 + i * 34;
      const lbl = this.add
        .text(width / 2, y, m.label, {
          fontFamily: UI_FONT,
          fontSize: '15px',
          fontStyle: '600',
          color: '#9db4c4',
        })
        .setOrigin(0.5)
        .setInteractive({ useHandCursor: true })
        .on('pointerdown', () => {
          this.lobbyMode = m.id;
          modes.forEach((mm, j) =>
            (
              this.children.getByName(`mode${j}`) as Phaser.GameObjects.Text
            )?.setColor(mm.id === this.lobbyMode ? '#7fd8f0' : '#9db4c4'),
          );
        });
      lbl.setName(`mode${i}`);
    });
    (this.children.getByName('mode0') as Phaser.GameObjects.Text)?.setColor('#7fd8f0');

    // buttons
    this.makeButton(width / 2 - 150, 320, 'CREATE ROOM', () => this.createRoom());
    this.makeButton(width / 2 + 150, 320, 'JOIN ROOM', () => this.joinRoom());
    this.makeButton(width / 2, 372, 'BACK', () => this.scene.start('title'), 0x2b3f55);

    // in-room panel (hidden until joined)
    panel(this, width / 2 - 300, 400, 600, 300, { alpha: 0.5, depth: 4 });
    this.codeText = this.add
      .text(width / 2, 420, '', {
        fontFamily: DISPLAY_FONT,
        fontSize: '26px',
        color: '#7fd8f0',
      })
      .setOrigin(0.5)
      .setDepth(6);
    this.listText = this.add
      .text(width / 2 - 260, 455, '', {
        fontFamily: UI_FONT,
        fontSize: '16px',
        fontStyle: '500',
        color: '#d8e6ee',
        lineSpacing: 7,
      })
      .setDepth(6);
    this.hintText = this.add
      .text(width / 2, 694, '', {
        fontFamily: UI_FONT,
        fontSize: '14px',
        color: '#9db4c4',
      })
      .setOrigin(0.5)
      .setDepth(6);

    // in-room action buttons — keyboard still works, these are for touch & clarity
    this.readyBtn = this.actionButton(width / 2 - 115, 648, 'READY', () =>
      this.room?.send('ready'),
    );
    this.startBtn = this.actionButton(
      width / 2 + 115,
      648,
      'START',
      () => this.room?.send('start'),
      0x2e7d32,
    );
    this.readyBtn.setVisible(false);
    this.startBtn.setVisible(false);

    this.statusText = this.add
      .text(width / 2, 715, '', {
        fontFamily: UI_FONT,
        fontSize: '14px',
        color: '#ff8a80',
      })
      .setOrigin(0.5)
      .setDepth(6);

    this.add
      .text(width / 2, height - 18, 'esc — back', {
        fontFamily: UI_FONT,
        fontSize: '13px',
        color: '#5a7184',
      })
      .setOrigin(0.5, 1);
    this.input.keyboard!.on('keydown-ESC', () => this.leave());
  }

  private makeInput(x: number, y: number, placeholder: string, maxLen: number): HTMLInputElement {
    const el = document.createElement('input');
    el.placeholder = placeholder;
    el.maxLength = maxLen;
    el.style.cssText = `width:110px;padding:8px 10px;border-radius:8px;border:2px solid #4dd0e1;
      background:#12293f;color:#f5efe0;font-family:${UI_FONT};font-size:15px;outline:none;text-align:center;`;
    this.add.dom(x, y, el).setOrigin(0, 0);
    return el;
  }

  private makeButton(
    cx: number,
    y: number,
    label: string,
    onClick: () => void,
    color = 0x1d4a66,
  ) {
    const w = 220;
    const g = this.add.graphics();
    g.fillStyle(color, 1);
    g.fillRoundedRect(cx - w / 2, y, w, 40, 10);
    g.lineStyle(2, 0x7fd8f0, 0.4);
    g.strokeRoundedRect(cx - w / 2 + 1, y + 1, w - 2, 38, 10);
    const t = this.add
      .text(cx, y + 20, label, {
        fontFamily: DISPLAY_FONT,
        fontSize: '16px',
        color: '#f5efe0',
      })
      .setOrigin(0.5);
    this.add
      .zone(cx - w / 2, y, w, 40)
      .setOrigin(0, 0)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', onClick);
    return { g, t };
  }

  /** Small tappable button used inside the in-room panel. */
  private actionButton(
    cx: number,
    y: number,
    label: string,
    onClick: () => void,
    color = 0x1d4a66,
  ): Phaser.GameObjects.Container {
    const w = 200;
    const h = 38;
    const g = this.add.graphics();
    g.fillStyle(color, 1);
    g.fillRoundedRect(0, 0, w, h, 10);
    g.lineStyle(2, 0x7fd8f0, 0.4);
    g.strokeRoundedRect(1, 1, w - 2, h - 2, 10);
    const t = this.add
      .text(w / 2, h / 2, label, {
        fontFamily: DISPLAY_FONT,
        fontSize: '15px',
        color: '#f5efe0',
      })
      .setOrigin(0.5);
    const c = this.add.container(cx - w / 2, y, [g, t]).setDepth(7);
    c.setSize(w, h);
    c.setInteractive({ useHandCursor: true });
    c.on('pointerdown', onClick);
    return c;
  }

  private myName(): string {
    const n = (this.nameInput?.value ?? '').trim().slice(0, 12);
    const name = n || `player-${Math.floor(Math.random() * 900 + 100)}`;
    localStorage.setItem('icenwater_name', name);
    return name;
  }

  private async createRoom() {
    this.statusText.setText('connecting…');
    try {
      this.room = await this.client.create<LobbyStateShape>('game', {
        mode: this.lobbyMode,
        name: this.myName(),
      });
    } catch {
      const local = SERVER_URL.includes('localhost') || /192\.168|10\.|172\./.test(SERVER_URL);
      this.statusText.setText(
        local
          ? `can't reach server — is it running? (${SERVER_URL})`
          : 'online servers aren\'t live yet — coming soon!',
      );
      return;
    }
    this.onJoined();
  }

  private async joinRoom() {
    const code = (this.codeInput?.value ?? '').trim();
    if (!code) {
      this.statusText.setText('enter a room code first');
      return;
    }
    this.statusText.setText('joining…');
    try {
      this.room = await this.client.joinById<LobbyStateShape>(code, { name: this.myName() });
    } catch (e: any) {
      this.statusText.setText(`join failed (${e?.code ?? 'error'}) — check the code`);
      return;
    }
    this.onJoined();
  }

  private onJoined() {
    const room = this.room!;
    this.lobbyPhase = 'in-room';
    this.statusText.setText('');
    this.codeText
      .setText(`CODE: ${room.roomId}   (tap to copy)`)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => this.copyCode(room.roomId));
    this.hintText.setText('share the code · everyone readies up · host starts');
    this.codeInput?.remove();
    this.codeInput = null;
    this.listText.setText('connecting…');

    // state.players is EMPTY until the first server patch lands —
    // always render from onStateChange, never synchronously.
    room.onStateChange((state) => {
      if (!state?.players) return;
      this.renderLobby();
      if (state.phase === 'playing') this.startNetGame();
    });
    room.onLeave((code) => this.statusText.setText(`disconnected (${code})`));
    room.onError((code, msg) => this.statusText.setText(`room error ${code} ${msg ?? ''}`));
  }

  private copyCode(code: string) {
    const flash = () => {
      this.codeText.setText(`CODE: ${code}   ✔ copied!`);
      this.time.delayedCall(1500, () =>
        this.codeText.setText(`CODE: ${code}   (tap to copy)`),
      );
    };
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(code).then(flash).catch(() => this.fallbackCopy(code, flash));
    } else {
      this.fallbackCopy(code, flash); // plain-http LAN isn't a secure context
    }
  }

  private fallbackCopy(text: string, done: () => void) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
      done();
    } catch {
      /* leave it — user can still read 4 digits */
    }
    ta.remove();
  }

  private renderLobby() {
    const room = this.room;
    const players = room?.state?.players;
    if (!room || !players) return;
    const rows: string[] = [];
    const isHost = room.sessionId === room.state.host;
    players.forEach((p, id) => {
      const you = id === room.sessionId ? ' (you)' : '';
      const host = id === room.state.host ? ' ★' : '';
      const ready = p.ready ? '✔' : '…';
      const team = p.team ? `  [${p.team.toUpperCase()}]` : '';
      rows.push(`${ready}  ${p.name}${you}${host}${team}`);
    });
    this.listText.setText(rows.join('\n'));

    // footer buttons swap depending on role
    this.readyBtn.setVisible(true);
    this.startBtn.setVisible(isHost);
    this.hintText.setText(
      isHost
        ? 'you are the host — tap START when everyone is in'
        : 'tap READY — waiting for host to start',
    );

    this.input.keyboard!.off('keydown-R');
    this.input.keyboard!.off('keydown-SPACE');
    this.input.keyboard!.off('keydown-M');
    this.input.keyboard!.on('keydown-R', () => room.send('ready'));
    if (isHost) {
      this.input.keyboard!.on('keydown-SPACE', () => room.send('start'));
      this.input.keyboard!.on('keydown-M', () =>
        room.send('mode', room.state.mode === 'infection' ? 'rounds' : 'infection'),
      );
    }
  }

  private startNetGame() {
    if (!this.room) return;
    const room = this.room;
    this.room = null; // NetScene owns it now
    this.cleanupInputs();
    this.scene.start('net', { room });
  }

  private leave() {
    void this.room?.leave();
    this.cleanupInputs();
    this.scene.start('title');
  }

  private cleanupInputs() {
    this.nameInput?.remove();
    this.codeInput?.remove();
    this.nameInput = null;
    this.codeInput = null;
  }

  shutdown() {
    this.cleanupInputs();
  }
}
