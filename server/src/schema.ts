import { Schema, MapSchema, type } from '@colyseus/schema';

export type Team = 'police' | 'thief' | '';
export type LobbyMode = 'infection' | 'rounds';
export type Phase = 'lobby' | 'playing' | 'intermission' | 'ended';

export class Player extends Schema {
  @type('string') name = '';
  @type('boolean') ready = false;
  @type('string') team: Team = '';
  // synced position — written by owner, relayed to everyone
  @type('number') x = 0;
  @type('number') y = 0;
  @type('number') angle = 0;
  // game rule state (used by milestone 3 — tags/jail)
  @type('boolean') out = false;
}

export class LobbyState extends Schema {
  @type('string') mode: LobbyMode = 'infection';
  @type('string') phase: Phase = 'lobby';
  @type('string') host = '';
  @type({ map: Player }) players = new MapSchema<Player>();
  @type('number') round = 0;
  // game rules (milestone 3)
  @type('number') timeLeft = 0;        // seconds left in the round
  @type('number') intermissionLeft = 0; // countdown between rounds
  @type('number') policeScore = 0;
  @type('number') thiefScore = 0;
  @type('string') message = '';        // event feed — client pops banners on change
  @type('string') winner = '';
  @type('number') mapSeed = 0;        // per-round layout — clients generate the same map
}
