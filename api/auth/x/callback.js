// GET /api/auth/x/callback — finishes OAuth, mints the signed session,
// and hands it to the game window.
//
// Handoff is postMessage, not a redirect: the game may live inside an
// itch iframe where its own page can carry no cookie and its URL can't
// receive the callback. The game opened this window — opener.postMessage
// crosses origins legally and lands the token in the frame that asked.
// A blocked-popup / direct-visit fallback renders a return link that
// carries the token in the URL hash (never hits logs or referers).
import {
  cors,
  issueToken,
  kv,
  origin,
  proto,
  readCookie,
  setCookie,
} from '../../_lib/xsess.js';

export default async function handler(req, res) {
  cors(res, 'GET,OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  const self = origin(req);
  const out = (page) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(page);
  };
  const fail = (why, next) => out(handoff(null, why, next));

  const code = req.query?.code;
  const state = req.query?.state;
  const pending = readCookie(req, 'iw_oauth');
  setCookie(res, 'iw_oauth', '', 0, proto(req) === 'https'); // single-use, burn it now
  if (!code || !state || !pending) return fail('state', '');

  // cookie is state.verifier[.sid].next — a uuid-shaped third field is
  // the poll id, everything after it is the return url (urls have dots)
  const [expectedState, verifier, ...rest] = pending.split('.');
  const sid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(rest[0] ?? '') ? rest.shift() : '';
  const next = rest.join('.');
  if (state !== expectedState || !verifier) return fail('state', next);

  const body = new URLSearchParams({
    code,
    grant_type: 'authorization_code',
    redirect_uri: `${self}/api/auth/x/callback`,
    code_verifier: verifier,
    client_id: process.env.X_CLIENT_ID ?? '',
  });
  const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
  if (process.env.X_CLIENT_SECRET) {
    headers.Authorization = `Basic ${Buffer.from(
      `${process.env.X_CLIENT_ID}:${process.env.X_CLIENT_SECRET}`,
    ).toString('base64')}`;
  }
  const tokenRes = await fetch('https://api.x.com/2/oauth2/token', {
    method: 'POST',
    headers,
    body,
  });
  if (!tokenRes.ok) {
    console.error('[x-auth] token exchange failed:', tokenRes.status);
    return fail('token', next);
  }
  const token = await tokenRes.json();
  if (!token.access_token) return fail('token', next);

  const me = await fetch(
    'https://api.x.com/2/users/me?user.fields=profile_image_url,created_at,public_metrics',
    { headers: { Authorization: `Bearer ${token.access_token}` } },
  );
  if (!me.ok) {
    console.error('[x-auth] /2/users/me failed:', me.status);
    return fail(me.status === 404 ? 'suspended' : me.status === 429 ? 'rated' : 'profile', next);
  }
  const user = await me.json();
  if (!user.data) return fail('profile', next);

  const session = issueToken({
    id: user.data.id,
    handle: user.data.username,
    pfp: user.data.profile_image_url?.replace(/_normal(\.\w+)$/, '_400x400$1'),
    createdAt: user.data.created_at,
    tweets: user.data.public_metrics?.tweet_count ?? 0,
  });
  // park it for the polling game window too — postMessage only reaches a
  // same-process opener, an installed PWA's browser tab is not that
  if (sid) {
    try {
      await kv([['SET', `xhs:${sid}`, session, 'EX', 300]]);
    } catch (e) {
      console.error('[x-auth] handoff park failed:', e);
    }
  }
  return out(handoff(session, null, next));
}

/** the handoff page: postMessage to the opener when there is one,
 *  otherwise a plain link home. error rides the same message so the
 *  gate overlay can say what happened instead of looking dead. */
function handoff(token, error, next) {
  const payload = token ? { type: 'iw-x', token } : { type: 'iw-x', error };
  // '' target = no postMessage at all — a window opened by a hostile page
  // (no valid `next` in the cookie) must NOT receive the token: '*' would
  // hand the session to whatever opened the popup. The game always sends a
  // validated next; PWAs redeem through the sid poll, not postMessage.
  let target = '';
  let back = '';
  try {
    if (next) {
      target = new URL(next).origin;
      back = `${next.split('#')[0]}#iw_x=${token ?? `err:${error}`}`;
    }
  } catch {
    /* a forged iw_oauth cookie lands here — blank target, link still works */
  }
  const msg = token
    ? 'signed in — you can close this tab'
    : `sign-in failed (${error ?? 'unknown'}) — you can close this tab`;
  // handoff mechanics: postMessage to the opener, then wait for the game
  // to ack receipt. An installed-PWA sign-in opens this page in a browser
  // context with no usable opener — postMessage lands nowhere and (the
  // old bug) the tab closed before the url redirect could carry the
  // token home. So: ack → close; no ack → redirect with the token in the
  // hash, which the game harvests on boot wherever it lands.
  const script = `<script>
var P=${JSON.stringify(payload)},T=${JSON.stringify(target)},B=${JSON.stringify(back || '')};
try{T&&window.opener&&window.opener.postMessage(P,T)}catch(e){}
var ok=0;addEventListener('message',function(e){if(e.data&&e.data.type==='iw-x-ack'){ok=1;window.close()}});
setTimeout(function(){if(!ok)B?location.href=B:(window.opener&&window.close())},900);
<\/script>`;
  return `<!doctype html><meta charset="utf-8"><title>ice 'n' water</title>
<body style="margin:0;background:#f7bd14;display:flex;min-height:100vh;align-items:center;justify-content:center;font-family:sans-serif">
<div style="text-align:center;max-width:320px">
<p style="font-weight:700;color:#0d3550">${msg}</p>
${back ? `<p><a href="${back}" style="color:#0d3550;font-weight:700">tap here to return to the game</a></p>` : ''}
</div>
${script}
</body>`;
}
