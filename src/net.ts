// Where the game server lives.
//  - VITE_SERVER_URL set → deployed server (auto-converts https→wss, http→ws)
//  - otherwise → same host that served the page, port 2567.
//    A phone on your Wi-Fi loading http://192.168.x.x:5173 automatically
//    talks to ws://192.168.x.x:2567 — zero-config LAN play.
export const SERVER_URL = (() => {
  const env = import.meta.env.VITE_SERVER_URL as string | undefined;
  if (env) {
    if (env.startsWith('https://')) return 'wss://' + env.slice(8);
    if (env.startsWith('http://')) return 'ws://' + env.slice(7);
    return env; // already ws:// or wss://
  }
  const secure = typeof location !== 'undefined' && location.protocol === 'https:';
  const host = typeof location !== 'undefined' ? location.hostname : 'localhost';
  return `${secure ? 'wss' : 'ws'}://${host}:2567`;
})();
