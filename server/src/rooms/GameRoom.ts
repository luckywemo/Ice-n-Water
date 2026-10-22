import { Room, Client, matchMaker } from 'colyseus';
import { LobbyState, Player } from '../schema';

// must mirror the client's arena + reach values (src/config.ts)
const ARENA = { width: 2304, height: 1440, wall: 22 };
const TAG_RANGE = 28;
const THAW_RANGE = 30;
const ROUND_SECONDS = 90;
const INTERMISSION_S = 4;
const ROUNDS_TO_WIN = 3;

/**
 * Ice 'N' Water room.
 *
 * Lobby: players join, ready up, host picks the ruleset and starts.
 *  - 'infection' — caught thieves join the police (conversion tag)
 *  - 'rounds'    — caught thieves freeze; mates thaw them; all frozen or
 *                  timer decides the round; first to 3 rounds wins
 *
 * Rules are server-authoritative: the server decides tags, freezes,
 * conversions, round wins, and rematches. Clients only report position.
 */
export class GameRoom extends Room<LobbyState> {
  maxClients = 10;
  /** sessionId → timestamp when a converted cop can tag again */
  private noTagUntil = new Map<string, number>();

  async onCreate(options: { mode?: string }) {
    this.roomId = await this.generateCode();
    this.setState(new LobbyState());
    this.state.mode = options?.mode === 'rounds' ? 'rounds' : 'infection';
    this.setPatchRate(50); // 20 state broadcasts / second
    this.setSimulationInterval((dt) => this.tick(dt), 50);

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
      this.state.policeScore = 0;
      this.state.thiefScore = 0;
      this.state.winner = '';
      this.state.round = 1;
      this.beginRound();
    });

    this.onMessage('move', (client, m: { x?: number; y?: number; angle?: number }) => {
      const p = this.state.players.get(client.sessionId);
      if (!p || this.state.phase !== 'playing' || p.out) return;
      if (typeof m.x === 'number') p.x = m.x;
      if (typeof m.y === 'number') p.y = m.y;
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

  async onLeave(client: Client, consented: boolean) {
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
    const cops = players.filter((p) => p.team === 'police');
    const free = players.filter((p) => p.team === 'thief' && !p.out);
    const frozen = players.filter((p) => p.team === 'thief' && p.out);

    // tags — police touching a free thief catches them
    const now = Date.now();
    for (const [copId, cop] of s.players) {
      if (cop.team !== 'police') continue;
      if ((this.noTagUntil.get(copId) ?? 0) > now) continue; // newly converted — dazed
      for (const [tId, t] of s.players) {
        if (t.out || t.team !== 'thief') continue;
        if (this.near(cop, t, TAG_RANGE)) {
          this.catch(copId, cop, tId, t);
          break; // one tag per cop per tick — stacked thieves can't mass-clear
        }
      }
    }

    if (s.mode === 'infection') {
      if (players.length > 0 && players.every((p) => p.team === 'police')) {
        this.endGame('police', 'POLICE WIN — every thief turned!');
      } else if (s.timeLeft <= 0) {
        this.endGame('thief', 'THIEVES WIN — they outlasted the hunt!');
      }
      return;
    }

    // rounds mode — free thieves thaw frozen mates on touch
    for (const f of free) {
      if (f.out || f.team !== 'thief') continue; // caught this tick — can't rescue
      for (const o of frozen) {
        if (o.out && this.near(f, o, THAW_RANGE)) {
          o.out = false;
          s.message = `${o.name} thawed — water!`;
        }
      }
    }

    const thieves = players.filter((p) => p.team === 'thief');
    if (thieves.length > 0 && thieves.every((p) => p.out)) {
      this.endRound('police');
    } else if (s.timeLeft <= 0) {
      this.endRound('thief');
    }
  }

  private catch(copId: string, cop: Player, tId: string, t: Player) {
    const s = this.state;
    // the catcher is "busy" for a beat — one tag per cop per cooldown, so a
    // stack of thieves can't all be cleared in a single tick
    this.noTagUntil.set(copId, Date.now() + 800);
    if (s.mode === 'infection') {
      t.team = 'police';
      this.noTagUntil.set(tId, Date.now() + 1500); // dazed — can't insta-chain-catch
      s.message = `${t.name} turned police — wahala!`;
    } else {
      t.out = true;
      s.message = `${cop.name} caught ${t.name}!`;
    }
  }

  private endRound(team: 'police' | 'thief') {
    const s = this.state;
    if (team === 'police') s.policeScore++;
    else s.thiefScore++;

    if (s.policeScore >= ROUNDS_TO_WIN || s.thiefScore >= ROUNDS_TO_WIN) {
      this.endGame(team, `${team.toUpperCase()} WIN THE MATCH!`);
      return;
    }
    s.phase = 'intermission';
    s.intermissionLeft = INTERMISSION_S;
    s.message = `${team === 'police' ? 'POLICE' : 'THIEVES'} TAKE ROUND ${s.round} — next up…`;
    s.round++;
  }

  private endGame(team: 'police' | 'thief', msg: string) {
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

  /** Police line up bottom-center; thieves scatter the yard. */
  private scatterSpawns() {
    const players = [...this.state.players.values()];
    const cops = players.filter((p) => p.team === 'police');
    const thieves = players.filter((p) => p.team === 'thief');
    const { width, height, wall } = ARENA;

    cops.forEach((p, i) => {
      p.x = width / 2 + (i - (cops.length - 1) / 2) * 60;
      p.y = height - wall - 60;
      p.out = false;
    });
    thieves.forEach((p) => {
      p.x = wall + 40 + Math.random() * (width - wall * 2 - 80);
      p.y = wall + 40 + Math.random() * (height * 0.55 - wall);
      p.out = false;
    });
  }

  /** Shuffle players into police/thief teams based on the ruleset. */
  private assignTeams() {
    const ids = [...this.state.players.keys()];
    // Fisher–Yates
    for (let i = ids.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [ids[i], ids[j]] = [ids[j], ids[i]];
    }

    let policeCount: number;
    if (this.state.mode === 'infection') {
      policeCount = ids.length >= 8 ? 2 : 1; // start small — they grow by catching
    } else {
      policeCount = Math.max(1, Math.floor(ids.length / 2)); // even 5v5-style split
    }

    ids.forEach((id, i) => {
      const p = this.state.players.get(id)!;
      p.team = i < policeCount ? 'police' : 'thief';
      p.out = false;
      p.ready = false;
    });
    console.log(
      `[room ${this.roomId}] teams set — ${policeCount} police / ${ids.length - policeCount} thieves (${this.state.mode})`,
    );
  }
}
