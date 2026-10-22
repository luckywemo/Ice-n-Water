import { Server } from 'colyseus';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { GameRoom } from './rooms/GameRoom';
const port = Number(process.env.PORT || 2567);
const gameServer = new Server({
    transport: new WebSocketTransport(),
});
gameServer.define('game', GameRoom);
void gameServer.listen(port).then(() => {
    console.log(`[ice-n-water] listening on ws://localhost:${port}`);
});
