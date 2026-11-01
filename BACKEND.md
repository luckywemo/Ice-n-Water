# Backend Audit — every localStorage key, mock store & sync gap

Full sweep of `src/`, `api/`, `server/`, `worker/` for client-side state,
fake stores, and features that need a database for production/global
sync. Ordered by severity.

---

## 1. localStorage inventory — every key, verdict per key

| Key | File | Contents | Verdict |
|---|---|---|---|
| `icenwater_adventure` | `src/adventure.ts:319` | campaign `{unlocked, stars}` — 500 levels | ✅ **SYNCED** — `api/progress.js` + `src/cloudsave.ts` (max-merge, per-level max stars) |
| `icenwater_stats` | `src/meta.ts:47` | `{games, wins, streak, bestStreak, bestSurvived}` | ✅ **SYNCED** — event-derived via `api/profile` `statsEvents`; `iw-stats-pending` journals offline results (replay log, not state) |
| `iw-char` | `src/characters.ts:221` | `{id, body?}` — selected character + custom body color | 🔴 **NEEDS DB** — player loadout; switching devices reverts to default bean |
| `icenwater_name` | `src/leaderboard.ts:26`, `LobbyScene.ts:140,323` | runner display name (10 chars) | 🔴 **NEEDS DB** — feeds `HSET names` on the board but only refreshes on next score post; X handle exists but custom name is player's identity pre-auth |
| `icenwater_picks` | `src/meta.ts:48` | `{difficulty, joy, perf, hints}` settings | 🟡 **OPTIONAL** — cross-device QoL; `perf`/`joy` are arguably per-device (phone ≠ desktop), `difficulty`/`hints` worth syncing |
| `iw-hint-seen` | `src/scenes/GameScene.ts:1225,1248` | tutorial hint dismissal counter (retires at 3) | 🟡 OPTIONAL — onboarding flag; low value, one int |
| `icenwater_adv_seen` | `src/scenes/AdventureScene.ts:189` | last-seen frontier town (new-town banner) | 🟡 OPTIONAL — cosmetic marker; derive server-side from `unlocked` if wanted |
| `icenwater_muted` | `src/audio.ts:17` | mute flag | 🟡 OPTIONAL — per-device preference, defensible local |
| `icenwater_pid` | ~~`src/leaderboard.ts`~~ | anonymous player UUID | ⚪ **REMOVED** — `playerId()` is `x_{id}` or `'anon'`; the gate guarantees a session |
| `iw_xtok` | `src/xauth.ts:18` | X session bearer token (HMAC, 30d) | ⚪ **STAYS LOCAL** — it's a credential; never mirror to a DB |

**Consolidation target:** stats + char + name + picks + seen-flags collapse
into one `profile` record per X id — see §4.

### `ice3d/` — the standalone playground app stores separately

`ice3d/src/game/util.ts` wraps localStorage under `iw3d-*` keys:
`road` (chapter progress), `char`, `map` (selections), `music`, `sfx`,
`quality`, `joinCode`. 🔴 `road` is real progression in a second save
system — if ice3d stays a shipped experience it needs the same
`/api/progress` treatment (a `campaign` discriminator field keeps both
roads in one record). `joinCode` is transient session state — local is
correct. ⚪ settings keys can stay local.

---

## 2. Mock / file-based stores — replace or delete

### 🔴 `server/src/index.ts` — the file leaderboard (`leaderboard.json`)

The colyseus host runs **its own leaderboard**: in-memory `Map` +
debounced `writeFileSync` to `leaderboard.json` (`:20-46`, `:130-150`).

Three production sins:
- **Client-supplied `id`** — `b.id` straight from the request body, no
  session check. Anyone posts as anyone.
- **Ephemeral filesystem** — on Render/most PaaS, the disk dies on
  redeploy; the whole board resets.
- **Third competing board** — `api/board.js` (Vercel+Upstash, X-verified)
  and `worker/` (CF proxy → same Upstash) already exist. One game, three
  truths.

**Action:** delete the file board; proxy `/score`,`/board` on the game
server to Upstash with `sessionFrom`-style ticket verification (the
server already verifies room tickets via `SESSION_SECRET` —
`server/src/xticket.ts` — the same blob can gate score posts).

### 🔴 Multiplayer match history — nothing persisted

`server/src/rooms/GameRoom.ts` tracks `winner` per round
(`:63`,`:247`) and `endGame` logs to stdout only. No match results, no
per-player W/L, no rating. When multiplayer ships, the outcome needs:

- `match:{id}` record — players, teams, winner, rounds, duration
- per-player aggregates — `mp:wins`, `mp:matches` on the profile
- **anti-abuse:** results must be server-asserted (the room knows who
  won; never accept a client-reported result)

---

## 3. Sync gaps in already-server features

### 🟡 Board names go stale

`api/score.js` `HSET names` only runs on score POST. A name change in
`LobbyScene` (`icenwater_name`) won't reflect on the board until the
next win — or never if they stop winning. Fix: profile save (§4)
refreshes `names` too.

### ✅ Score submission — now server-derived (was client-asserted)

`api/score.js`, `worker`, and `server/board.ts` all ignore body
`level`/`stars` — the board entry is computed from the stored `prog:`
record (`unlocked-1` levels, Σ stars). A forged post writes at worst a
*worse* score than the road earned, and `ZADD GT` refuses to lower it.

### ✅ `api/progress.js` — event writes, not state claims

POST accepts `{clearedLevel, stars}` or `{events:[...]}`; the server
advances `unlocked` one level per applied clear and only at/below its own
frontier. Legacy blobs normalize into the same pipeline — a forged
`unlocked:500` claim does nothing without clear events. Offline clears
converge via gap replay in `pullProgress`.

---

## 4. The `profile` record — consolidation target

One Redis hash per X id replaces four localStorage keys + names hash:

```
profile:x_{id}  →  { name, charId, charBody, stats:{games,wins,streak,
                    bestStreak,bestSurvived}, picks:{difficulty,hints},
                    advSeen, hintSeen, updatedAt }
```

- `GET /api/profile` / `POST /api/profile` — same `sessionFrom` +
  field-level max/last-writer-wins merge pattern as `progress.js`
- `progress` stays a separate key (it grows to 500+ star entries; profile
  stays small and hot)
- Name changes in `LobbyScene` POST profile → server also `HSET names`
  so the board reflects instantly
- Client: extend `cloudsave.ts` with `pullProfile`/`pushProfile`,
  fire-and-forget on the same triggers (name save, char pick, match end)

---

## 5. Planned features that must be server-side from day one

These are designed but not built — listing so they're never built local:

- **Daily seeded stop** (`RETENTION.md` §5.1) — `daily:{YYYY-MM-DD}` ZSET
  board + deterministic `mapSeed` derivation. Needs a date-keyed board,
  not new infrastructure.
- **Weekly champion race** — `week:{ISO}` ZSET + season reset job.
- **Comeback/streak-grace state** — `lastPlayedAt`, `graceUsedOn` live on
  the profile record.
- **Presence** (multiplayer lobby "who's online") — Redis SET with TTL,
  heartbeat from NetScene.

---

## 6. Correctly local — do NOT move

- `iw_xtok` — credential (§1)
- `icenwater_pid` — anonymous fallback id (§1)
- `icenwater_muted`, `perf`/`joy` picks — per-device preferences
- Colyseus room state (`schema.ts`) — live match state belongs in memory
- `sw.js` asset cache — static files
- `api/ticket.js`, rate-limit `rl:*` keys — already stateless/Redis

---

## 7. Ship order

| # | Work | Risk if skipped |
|---|---|---|
| 1 | ✅ `api/progress.js` + cloudsave — done (event-write model) | — |
| 2 | ✅ `api/profile.js` + `pullProfile`/`pushProfile` — done | — |
| 3 | ✅ File leaderboard killed; shared Upstash store, session-verified | — |
| 4 | ✅ Score derives from progress record — forgery-proofed | — |
| 5 | Match history + `mp:` aggregates | When multiplayer ships |
| 6 | Daily/weekly boards | With the retention roadmap |
