var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
import { Schema, MapSchema, type } from '@colyseus/schema';
export class Player extends Schema {
    constructor() {
        super(...arguments);
        this.name = '';
        this.ready = false;
        this.team = '';
        // synced position — written by owner, relayed to everyone
        this.x = 0;
        this.y = 0;
        this.angle = 0;
        // game rule state (used by milestone 3 — tags/jail)
        this.out = false;
    }
}
__decorate([
    type('string')
], Player.prototype, "name", void 0);
__decorate([
    type('boolean')
], Player.prototype, "ready", void 0);
__decorate([
    type('string')
], Player.prototype, "team", void 0);
__decorate([
    type('number')
], Player.prototype, "x", void 0);
__decorate([
    type('number')
], Player.prototype, "y", void 0);
__decorate([
    type('number')
], Player.prototype, "angle", void 0);
__decorate([
    type('boolean')
], Player.prototype, "out", void 0);
export class LobbyState extends Schema {
    constructor() {
        super(...arguments);
        this.mode = 'infection';
        this.phase = 'lobby';
        this.host = '';
        this.players = new MapSchema();
        this.round = 0;
        // game rules (milestone 3)
        this.timeLeft = 0; // seconds left in the round
        this.intermissionLeft = 0; // countdown between rounds
        this.policeScore = 0;
        this.thiefScore = 0;
        this.message = ''; // event feed — client pops banners on change
        this.winner = '';
    }
}
__decorate([
    type('string')
], LobbyState.prototype, "mode", void 0);
__decorate([
    type('string')
], LobbyState.prototype, "phase", void 0);
__decorate([
    type('string')
], LobbyState.prototype, "host", void 0);
__decorate([
    type({ map: Player })
], LobbyState.prototype, "players", void 0);
__decorate([
    type('number')
], LobbyState.prototype, "round", void 0);
__decorate([
    type('number')
], LobbyState.prototype, "timeLeft", void 0);
__decorate([
    type('number')
], LobbyState.prototype, "intermissionLeft", void 0);
__decorate([
    type('number')
], LobbyState.prototype, "policeScore", void 0);
__decorate([
    type('number')
], LobbyState.prototype, "thiefScore", void 0);
__decorate([
    type('string')
], LobbyState.prototype, "message", void 0);
__decorate([
    type('string')
], LobbyState.prototype, "winner", void 0);
