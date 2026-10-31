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

(async () => {
  const { default: WebSocket } = await import('ws');
  const sock = new WebSocket(await wsUrl());
  await new Promise((r) => sock.on('open', r));
  await send(sock, 'Page.enable');
  const errs = [];
  sock.on('message', (m) => {
    const d = JSON.parse(m);
    if (d.method === 'Runtime.exceptionThrown' || d.method === 'Log.entryAdded')
      errs.push(JSON.stringify(d.params).slice(0, 400));
  });
  await send(sock, 'Runtime.enable');
  await send(sock, 'Log.enable');

  console.log('cd:', await evalJs(sock, `__m ? __m.cd : 'no match'`));
  console.log('timeLeft:', await evalJs(sock, `__m ? __m.timeLeft : '-'`));
  await sleep(1500);
  console.log('cd again:', await evalJs(sock, `__m ? __m.cd : 'no match'`));
  console.log('console errors:', errs.length ? errs.join('\n') : 'none');
  process.exit(0);
})();
