<p align="center">
  <img src="logo.png" alt="Ice 'N' Water — The Road North" width="640"/>
</p>

<p align="center">
  <b>The Nigerian childhood chase game, digitized.</b><br/>
  Ice &amp; Water — a 500-level journey from Lagos to Maiduguri
</p>

<p align="center">
  <a href="https://luckywemo.itch.io/ice-n-water">▶ Play on itch.io</a>
</p>

---

## The game

**Ice 'N' Water** brings the street chase every Nigerian kid grew up with to the
browser: runners scatter, the militia chase, and a single touch freezes you —
until a teammate's tap melts you back in.

- **Adventure — a 500-level campaign.** The Road North runs through 50
  real Nigerian towns. Lagos Island → Oshodi → Ibadan → Abuja → Kano →
  Maiduguri. Fog hides the road ahead; every milestone burns it off. Earn
  up to 3 stars per level and climb the global leaderboard.
- **Online multiplayer.** 4-digit room codes, server-authoritative rounds
  (Colyseus), up to 10 players — ice freezes water, mates thaw the frozen.
- **Nigerian voice acting.** YarnGPT-generated lines — "UP NEPA!", "I dey
  come!", "Dem don catch am!" — plus danfo, rain and NEPA random events.
- **Mobile + desktop.** Touch joystick, responsive layout, gamepad-friendly.

## Tech

| Layer | Stack |
|---|---|
| Game | TypeScript · Phaser 3 (Arcade Physics) · Vite |
| Multiplayer | Colyseus (`server/`) |
| Leaderboard | Upstash Redis behind a serverless proxy — `api/` (Vercel) or `worker/` (Cloudflare), zero secrets in the client |
| Voices | YarnGPT (regenerate via `gen-voices.mjs`) |

## Run it

```bash
npm install
npm run dev        # http://localhost:5173  (#adventure or #lobby to jump scenes)
npm run build      # production bundle → dist/
npm run zip        # flat itch.io archive
```

## Deploy

- **Leaderboard API:** deploy `api/` via Vercel (set `UPSTASH_REST_URL` +
  `UPSTASH_REST_TOKEN`, and `VITE_BOARD_URL=/api`) **or** the Cloudflare
  Worker in `worker/` (`wrangler deploy` + `wrangler secret put` the same
  two vars, then `VITE_BOARD_URL=https://<worker>.workers.dev`).
- **Multiplayer:** deploy `server/` to any Node host (Render-ready:
  `render.yaml`), then set `VITE_SERVER_URL`.
- Full env reference: `.env.production.example`.

## Credits

Built with [Devin](https://devin.ai). Voices by YarnGPT. For every kid who
ever yelled "ICE!" in the streets of Lagos.
