// smoke-test the auth endpoints without a deploy — mock req/res,
// mint real tokens via the lib, hit every handler.
//   node api/smoke.test.mjs
process.env.SESSION_SECRET = 'test-secret-32-bytes-of-entropy-xxxx';
process.env.X_CLIENT_ID = 'test-client-id';
delete process.env.UPSTASH_REST_URL; // board/score will 500 on redis — fine,
process.env.UPSTASH_REST_TOKEN = ''; // we only assert auth reached the data layer

const { issueToken, verifyBlob, sessionFrom, safeNext } = await import('../api/_lib/xsess.js');
const me = (await import('../api/me.js')).default;
const ticket = (await import('../api/ticket.js')).default;
const board = (await import('../api/board.js')).default;
const score = (await import('../api/score.js')).default;
const startX = (await import('../api/auth/x.js')).default;
const callback = (await import('../api/auth/x/callback.js')).default;

let pass = 0, fail = 0;
const ok = (name, cond) => (cond ? ++pass : ++fail, console.log(`${cond ? 'ok' : 'FAIL'}  ${name}`));

function mockReq({ method = 'GET', headers = {}, query = {}, body = {} } = {}) {
  return { method, headers, query, body };
}
function mockRes() {
  const r = {
    _code: 0, _json: null, _html: null, _redirect: null, _cookies: {},
    headers: {},
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    status(c) { this._code = c; return this; },
    json(j) { this._json = j; return this; },
    end(h) { this._html = typeof h === 'string' ? h : null; return this; },
    redirect(u) { this._redirect = u; return this; },
  };
  const origSet = r.setHeader.bind(r);
  r.setHeader = (k, v) => {
    if (k === 'Set-Cookie') { r._cookies[v.split('=')[0]] = v; }
    origSet(k, v);
  };
  return r;
}

const HDRS = { 'x-forwarded-proto': 'https', host: 'api.test' };

// ── lib roundtrip ──
const tok = issueToken({ id: '42', handle: 'tester', pfp: 'p' });
ok('token round-trips', verifyBlob(tok)?.handle === 'tester');
ok('garbage token rejected', verifyBlob('v1.bm9wZQ.sig') === null);
ok('forged sig rejected', verifyBlob(tok.slice(0, -1) + 'x') === null);
const { signPayload } = await import('../api/_lib/xsess.js');
const expired = signPayload({ id: '1', handle: 'x', iat: 1, exp: 1 }); // real sig, dead clock
ok('expired token rejected', verifyBlob(expired) === null);

// ── next validation ──
ok('itch origin allowed', safeNext('https://html-classic.itch.zone/html/1/index.html', 'https://api.test') !== '');
ok('localhost allowed', safeNext('http://localhost:5173/', 'https://api.test') !== '');
ok('evil origin rejected', safeNext('https://evil.com/x', 'https://api.test') === '');
ok('garbage rejected', safeNext('not-a-url', 'https://api.test') === '');

// ── /api/me ──
let r = mockRes();
await me(mockReq({ headers: HDRS }), r);
ok('me: no token → 401', r._code === 401);
r = mockRes();
await me(mockReq({ headers: { ...HDRS, authorization: `Bearer ${tok}` } }), r);
ok('me: valid → 200 + handle', r._code === 200 && r._json.x.handle === 'tester');

// ── /api/ticket ──
r = mockRes();
await ticket(mockReq({ headers: HDRS }), r);
ok('ticket: no token → 401', r._code === 401);
r = mockRes();
await ticket(mockReq({ headers: { ...HDRS, authorization: `Bearer ${tok}` } }), r);
ok('ticket: valid → 200 + verifies', r._code === 200 && verifyBlob(r._json.ticket)?.id === '42');

// ── /api/board ──
r = mockRes();
await board(mockReq({ headers: HDRS }), r);
ok('board: no token → 401', r._code === 401);
r = mockRes();
await board(mockReq({ headers: { ...HDRS, authorization: `Bearer ${tok}` }, query: { me: 'forged-id' } }), r);
ok('board: valid → 500 (redis unset — auth passed, reached data layer)', r._code === 500);

// ── /api/score ──
r = mockRes();
await score(mockReq({ method: 'POST', headers: HDRS, body: { id: 'evil', level: 999, stars: 2999 } }), r);
ok('score: no token → 401', r._code === 401);

// ── oauth start ──
r = mockRes();
await startX(mockReq({ headers: HDRS, query: { next: 'https://evil.com' } }), r);
ok('auth start → 302 to x.com', (r._redirect ?? '').startsWith('https://x.com/i/oauth2/authorize'));
ok('auth start sets iw_oauth', 'iw_oauth' in r._cookies);
const evilNext = r._cookies.iw_oauth?.split('.').pop();
ok('evil next not stored', evilNext === '' || !evilNext?.includes('evil.com'));

// ── oauth callback: bad state must fail, not throw ──
r = mockRes();
await callback(mockReq({ headers: { ...HDRS, cookie: 'iw_oauth=otherstate.verifier.' }, query: { code: 'c', state: 'wrong' } }), r);
ok('callback: bad state → error page (not a hang)', r._html?.includes('sign-in failed'));
r = mockRes();
await callback(mockReq({ headers: HDRS, query: { code: 'c', state: 's' } }), r);
ok('callback: no pending cookie → error page', r._html?.includes('sign-in failed'));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
