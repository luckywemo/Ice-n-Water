// probe the drop→game handoff: scene statuses + any exceptions
const CDP = 'http://localhost:9222';
async function wsUrl() {
  const list = await (await fetch(CDP + '/json/list')).json();
  const page = list.find((t) => t.type === 'page' && t.url.includes('localhost:5199'));
  return page.webSocketDebuggerUrl;
}
const send = (sock, method, params = {}) => new Promise((res) => {
  const id = ++send.id;
  sock.send(JSON.stringify({ id, method, params }));
  sock.on('message', function h(m) { const d = JSON.parse(m); if (d.id === id) { sock.off('message', h); res(d.result); } });
});
send.id = 0;
const evalJs = (sock, expr) =>
  send(sock, 'Runtime.evaluate', { expression: expr, returnByValue: true }).then((r) => r?.result?.value ?? JSON.stringify(r));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const SCENES = `JSON.stringify((window.__game?.scene?.getScenes(true) ?? []).map(s => s.scene.key + ':' + s.sys.settings.status))`;
const DROP = `(() => { const s = window.__game?.scene?.getScene('drop'); return s ? JSON.stringify({gone: s.gone, t: Math.round(s.time.now)}) : 'no drop'; })()`;
const GAME = `(() => { const s = window.__game?.scene?.getScene('game'); return s ? JSON.stringify({status: s.sys.settings.status, transitioning: s.transitioning, paused: s.paused, mask: !!s.cameras.main.mask}) : 'no game'; })()`;

(async () => {
  const { default: WebSocket } = await import('ws');
  const sock = new WebSocket(await wsUrl());
  await new Promise((r) => sock.on('open', r));
  const errs = [];
  sock.on('message', (m) => {
    const d = JSON.parse(m);
    if (d.method === 'Runtime.exceptionThrown')
      errs.push('EXC: ' + JSON.stringify(d.params.exceptionDetails?.exception?.description ?? d.params).slice(0, 600));
    if (d.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(d.params.type))
      errs.push(d.params.type.toUpperCase() + ': ' + d.params.args.map(a => a.value ?? a.description ?? '').join(' ').slice(0, 400));
    if (d.method === 'Log.entryAdded' && d.params.entry.level === 'error')
      errs.push('LOG: ' + (d.params.entry.text ?? '').slice(0, 400));
  });
  await send(sock, 'Runtime.enable');
  await send(sock, 'Log.enable');
  await send(sock, 'Page.enable');

  for (let i = 0; i < 6; i++) {
    console.log(`--- t+${i * 2}s`);
    console.log('scenes:', await evalJs(sock, SCENES));
    console.log('drop:', await evalJs(sock, DROP));
    console.log('game:', await evalJs(sock, GAME));
    await sleep(2000);
  }
  console.log('errors:', errs.length ? errs.join('\n') : 'none');
  process.exit(0);
})();
