// shot.mjs + real CDP mouse clicks — CLICKS="x,y;x,y" fires each after waitMs.
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const [url, out, waitMs = '6000', w = '1280', h = '800', preJs = '', dsf = '1'] = process.argv.slice(2);
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9334;

const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--hide-scrollbars',
  `--remote-debugging-port=${PORT}`,
  `--window-size=${w},${h}`,
  '--no-first-run', '--user-data-dir=C:/Users/LOYAL/Documents/Ice-n-Water/.shots/.profile',
  'about:blank',
], { stdio: 'ignore' });

try {
  let targets;
  for (let i = 0; i < 30; i++) {
    await sleep(400);
    try {
      targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      if (targets?.length) break;
    } catch {}
  }
  const page = targets.find((t) => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  const send = (method, params = {}) =>
    new Promise((res, rej) => {
      const mid = ++id;
      pending.set(mid, { res, rej });
      ws.send(JSON.stringify({ id: mid, method, params }));
    });
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      pending.get(m.id).res(m.result ?? m.error);
      pending.delete(m.id);
    }
  };
  await new Promise((r) => (ws.onopen = r));
  await send('Page.enable');
  await send('Runtime.enable');
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.method === 'Runtime.consoleAPICalled' && ['warning', 'error'].includes(m.params.type)) {
      console.log('[console]', m.params.type, m.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 300));
    }
  });
  if (preJs) await send('Page.addScriptToEvaluateOnNewDocument', { source: preJs });
  await send('Emulation.setDeviceMetricsOverride', {
    width: +w, height: +h, deviceScaleFactor: +dsf, mobile: +h > +w,
  });
  await send('Page.navigate', { url });
  await sleep(+waitMs);

  const clicks = (process.env.CLICKS || '').split(';').filter(Boolean);
  for (const c of clicks) {
    const [x, y] = c.split(',').map(Number);
    for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
      await send('Input.dispatchMouseEvent', {
        type, x, y, button: 'left', clickCount: 1,
        ...(type === 'mouseMoved' ? { buttons: 0 } : {}),
      });
    }
    await sleep(+(process.env.CLICK_WAIT || 2500)); // RAF-throttled tweens need wall-time
  }

  if (process.env.EVAL) {
    const r = await send('Runtime.evaluate', { expression: process.env.EVAL, returnByValue: true, awaitPromise: true });
    console.log('[eval]', JSON.stringify(r.result?.value ?? r));
  }

  const shot = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(out, Buffer.from(shot.data, 'base64'));
  console.log('saved', out);
  ws.close();
} finally {
  chrome.kill('SIGKILL');
}
