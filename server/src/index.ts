import { createServer, IncomingMessage, ServerResponse } from 'http';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { Server } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { GameRoom } from './rooms/GameRoom.js';

const port = Number(process.env.PORT || 2567);

// ---------- adventure leaderboard ----------

interface LbEntry {
  id: string;
  name: string;
  level: number; // levels cleared across both campaigns (1..1000)
  stars: number; // total stars earned (max 3000)
  updated: number; // epoch ms — earlier wins ties
}

const LB_FILE = join(process.cwd(), 'leaderboard.json');
const MAX_ROWS = 500; // keep the table bounded
const entries = new Map<string, LbEntry>();
const lastPostAt = new Map<string, number>(); // crude per-IP rate limit

if (existsSync(LB_FILE)) {
  try {
    for (const e of JSON.parse(readFileSync(LB_FILE, 'utf8')) as LbEntry[]) {
      entries.set(e.id, e);
    }
    console.log(`[leaderboard] loaded ${entries.size} entries`);
  } catch {
    console.warn('[leaderboard] corrupt file — starting fresh');
  }
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
function saveSoon() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      writeFileSync(LB_FILE, JSON.stringify([...entries.values()]));
    } catch (e) {
      console.warn('[leaderboard] save failed', e);
    }
  }, 4000);
}

const ranked = () =>
  [...entries.values()].sort(
    (a, b) => b.level - a.level || b.stars - a.stars || a.updated - b.updated,
  );

const pub = (e: LbEntry) => ({ name: e.name, level: e.level, stars: e.stars });

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
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    return res.end();
  }

  if (url.pathname === '/health') return json(res, 200, { ok: true, players: entries.size });

  if (url.pathname === '/api/leaderboard' && req.method === 'GET') {
    const top = ranked().slice(0, 50).map((e, i) => ({ rank: i + 1, ...pub(e) }));
    let me: unknown = null;
    const id = url.searchParams.get('me');
    if (id && entries.has(id)) {
      const idx = ranked().findIndex((e) => e.id === id);
      me = { rank: idx + 1, ...pub(entries.get(id)!) };
    }
    return json(res, 200, { top, me });
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
      const id = String(b.id ?? '');
      const name = String(b.name ?? 'runner').slice(0, 16).replace(/[^\w \-!'áéíóúñ]/gi, '') || 'runner';
      const level = Math.floor(Number(b.level));
      const stars = Math.floor(Number(b.stars));
      if (id.length < 8 || id.length > 64)
        return json(res, 400, { error: 'bad id' });
      if (!(level >= 1 && level <= 1000 && stars >= 0 && stars <= 3000))
        return json(res, 400, { error: 'bad score' });

      const prev = entries.get(id);
      // only keep their BEST run — no grinding the same level for rank
      if (prev && (prev.level > level || (prev.level === level && prev.stars >= stars))) {
        const idx = ranked().findIndex((e) => e.id === id);
        return json(res, 200, { rank: idx + 1, ...pub(prev) });
      }
      entries.set(id, { id, name, level, stars, updated: now });
      // prune the tail
      if (entries.size > MAX_ROWS * 2) {
        for (const e of ranked().slice(MAX_ROWS)) entries.delete(e.id);
      }
      saveSoon();
      const idx = ranked().findIndex((e) => e.id === id);
      return json(res, 200, { rank: idx + 1, ...pub(entries.get(id)!) });
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
