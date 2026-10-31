import { createServer, IncomingMessage, ServerResponse } from 'http';
import { Server } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { GameRoom } from './rooms/GameRoom.js';
import { getBoard, postScore } from './board.js';

const port = Number(process.env.PORT || 2567);

// ---------- adventure leaderboard (shared Upstash store — see board.ts) ----------

const lastPostAt = new Map<string, number>(); // crude per-IP rate limit

const json = (res: ServerResponse, code: number, body: unknown) => {
  res.writeHead(code, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(JSON.stringify(body));
};

function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 4096) {
        reject(new Error('payload too big')); // don't get farmed
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(data || '{}'));
      } catch {
        reject(new Error('bad json'));
      }
    });
    req.on('error', reject);
  });
}

async function api(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? '/', 'http://x');

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    });
    return res.end();
  }

  if (url.pathname === '/health') return json(res, 200, { ok: true });

  if (url.pathname === '/api/leaderboard' && req.method === 'GET') {
    try {
      const { top, me } = await getBoard(url.searchParams.get('me'));
      return json(res, 200, { top, me });
    } catch (e) {
      return json(res, 500, { error: String((e as Error)?.message ?? e) });
    }
  }

  if (url.pathname === '/api/score' && req.method === 'POST') {
    const ip = req.socket.remoteAddress ?? '?';
    const now = Date.now();
    if (now - (lastPostAt.get(ip) ?? 0) < 1500) return json(res, 429, { error: 'slow down' });
    lastPostAt.set(ip, now);
    try {
      // the router's pre-read caps at 1MB, not our 4KB — enforce our own
      // bound before accepting (chunked bodies still hit readBody's cap)
      if (Number(req.headers['content-length'] ?? 0) > 4096)
        return json(res, 400, { error: 'payload too big' });
      // colyseus' router pre-reads bodies for requests with content-length —
      // use req.body when populated, stream it ourselves otherwise
      const b = ((req as IncomingMessage & { body?: unknown }).body ?? (await readBody(req))) as Record<
        string,
        unknown
      >;
      const { code, out } = await postScore(req.headers.authorization, b);
      return json(res, code, out);
    } catch {
      return json(res, 400, { error: 'bad request' });
    }
  }

  return json(res, 404, { error: 'not found' });
}

// ---------- colyseus on the same http server ----------

const httpServer = createServer();

const gameServer = new Server({
  transport: new WebSocketTransport({ server: httpServer }),
  // colyseus prepends its matchmake router to 'request' — a bare listener
  // would race it and double-respond. Custom routes mount on its express
  // fallback instead, which only sees requests the router didn't claim.
  express: (app) => app.use((req: IncomingMessage, res: ServerResponse) => void api(req, res)),
});

gameServer.define('game', GameRoom);

void gameServer.listen(port).then(() => {
  console.log(`[ice-n-water] ws + leaderboard api on :${port}`);
});
