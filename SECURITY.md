# Security Audit — Ice 'N' Water

Scope: `api/` (auth, progress, profile, score, board, ticket, me), `worker/`,
`server/` (board, GameRoom, xticket), `src/` (xauth, leaderboard, cloudsave,
DOM sinks), `ice3d/`, `public/sw.js`, secrets handling.
Method: full source review + live attack tests against production Redis
(forged sessions, forged ids, skip/batch/legacy-blob claims, throttle runs).

## Findings & remediation status

### 🔴 Session token could leak to a hostile opener — FIXED

`api/auth/x/callback.js` — the handoff page posted `{token}` to
`window.opener` with `target='*'` whenever the OAuth request carried no
valid `next`. An attacker site could `window.open('/api/auth/x')`, let the
victim's existing X session auto-complete the flow, and receive the
victim's 30-day session — full impersonation incl. renaming their board
entry (`HSET names`).

**Fix shipped:** postMessage only fires when `next` resolved to an
allowlisted origin; no `'*'` fallback exists. The `sid` poll channel
(GETDEL, single-redemption, 122-bit id) already covers opener-less flows.

### 🟠 Batch events could mint the whole road in one POST — FIXED

`api/progress.js` — the contiguity bound (`level <= unlocked` as it grows)
meant `events:[{level:1}..{level:500}]` applied sequentially in a single
request; the derived board then published the fake road at rank #1.

**Fix shipped:** token-bucket throttle on frontier advances — 1 credit per
30s wall-clock, 8 banked (`MS_PER_LEVEL`, `BURST`). Real play never binds
(levels take 60s+, offline replays spend a banked bucket); a script stalls
to ~4 days for a fake road. Verified live: 500-event forge → 8 levels,
replay → 0.

## Open findings (accepted / queued)

| Sev | Item | Surface | Note |
|---|---|---|---|
| 🟡 | No rate limit | `/api/ticket`, `/api/auth/poll`, `/api/auth/x` | Cost/abuse surface on Upstash + X API calls; sids are unguessable so it's spend-abuse, not a redeem-probe |
| 🟡 | Enumerable room codes | `GameRoom.generateCode` (4 digits) | Authed accounts can drop into strangers' rooms; griefing vector, ticket-gated so they're identified |
| 🟡 | `?me=` rank probing | `server /api/leaderboard`, worker `/board` | Existence/rank oracle for arbitrary `x_<id>` — low (ranks are public anyway) |
| 🟡 | `statsEvents` replay | `api/profile.js` | No event nonce; re-POSTing a journal inflates self-visible stats within the 120/hr cap — board unaffected (derives from `prog:`) |
| ⚪ | 30d bearer, no revocation | `xsess.js` | Standard stateless tradeoff; stolen token valid till exp. Depends on keeping zero user-data→DOM sinks |
| ⚪ | `origin()` trusts `Host` | `xsess.js` | `redirect_uri` builds from request Host; X rejects unregistered callbacks so it fails at X — pin to env anyway |

## Verified good

- **OAuth**: PKCE S256; single-use `state`/`verifier` cookie (HttpOnly,
  SameSite=Lax, burned at callback entry); `safeNext` allowlist on the
  postMessage target; token returns via URL hash (never logs/referers) +
  `history.replaceState` strip.
- **Sessions**: `v1.payload.sig`, HMAC-SHA256 + `timingSafeEqual` + `exp`;
  fail-closed in production on all four verifiers (xsess, worker
  WebCrypto, `board.ts`, `xticket.ts` — `NODE_ENV=production` without
  `SESSION_SECRET` rejects everyone).
- **Identity**: every writer keys rows off the verified session id —
  body-supplied ids are ignored (tested: forged `id:'VICTIM'` → own row).
- **Integrity**: `prog:` advances only via bounded events; score derives
  server-side from `prog:` (`api/score`, worker, `board.ts` all);
  `ZADD GT` is monotonic — a forged post can only undersell.
- **Stats**: `statsEvents` journal — server recomputes games/wins/streaks
  with server-side `updatedAt`; claimed aggregates are ignored.
- **XSS**: zero user-data→`innerHTML` sinks (all hits interpolate
  compile-time constants); names scrubbed by `cleanName` on every writer;
  avatar fetched as blob → same-origin objectURL; `#iw_x` harvested and
  stripped. Keep it that way — `iw_xtok` in localStorage is only safe
  while this holds.
- **Rate limits**: `rl:prog` 240/hr, `rl:profile` 120/hr, `rl:score`
  30/hr per session; worker per-IP via `cf-connecting-ip`; game server
  per-IP 1.5s.
- **Multiplayer**: 90s signed tickets verified server-side; move clamp
  (320px/s + slack); tags/freeze/round outcomes server-authoritative —
  clients report position only.
- **Secrets**: `.env` gitignored, never committed; Upstash creds server-
  side only — the client deliberately has no direct-Redis tier (a `VITE_`
  token would ship write access to the db that parks sign-in handoffs).
- **sw.js**: same-origin GET only; network-first for non-assets — cannot
  poison API responses or cross-origin calls.

## Operational notes

- `SESSION_SECRET` must exist on: Vercel api, Cloudflare worker (wrangler
  secret), Render game server (`render.yaml` declares all).
- Rotate the Upstash REST token — it was handled outside the repo during
  development; treat as exposed and re-issue if the conversation log left
  the machine.
- Dev fallbacks are intentional: no `UPSTASH_*` → in-memory board + dev
  secret; no `SESSION_SECRET` && `NODE_ENV!=='production'` → dev pass.
  Production paths all fail closed.
