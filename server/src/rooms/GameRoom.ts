import { Room, Client, matchMaker, CloseCode } from '@colyseus/core';
import { LobbyState, Player } from '../schema.js';

// must mirror the client's arena + reach values (src/config.ts — the
// client measures center distance against range + runner radius)
const ARENA = { width: 2304, height: 1440, wall: 22 };
const TAG_RANGE = 41; // config.tagRange + runner.radius
const THAW_RANGE = 44; // config.thawRange + runner.radius
const MOVE_MAX_PX_S = 320; // sprint is 272 — headroom, not a straitjacket
const MOVE_SLACK = 120; // absorbs a couple of lost packets
const ROUND_SECONDS = 90;
const INTERMISSION_S = 4;
const ROUNDS_TO_WIN = 3;

/**
 * Ice 'N' Water room.
 *
 * Lobby: players join, ready up, host picks the ruleset and starts.
 *  - 'infection' — frozen runners join the ice (conversion tag)
 *  - 'rounds'    — caught runners freeze; mates thaw them; all frozen or
 *                  timer decides the round; first to 3 rounds wins
 *
 * Rules are server-authoritative: the server decides tags, freezes,
 * conversions, round wins, and rematches. Clients only report position.
 */
export class GameRoom extends Room<{ state: LobbyState }> {
  maxClients = 10;
  /** sessionId → timestamp when a converted chaser can tag again */
  private noTagUntil = new Map<string, number>();
  /** sessionId → last accepted position — baseline for the move clamp */
  private lastPos = new Map<string, { x: number; y: number; t: number }>();

  async onCreate(options: { mode?: string }) {
    this.roomId = await this.generateCode();
    this.setState(new LobbyState());
    this.state.mode = options?.mode === 'rounds' ? 'rounds' : 'infection';
    this.setPatchRate(50); // 20 state broadcasts / second
    this.setTimestep((dt) => this.tick(dt), 50);

    this.onMessage('ready', (client) => {
      const p = this.state.players.get(client.sessionId);
      if (p) p.ready = !p.ready;
    });

    this.onMessage('mode', (client, mode: string) => {
      if (client.sessionId !== this.state.host || this.state.phase !== 'lobby') return;
      this.state.mode = mode === 'rounds' ? 'rounds' : 'infection';
    });

    this.onMessage('start', (client) => {
      if (client.sessionId !== this.state.host || this.state.phase !== 'lobby') return;
      if (this.state.players.size < 2) return;
      this.state.round = 1;
      this.beginRound();
    });

    // host rematches after 'ended' — same lobby, fresh shuffle
    this.onMessage('restart', (client) => {
      if (client.sessionId !== this.state.host || this.state.phase !== 'ended') return;
      this.state.iceScore = 0;
      this.state.waterScore = 0;
      this.state.winner = '';
      this.state.round = 1;
      this.beginRound();
    });

    this.onMessage('move', (client, m: { x?: number; y?: number; angle?: number }) => {
      const p = this.state.players.get(client.sessionId);
      if (!p || this.state.phase !== 'playing' || p.out) return;
      const now = Date.now();
      if (typeof m.x === 'number' && typeof m.y === 'number') {
        // positions are client-reported — a speed hack shows up as an
        // impossible jump, so clamp each step to plausible range instead
        // of trusting it (slack absorbs a few lost packets)
        const last = this.lastPos.get(client.sessionId);
        if (last) {
          const allowed = (MOVE_MAX_PX_S * (now - last.t)) / 1000 + MOVE_SLACK;
          const dx = m.x - last.x;
          const dy = m.y - last.y;
          const dist = Math.hypot(dx, dy);
          const k = dist > allowed ? allowed / dist : 1;
          p.x = last.x + dx * k;
          p.y = last.y + dy * k;
        } else {
          p.x = m.x;
          p.y = m.y;
        }
        this.lastPos.set(client.sessionId, { x: p.x, y: p.y, t: now });
      } else {
        if (typeof m.x === 'number') p.x = m.x;
        if (typeof m.y === 'number') p.y = m.y;
      }
      if (typeof m.angle === 'number') p.angle = m.angle;
    });
  }

  onJoin(client: Client, options: { name?: string }) {
    const p = new Player();
    p.name = (options?.name ?? 'player').toString().slice(0, 12) || 'player';
    this.state.players.set(client.sessionId, p);
    if (!this.state.host) this.state.host = client.sessionId;
    console.log(`[room ${this.roomId}] ${p.name} joined (${this.state.players.size}/${this.maxClients})`);
  }

  async onLeave(client: Client, code?: number) {
    const consented = code === CloseCode.CONSENTED;
    const p = this.state.players.get(client.sessionId);
    console.log(`[room ${this.roomId}] ${p?.name ?? client.sessionId} left (consented=${consented})`);

    // graceful leave or still in lobby — remove right away.
    // ungraceful drop mid-game (phone slept, tunnel) — hold the seat.
    if (consented || this.state.phase === 'lobby') {
      this.removePlayer(client);
      return;
    }
    try {
      await this.allowReconnection(client, 25);
      console.log(`[room ${this.roomId}] ${p?.name ?? client.sessionId} reconnected`);
    } catch {
      this.removePlayer(client);
    }
  }

  private removePlayer(client: Client) {
    this.state.players.delete(client.sessionId);
    this.noTagUntil.delete(client.sessionId);
    this.lastPos.delete(client.sessionId);
    if (client.sessionId === this.state.host) {
      const next = this.state.players.keys().next();
      this.state.host = next.done ? '' : next.value;
    }
  }

  /** Short shareable room code — retries until it finds an unused 4-digit. */
  private async generateCode(): Promise<string> {
    const rooms = await matchMaker.query({ name: 'game' });
    const taken = new Set(rooms.map((r) => r.roomId));
    for (let i = 0; i < 100; i++) {
      const code = String(Math.floor(1000 + Math.random() * 9000));
      if (!taken.has(code)) return code;
    }
    throw new Error('no room codes available');
  }

  // ── game loop ────────────────────────────────────────────────

  private tick(dtMs: number) {
    const s = this.state;

    if (s.phase === 'intermission') {
      s.intermissionLeft -= dtMs / 1000;
      if (s.intermissionLeft <= 0) this.beginRound();
      return;
    }
    if (s.phase !== 'playing') return;

    s.timeLeft = Math.max(0, s.timeLeft - dtMs / 1000);

    const players = [...s.players.values()];
    const free = players.filter((p) => p.team === 'water' && !p.out);
    const frozen = players.filter((p) => p.team === 'water' && p.out);

    // tags — ice touching a free runner freezes them
    const now = Date.now();
    for (const [cId, chaser] of s.players) {
      if (chaser.team !== 'ice') continue;
      if ((this.noTagUntil.get(cId) ?? 0) > now) continue; // newly converted — dazed
      for (const [tId, t] of s.players) {
        if (t.out || t.team !== 'water') continue;
        if (this.near(chaser, t, TAG_RANGE)) {
          this.catch(cId, chaser, tId, t);
          break; // one tag per chaser per tick — stacked runners can't mass-clear
        }
      }
    }

    if (s.mode === 'infection') {
      if (players.length > 0 && players.every((p) => p.team === 'ice')) {
        this.endGame('ice', 'ICE WINS — all the water frozen!');
      } else if (s.timeLeft <= 0) {
        this.endGame('water', 'WATER WINS — they outlasted the freeze!');
      }
      return;
    }

    // rounds mode — free runners thaw frozen mates on touch
    for (const f of free) {
      if (f.out || f.team !== 'water') continue; // caught this tick — can't rescue
      for (const o of frozen) {
        if (o.out && this.near(f, o, THAW_RANGE)) {
          o.out = false;
          s.message = `${o.name} thawed — water!`;
        }
      }
    }

    const runners = players.filter((p) => p.team === 'water');
    if (runners.length > 0 && runners.every((p) => p.out)) {
      this.endRound('ice');
    } else if (s.timeLeft <= 0) {
      this.endRound('water');
    }
  }

  private catch(cId: string, chaser: Player, tId: string, t: Player) {
    const s = this.state;
    // the catcher is "busy" for a beat — one tag per chaser per cooldown, so a
    // stack of runners can't all be cleared in a single tick
    this.noTagUntil.set(cId, Date.now() + 800);
    if (s.mode === 'infection') {
      t.team = 'ice';
      this.noTagUntil.set(tId, Date.now() + 1500); // dazed — can't insta-chain-catch
      s.message = `${t.name} turned ICE — wahala!`;
    } else {
      t.out = true;
      s.message = `${chaser.name} froze ${t.name}!`;
    }
  }

  private endRound(team: 'ice' | 'water') {
    const s = this.state;
    if (team === 'ice') s.iceScore++;
    else s.waterScore++;

    if (s.iceScore >= ROUNDS_TO_WIN || s.waterScore >= ROUNDS_TO_WIN) {
      this.endGame(team, `${team.toUpperCase()} WIN THE MATCH!`);
      return;
    }
    s.phase = 'intermission';
    s.intermissionLeft = INTERMISSION_S;
    s.message = `${team === 'ice' ? 'ICE' : 'WATER'} TAKES ROUND ${s.round} — next up…`;
    s.round++;
  }

  private endGame(team: 'ice' | 'water', msg: string) {
    this.state.phase = 'ended';
    this.state.winner = team;
    this.state.message = msg;
    console.log(`[room ${this.roomId}] ${msg}`);
  }

  /** Fresh round: new neighborhood, shuffled teams, scattered spawns. */
  private beginRound() {
    const s = this.state;
    s.mapSeed = Math.floor(Math.random() * 0xffffffff); // clients rebuild the same layout
    this.assignTeams();
    this.scatterSpawns();
    s.timeLeft = ROUND_SECONDS;
    s.phase = 'playing';
    s.message = `ROUND ${s.round} — GO!`;
  }

  private near(a: Player, b: Player, range: number) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return dx * dx + dy * dy <= range * range;
  }

  /** Ice lines up bottom-center; water scatters the yard. */
  private scatterSpawns() {
    const players = [...this.state.players.values()];
    const ice = players.filter((p) => p.team === 'ice');
    const water = players.filter((p) => p.team === 'water');
    const { width, height, wall } = ARENA;

    ice.forEach((p, i) => {
      p.x = width / 2 + (i - (ice.length - 1) / 2) * 60;
      p.y = height - wall - 60;
      p.out = false;
    });
    water.forEach((p) => {
      p.x = wall + 40 + Math.random() * (width - wall * 2 - 80);
      p.y = wall + 40 + Math.random() * (height * 0.55 - wall);
      p.out = false;
    });

    // the server just teleported everyone — reseed the clamp baseline or
    // the next client move rubber-bands back toward the old position
    const now = Date.now();
    for (const [id, p] of this.state.players) {
      this.lastPos.set(id, { x: p.x, y: p.y, t: now });
    }
  }

  /** Shuffle players into ice/water teams based on the ruleset. */
  private assignTeams() {
    const ids = [...this.state.players.keys()];
    // Fisher–Yates
    for (let i = ids.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [ids[i], ids[j]] = [ids[j], ids[i]];
    }

    let iceCount: number;
    if (this.state.mode === 'infection') {
      iceCount = ids.length >= 8 ? 2 : 1; // start small — they grow by freezing
    } else {
      iceCount = Math.max(1, Math.floor(ids.length / 2)); // even 5v5-style split
    }

    ids.forEach((id, i) => {
      const p = this.state.players.get(id)!;
      p.team = i < iceCount ? 'ice' : 'water';
      p.out = false;
      p.ready = false;
    });
    console.log(
      `[room ${this.roomId}] teams set — ${iceCount} ice / ${ids.length - iceCount} water (${this.state.mode})`,
    );
  }
}
