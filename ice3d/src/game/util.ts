// math + misc helpers
export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const rand = (a = 1, b?: number) => (b === undefined ? Math.random() * a : a + Math.random() * (b - a));
export const randInt = (a: number, b: number) => Math.floor(rand(a, b + 1));
export const pick = <T>(arr: T[]) => arr[Math.floor(Math.random() * arr.length)];
export const dist2 = (ax: number, az: number, bx: number, bz: number) => {
  const dx = ax - bx, dz = az - bz;
  return dx * dx + dz * dz;
};
export const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

export const store = {
  get<T>(k: string, d: T): T {
    try { const v = localStorage.getItem('iw3d-' + k); return v === null ? d : JSON.parse(v); }
    catch { return d; }
  },
  set(k: string, v: unknown) { try { localStorage.setItem('iw3d-' + k, JSON.stringify(v)); } catch { /* private mode */ } },
};

/** simple canvas texture painter */
export function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d')!;
  draw(g);
  return c;
}
