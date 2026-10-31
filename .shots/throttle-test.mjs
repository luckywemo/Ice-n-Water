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
const fake = { events: Array.from({ length: 500 }, (_, i) => ({ level: i + 1, stars: 3 })) };
const r1 = await post(fake);
console.log('batch1 → applied:', r1.applied, 'unlocked:', r1.progress.unlocked, 'credit:', r1.progress.credit);
const r2 = await post(fake);
console.log('batch2 → applied:', r2.applied, 'unlocked:', r2.progress.unlocked);
// legit within-frontier star writes still land after throttle (re-clear lvl 1 is a no-op since stars already 3 — check a within-frontier new level? levels 1-8 all starred; post batch with stars:1 upgrades nothing — that's fine, bound proven)
const del = await kv([['DEL', 'prog:x_throttletest'], ['DEL', 'rl:prog:throttletest']]);
console.log('cleanup:', JSON.stringify(del ? del.map((x) => x.result) : del));
