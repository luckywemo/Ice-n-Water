import Phaser from 'phaser';
import { Client, Room } from '@colyseus/sdk';
import { CONFIG } from '../config';
import { SERVER_URL } from '../net';
import { DISPLAY_FONT, UI_FONT, UI, panel, pillButton, plate, domInput, PillHandle } from '../ui';
import { fgBackdrop, FG } from '../fgui';
import { makeTextures } from '../art';
import { loadPicks } from '../meta';
import { keyHintsOn } from '../mobile';

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
  private readyBtn!: PillHandle;
  private startBtn!: PillHandle;
  private menuGroup!: Phaser.GameObjects.Container;
  private roomGroup!: Phaser.GameObjects.Container;
  private lobbyPhase: 'menu' | 'in-room' = 'menu';

  constructor() {
    super('lobby');
  }

  create() {
    const { width, height } = this.scale;
    makeTextures(this);
    this.room = null;
    this.lobbyPhase = 'menu';
    this.cameras.main.fadeIn(300, 247, 189, 20); // from the lobby yellow — seamless

    // one card, two states — menu swaps to the room view in place.
    // Full-bleed takeover: the card IS the screen; the content block (~500px
    // tall) stays vertically centred inside it.
    const cw = width;
    const ch = height;
    const cx = width / 2;
    const cy0 = Math.max(4, (height - 500) / 2);
    fgBackdrop(this, width, height, cx, cy0 + 210);
    panel(this, 0, 0, cw, ch, { depth: 3 });
    this.menuGroup = this.add.container(0, 0).setDepth(5);
    this.roomGroup = this.add.container(0, 0).setDepth(5).setVisible(false);

    this.menuGroup.add(
      this.add
        .text(cx, cy0 + 62, 'ONLINE', {
          fontFamily: DISPLAY_FONT,
          fontSize: '44px',
          color: '#e84393',
        })
        .setOrigin(0.5)
        .setShadow(0, 4, '#9c2160', 0, true, false),
    );
    this.menuGroup.add(
      this.add
        .text(cx, cy0 + 102, 'up to 10 players · ice freezes water', {
          fontFamily: UI_FONT,
          fontSize: '15px',
          fontStyle: '600',
          color: '#7a8a99',
        })
        .setOrigin(0.5),
    );

    // name + room code inputs (DOM elements over the canvas — not in the group)
    this.nameInput = this.makeInput(cx - 160, cy0 + 142, 'your name', 12);
    this.codeInput = this.makeInput(cx + 36, cy0 + 142, '4-digit code', 4);
    const savedName = localStorage.getItem('icenwater_name');
    if (savedName) this.nameInput.value = savedName;

    // mode picker (for room creation)
    this.menuGroup.add(
      this.add
        .text(cx, cy0 + 210, 'RULESET', {
          fontFamily: UI_FONT,
          fontSize: '12px',
          fontStyle: '800',
          color: '#7a8a99',
        })
        .setOrigin(0.5),
    );
    const modes: { id: 'infection' | 'rounds'; label: string; sub: string }[] = [
      { id: 'infection', label: 'INFECTION', sub: 'frozen runners join the ice' },
      { id: 'rounds', label: 'ROUNDS', sub: 'best of 5 · swap sides each round' },
    ];
    const rowW = 430;
    const rowH = 40;
    const modeRedraws: ((sel: boolean) => void)[] = [];
    modes.forEach((m, i) => {
      const y = cy0 + 244 + i * 46;
      const g = this.add.graphics();
      const dotG = this.add.graphics();
      const label = this.add
        .text(-rowW / 2 + 44, -9, m.label, {
          fontFamily: DISPLAY_FONT,
          fontSize: '15px',
          color: '#1c2a3a',
        })
        .setOrigin(0, 0.5);
      const sub = this.add
        .text(-rowW / 2 + 44, 10, m.sub, {
          fontFamily: UI_FONT,
          fontSize: '12px',
          fontStyle: '600',
          color: '#7a8a99',
        })
        .setOrigin(0, 0.5);
      const draw = (sel: boolean) => {
        g.clear();
        if (sel) {
          g.fillStyle(0x0b6a99, 1).fillRoundedRect(-rowW / 2 + 2, -rowH / 2 + 3, rowW, rowH, rowH / 2);
          g.fillStyle(FG.cyan, 1).fillRoundedRect(-rowW / 2, -rowH / 2, rowW, rowH, rowH / 2);
          g.lineStyle(2.5, 0xffffff, 1).strokeRoundedRect(-rowW / 2 + 1.5, -rowH / 2 + 1.5, rowW - 3, rowH - 3, rowH / 2);
        } else {
          g.fillStyle(0xe8eef4, 1).fillRoundedRect(-rowW / 2, -rowH / 2, rowW, rowH, rowH / 2);
          g.lineStyle(2, 0xc7d3dc, 1).strokeRoundedRect(-rowW / 2 + 1, -rowH / 2 + 1, rowW - 2, rowH - 2, rowH / 2);
        }
        dotG.clear();
        const dx = -rowW / 2 + 24;
        dotG.lineStyle(2, sel ? 0xffffff : 0x9db4c4, 1).strokeCircle(dx, 0, 7);
        if (sel) dotG.fillStyle(0xffffff, 1).fillCircle(dx, 0, 4);
        label.setColor(sel ? '#ffffff' : '#1c2a3a');
        sub.setColor(sel ? '#d6f4ff' : '#7a8a99');
      };
      draw(i === 0);
      modeRedraws.push(draw);
      const row = this.add.container(cx, y, [g, dotG, label, sub]);
      this.menuGroup.add(row);
      this.add
        .zone(cx - rowW / 2, y - rowH / 2, rowW, rowH)
        .setOrigin(0, 0)
        .setInteractive({ useHandCursor: true })
        .on('pointerdown', () => {
          this.lobbyMode = m.id;
          modeRedraws.forEach((redraw, j) => redraw(modes[j].id === m.id));
        });
    });

    // buttons — create is the primary (danfo), join secondary (ice)
    const createBtn = pillButton(this, cx - 120, cy0 + 362, 220, 'CREATE ROOM', {
      fill: UI.danfo,
      textColor: UI.ink,
      fontSize: 15,
      onDown: () => this.createRoom(),
    });
    const joinBtn = pillButton(this, cx + 120, cy0 + 362, 220, 'JOIN ROOM', {
      fill: UI.water,
      fontSize: 15,
      onDown: () => this.joinRoom(),
    });
    this.menuGroup.add([createBtn.container, joinBtn.container]);
    this.statusText = this.add
      .text(cx, cy0 + 412, '', {
        fontFamily: UI_FONT,
        fontSize: '14px',
        fontStyle: '600',
        color: '#d63a4a',
      })
      .setOrigin(0.5);
    this.menuGroup.add(this.statusText);

    pillButton(this, cx, ch - 44, 140, 'BACK', {
      fill: UI.ink,
      textColor: UI.paper,
      fontSize: 14,
      onDown: () => this.scene.start('title'),
    });

    // ---- room group (swaps in on join) ----
    const codePlate = plate(this, cx - 160, cy0 + 48, 320, 48, UI.danfo);
    this.roomGroup.add(codePlate);
    this.codeText = this.add
      .text(cx, cy0 + 74, '', {
        fontFamily: DISPLAY_FONT,
        fontSize: '22px',
        color: '#ffc93c',
      })
      .setOrigin(0.5)
      .setDepth(6);
    this.roomGroup.add(this.codeText);
    this.listText = this.add
      .text(cx - 250, cy0 + 128, '', {
        fontFamily: UI_FONT,
        fontSize: '16px',
        fontStyle: '600',
        color: '#33475a',
        lineSpacing: 7,
      })
      .setDepth(6);
    this.roomGroup.add(this.listText);
    this.hintText = this.add
      .text(cx, cy0 + 406, '', {
        fontFamily: UI_FONT,
        fontSize: '14px',
        fontStyle: '600',
        color: '#7a8a99',
      })
      .setOrigin(0.5)
      .setDepth(6);
    this.roomGroup.add(this.hintText);

    // in-room action buttons — keyboard still works, these are for touch & clarity
    this.readyBtn = pillButton(this, cx - 115, cy0 + 452, 200, 'READY', {
      fill: UI.water,
      fontSize: 15,
      onDown: () => this.room?.send('ready'),
    });
    this.startBtn = pillButton(this, cx + 115, cy0 + 452, 200, 'START', {
      fill: UI.leaf,
      fontSize: 15,
      onDown: () => this.room?.send('start'),
    });
    this.roomGroup.add([this.readyBtn.container, this.startBtn.container]);

    if (keyHintsOn())
      this.add
        .text(width / 2, height - 18, 'esc — back', {
          fontFamily: UI_FONT,
          fontSize: '13px',
          fontStyle: '800',
          color: '#7a8a99', // sits on the paper card now — ink, not white
        })
        .setOrigin(0.5, 1);
    this.input.keyboard!.on('keydown-ESC', () => this.leave());

    // window resized — rebuild the layout (TitleScene does the same).
    // Only while in the menu: mid-room a restart would drop the room.
    let lastW = width;
    let lastH = height;
    const onResize = (sz: Phaser.Structs.Size) => {
      const moved = Math.abs(sz.width - lastW) > 24 || Math.abs(sz.height - lastH) > 24;
      lastW = sz.width;
      lastH = sz.height;
      if (moved && this.lobbyPhase === 'menu') this.scene.restart();
    };
    this.scale.on('resize', onResize);
    this.events.once('shutdown', () => this.scale.off('resize', onResize));
  }

  private makeInput(x: number, y: number, placeholder: string, maxLen: number): HTMLInputElement {
    return domInput(this, x, y, placeholder, maxLen, 128).el;
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
    // swap the card's contents — menu out, room in
    this.menuGroup.setVisible(false);
    this.roomGroup.setVisible(true);
    this.nameInput?.remove();
    this.nameInput = null;
    this.codeInput?.remove();
    this.codeInput = null;
    this.codeText
      .setText(`CODE: ${room.roomId}   (tap to copy)`)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => this.copyCode(room.roomId));
    this.hintText.setText('share the code · everyone readies up · host starts');
    this.listText.setText('connecting…');

    // state.players is EMPTY until the first server patch lands —
    // always render from onStateChange, never synchronously.
    room.onStateChange((state) => {
      if (!state?.players) return;
      this.renderLobby();
      if (state.phase === 'playing') this.startNetGame();
    });
    room.onLeave((code) => this.hintText.setText(`disconnected (${code})`));
    room.onError((code, msg) => this.hintText.setText(`room error ${code} ${msg ?? ''}`));
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
    this.readyBtn.container.setVisible(true);
    this.startBtn.container.setVisible(isHost);
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
