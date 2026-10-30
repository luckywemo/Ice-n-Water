// GET /api/auth/x?next=<game url> — starts X OAuth2 (PKCE).
// The whole dance lives on THIS origin, so the iw_oauth cookie works
// even where the game's own page can't carry cookies (itch iframe).
// `next` is the game page the callback should postMessage the token to —
// validated against an allowlist, never trusted blind.
import { cors, origin, pkce, proto, rand, safeNext, setCookie } from '../_lib/xsess.js';

export default async function handler(req, res) {
  cors(res, 'GET,OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  const clientId = process.env.X_CLIENT_ID;
  const self = origin(req);
  if (!clientId) {
    return res.status(503).json({ error: 'x sign-in is not configured' });
  }

  const { verifier, challenge } = pkce();
  const state = rand();
  const next = safeNext(req.query?.next ?? '', self);
  // state.verifier.next ride in one cookie — the callback splits it back
  setCookie(res, 'iw_oauth', `${state}.${verifier}.${next}`, 600, proto(req) === 'https');

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: `${self}/api/auth/x/callback`,
    scope: 'users.read tweet.read',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });
  res.redirect(`https://x.com/i/oauth2/authorize?${params}`);
}
