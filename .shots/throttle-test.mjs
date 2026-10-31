process.loadEnvFile('.env');
const { signPayload, kv } = await import('../api/_lib/xsess.js');
const handler = (await import('../api/progress.js')).default;
const tok = 'Bearer ' + signPayload({ id: 'throttletest', handle: 't', exp: 9e9 });
const res = () => {
  const r = { out: null, setHeader() {}, status() { return r; }, json(o) { r.out = o; return r; }, end() { return r; } };
  return r;
};
const post = async (body) => {
  const r = res();
  await handler({ method: 'POST', headers: { authorization: tok }, body }, r);
  return r.out;
};

// 1) the classic forge — 500 fake events, no tickets
const fake = { events: Array.from({ length: 500 }, (_, i) => ({ level: i + 1, stars: 3 })) };
const r1 = await post(fake);
console.log('unticketed 500-batch → applied:', r1.applied, 'denied:', r1.denied, 'unlocked:', r1.progress.unlocked, 'dayTk:', r1.progress.dayTk);

// 2) mint a real run ticket, wait real time, clear attested
const mint = await post({ start: 6 });
console.log('mint lvl-6 ticket →', mint.ticket ? 'issued' : mint);
if (mint.ticket) {
  console.log('waiting 36s for elapsed…');
  await new Promise((r) => setTimeout(r, 36_000));
  const r2 = await post({ clearedLevel: 6, stars: 3, ticket: mint.ticket });
  console.log('attested clear → applied:', r2.applied, 'unlocked:', r2.progress.unlocked, 'dayTk:', r2.progress.dayTk, 'dayAdv:', r2.progress.dayAdv);
}

// 3) server-minted ticket with old t0 (what an offline-for-days clear looks like)
const oldTicket = signPayload({ id: 'throttletest', lvl: 7, t0: Date.now() - 3 * 3600_000, exp: Math.floor(Date.now() / 1000) + 3600 });
const r3 = await post({ clearedLevel: 7, stars: 2, ticket: oldTicket });
console.log('old-ticket clear → applied:', r3.applied, 'unlocked:', r3.progress.unlocked);

// 4) unticketed beyond the daily slot → refused
const r4 = await post({ clearedLevel: 8, stars: 3 });
console.log('unticketed over slot → applied:', r4.applied, 'denied:', r4.denied, 'unlocked:', r4.progress.unlocked);

// 5) a ticket for the WRONG level → not attested
const wrong = signPayload({ id: 'throttletest', lvl: 99, t0: Date.now() - 3600_000, exp: Math.floor(Date.now() / 1000) + 3600 });
const r5 = await post({ clearedLevel: 8, stars: 3, ticket: wrong });
console.log('wrong-level ticket → applied:', r5.applied, 'denied:', r5.denied, 'unlocked:', r5.progress.unlocked);

const del = await kv([['DEL', 'prog:x_throttletest'], ['DEL', 'rl:prog:throttletest']]);
console.log('cleanup:', JSON.stringify(del ? del.map((x) => x.result) : del));
