// X sign-in — the app gate. The game is a static bundle that may live
// inside an itch iframe where third-party cookies die, so the session
// is an HMAC-signed bearer token, not a cookie: OAuth runs on the api
// origin in a popup, and the callback postMessages the token home.
//
//   requireAuth()  → stored token | hash handoff | gate overlay + popup
//   authHeaders()  → { Authorization: Bearer <tok> } for every api call
//   authTicket()   → 90s colyseus join ticket from /api/ticket
//   signOut()      → drop the token (re-gates next boot)

export interface XSession {
  id: string;
  handle: string;
  pfp?: string;
  exp: number; // epoch seconds
}

const TOK_KEY = 'iw_xtok';

/** api deployment origin. VITE_API_URL wins; otherwise same-origin
    ('/api' or unset → location.origin). An ABSOLUTE VITE_BOARD_URL is
    deliberately not a fallback — the board can be a different backend
    (the Cloudflare leaderboard worker) with no auth routes, and silently
    authing against it is how sign-in once landed on {"error":"not found"}.
    Empty = no api configured — dev then skips the gate entirely. */
export const API_URL = (() => {
  const env = import.meta.env.VITE_API_URL as string | undefined;
  if (env) return env.replace(/\/+$/, '');
  const board = (import.meta.env.VITE_BOARD_URL as string | undefined) ?? '';
  if (!board) return ''; // dev — no api configured anywhere
  if (board.startsWith('/api')) return location.origin;
  console.warn(
    '[xauth] VITE_API_URL is unset — auth calls will use this origin, NOT the ' +
      'configured VITE_BOARD_URL (a different backend with no auth routes). ' +
      'Set VITE_API_URL on the deploy to silence this.',
  );
  return location.origin;
})();

function decode(tok: string): XSession | null {
  try {
    const [, payload] = tok.split('.');
    const s = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
    if (typeof s.id !== 'string' || typeof s.handle !== 'string') return null;
    if (typeof s.exp !== 'number' || s.exp * 1000 < Date.now()) return null;
    return s as XSession;
  } catch {
    return null;
  }
}

let cur: XSession | null = decode(localStorage.getItem(TOK_KEY) ?? '');

export const session = () => cur;

export function authHeaders(): Record<string, string> {
  const tok = localStorage.getItem(TOK_KEY);
  return tok ? { Authorization: `Bearer ${tok}` } : {};
}

export function signOut() {
  cur = null;
  localStorage.removeItem(TOK_KEY);
}

/** short-lived room ticket for the colyseus join options */
export async function authTicket(): Promise<string | null> {
  if (!cur || !API_URL) return null;
  try {
    const r = await fetch(`${API_URL}/api/ticket`, { headers: authHeaders() });
    if (!r.ok) return null;
    return ((await r.json()) as { ticket?: string }).ticket ?? null;
  } catch {
    return null;
  }
}

/** pick up a callback handoff that landed in the url hash instead of a
    popup message (new-tab fallback path). Err strings come through as
    `err:<code>` and are surfaced on the gate overlay. */
function harvestHash(): string | null {
  const m = location.hash.match(/[#&]iw_x=([^&]+)/);
  if (!m) return null;
  const val = decodeURIComponent(m[1]);
  history.replaceState(null, '', location.pathname + location.search);
  return val;
}

/**
 * Boot gate. Resolves with the session — or never resolves and leaves
 * the connect overlay up (the gate is the point: no session, no game).
 * Dev without an api configured passes straight through.
 */
export function requireAuth(): Promise<XSession | null> {
  const handoff = harvestHash();
  if (handoff && !handoff.startsWith('err:')) {
    localStorage.setItem(TOK_KEY, handoff);
    cur = decode(handoff);
  }
  if (cur) return Promise.resolve(cur);
  if (!API_URL) {
    console.warn('[xauth] no api configured — gate open (dev)');
    return Promise.resolve(null);
  }
  return gateOverlay(handoff?.startsWith('err:') ? handoff.slice(4) : null);
}

const X_ERRORS: Record<string, string> = {
  state: 'sign-in was interrupted — try again',
  token: 'X sign-in failed — try again',
  profile: 'X could not return your profile',
  suspended: 'that X account is suspended',
  rated: 'X rate-limited the sign-in — wait a few minutes',
};

function gateOverlay(hashErr: string | null): Promise<XSession | null> {
  return new Promise((resolve) => {
    const boot = document.getElementById('boot');
    const el = boot ?? document.createElement('div');
    if (!boot) {
      el.id = 'xgate';
      el.className = 'gate';
      document.body.appendChild(el);
    }
    // a per-gate poll id — the callback parks the session under it and
    // this window redeems it, which works even when postMessage can't
    // reach us (installed PWA: OAuth ran in a separate browser context)
    const sid = crypto.randomUUID();
    const authUrl = `${API_URL}/api/auth/x?next=${encodeURIComponent(
      location.href.split('#')[0],
    )}&sid=${sid}`;
    el.innerHTML = `
      <img class="mark" src="./icon-192.png" alt="Ice 'N' Water" />
      <div class="word">ICE 'N' WATER</div>
      <div class="gate-msg">sign in with X to play</div>
      <button class="gate-btn" type="button">CONNECT X</button>
      <a class="gate-alt" href="${authUrl}" target="_blank" rel="noopener">
        popup blocked? open sign-in in a new tab</a>
      <div class="gate-err"></div>`;
    const err = el.querySelector<HTMLElement>('.gate-err')!;
    if (hashErr) err.textContent = X_ERRORS[hashErr] ?? 'sign-in failed';

    const stop = () => {
      clearInterval(poll);
      clearTimeout(to);
    };
    const finish = (tok: string) => {
      stop();
      localStorage.setItem(TOK_KEY, tok);
      cur = decode(tok);
      resolve(cur);
    };

    // the polling channel — delivers the token wherever this window lives,
    // regardless of what the auth browser does afterwards
    const poll = setInterval(() => {
      fetch(`${API_URL}/api/auth/poll?sid=${sid}`)
        .then((r) => (r.status === 200 ? r.json() : null))
        .then((d: { token?: string } | null) => d?.token && finish(d.token))
        .catch(() => {});
    }, 1500);
    const to = setTimeout(() => {
      stop();
      err.textContent = 'sign-in timed out — tap connect x to retry';
    }, 5 * 60 * 1000);

    window.addEventListener('message', (e: MessageEvent) => {
      if (e.origin !== new URL(API_URL).origin) return;
      const d = e.data as { type?: string; token?: string; error?: string };
      if (d?.type !== 'iw-x') return;
      // ack so the handoff page closes itself — without one it assumes the
      // message was lost (PWA tab has no real opener) and redirects instead
      (e.source as Window | null)?.postMessage({ type: 'iw-x-ack' }, e.origin);
      if (d.token) {
        finish(d.token);
      } else {
        err.textContent = X_ERRORS[d.error ?? ''] ?? 'sign-in failed';
      }
    });

    // a user gesture on the button opens the popup cleanly — if the
    // browser still blocks it the alt link underneath does the same
    // job in a full tab (the callback redirects back with the token)
    el.querySelector<HTMLButtonElement>('.gate-btn')!.addEventListener('click', () => {
      window.open(authUrl, 'iwx', 'popup,width=560,height=720');
    });
  });
}
