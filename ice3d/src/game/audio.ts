// audio: WebAudio synth sfx + crowd ambience + tiny afrobeat loop + voice mp3s
import { pick, rand, store } from './util';

let ctx: AudioContext | null = null;
let master: GainNode, sfxBus: GainNode, musBus: GainNode;
let started = false;

export const sfxOn = () => store.get('sfx', true);
export const musicOn = () => store.get('music', true);
export const setSfx = (v: boolean) => { store.set('sfx', v); if (sfxBus) sfxBus.gain.value = v ? 1 : 0; };
export const setMusic = (v: boolean) => { store.set('music', v); if (musBus) musBus.gain.value = v ? .8 : 0; };

function ac() {
  if (!ctx) {
    ctx = new AudioContext();
    master = ctx.createGain(); master.gain.value = .9; master.connect(ctx.destination);
    sfxBus = ctx.createGain(); sfxBus.gain.value = sfxOn() ? 1 : 0; sfxBus.connect(master);
    musBus = ctx.createGain(); musBus.gain.value = musicOn() ? .8 : 0; musBus.connect(master);
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function osc(type: OscillatorType, f0: number, f1: number, t: number, dur: number, gain = .2, bus = sfxBus) {
  const c = ac();
  const o = c.createOscillator(), g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(.001, t + dur);
  o.connect(g); g.connect(bus);
  o.start(t); o.stop(t + dur + .02);
}

function noise(t: number, dur: number, gain: number, freq: number, q = 1) {
  const c = ac();
  const len = Math.max(1, c.sampleRate * dur);
  const buf = c.createBuffer(1, len, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  const src = c.createBufferSource(); src.buffer = buf;
  const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
  const g = c.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(.001, t + dur);
  src.connect(f); f.connect(g); g.connect(sfxBus);
  src.start(t); src.stop(t + dur + .02);
}

// ---------- sfx ----------
export const sWhistle = () => { const t = ac().currentTime; for (let i = 0; i < 3; i++) { osc('square', 2400, 2400, t + i * .09, .07, .12); osc('square', 2600, 2600, t + i * .09, .07, .08); } };
export const sTag = () => { const t = ac().currentTime; osc('sawtooth', 500, 140, t, .16, .22); noise(t, .1, .15, 900, 2); };
export const sFreeze = () => { const t = ac().currentTime; [880, 660, 440].forEach((f, i) => osc('triangle', f, f * .8, t + i * .07, .18, .2)); noise(t, .3, .1, 3200, 4); };
export const sThaw = () => { const t = ac().currentTime; [440, 660, 880, 1180].forEach((f, i) => osc('triangle', f, f * 1.3, t + i * .05, .12, .16)); };
export const sJump = () => { const t = ac().currentTime; osc('sine', 300, 620, t, .14, .14); };
export const sLand = () => { const t = ac().currentTime; noise(t, .08, .12, 300, 1); };
export const sWin = () => { const t = ac().currentTime; [523, 659, 784, 1046].forEach((f, i) => osc('triangle', f, f, t + i * .12, .3, .2)); };
export const sLose = () => { const t = ac().currentTime; [392, 330, 262].forEach((f, i) => osc('triangle', f, f * .94, t + i * .16, .34, .2)); };
export const sCount = (final: boolean) => { const t = ac().currentTime; osc('square', final ? 880 : 620, final ? 880 : 620, t, final ? .4 : .12, .14); };
export const sTick = () => { const t = ac().currentTime; osc('sine', 1200, 1200, t, .05, .07); };

// ---------- crowd ambience: filtered murmur ----------
let crowdSrc: AudioBufferSourceNode | null = null;
export function startCrowd() {
  const c = ac();
  if (crowdSrc) return;
  const len = c.sampleRate * 3;
  const buf = c.createBuffer(1, len, c.sampleRate);
  const d = buf.getChannelData(0);
  let v = 0;
  for (let i = 0; i < len; i++) { v += (Math.random() * 2 - 1) * .06; v *= .985; d[i] = v; }
  crowdSrc = c.createBufferSource(); crowdSrc.buffer = buf; crowdSrc.loop = true;
  const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 500; f.Q.value = .5;
  const g = c.createGain(); g.gain.value = .55;
  const lfo = c.createOscillator(); lfo.frequency.value = .13;
  const lg = c.createGain(); lg.gain.value = .12;
  lfo.connect(lg); lg.connect(g.gain);
  crowdSrc.connect(f); f.connect(g); g.connect(sfxBus);
  crowdSrc.start(); lfo.start();
}
export function crowdCheer() {
  const t = ac().currentTime;
  for (let i = 0; i < 5; i++) noise(t + i * .06, .5, .12, 800 + i * 200, .8);
  osc('triangle', 600, 900, t, .4, .06);
}
// the "oooOOOH!" when a tag just misses — falling crowd gasp
export function crowdOoh() {
  const t = ac().currentTime;
  for (let i = 0; i < 4; i++) noise(t + i * .05, .45, .09, 1400 - i * 260, 1.4);
  osc('triangle', 700, 380, t, .5, .08);
}

// ---------- tiny afrobeat-ish loop (kick/hat/shaker + marimba riff) ----------
let musTimer: ReturnType<typeof setInterval> | null = null;
let step = 0;
const RIFF = [0, -1, 3, -1, 5, -1, 3, -1, 7, -1, 5, 3, -1, 2, 0, -1]; // -1 = rest
const SCALE = [261.6, 293.7, 329.6, 392, 440, 523.3, 587.3, 659.3];
export function startMusic() {
  const c = ac();
  if (musTimer || !musicOn()) { if (!musicOn()) startMusicAlways(); return; }
  startMusicAlways();
}
function startMusicAlways() {
  const c = ac();
  if (musTimer) return;
  const spb = 60 / 104 / 2; // 104bpm eighth notes
  let next = c.currentTime + .1;
  musTimer = setInterval(() => {
    while (next < c.currentTime + .3) {
      const s = step % 16;
      const t = next - c.currentTime;
      // kick on quarters
      if (s % 4 === 0) osc('sine', 140, 40, c.currentTime + t, .18, .5, musBus);
      // hat offbeats
      if (s % 2 === 1) { const h = c.currentTime + t; hat(h); }
      // shaker 16ths-ish
      if (s % 4 === 2) hat(c.currentTime + t, .05, 5200);
      // marimba riff
      const r = RIFF[s];
      if (r >= 0) {
        const f = SCALE[r];
        osc('sine', f, f, c.currentTime + t, .22, .16, musBus);
        osc('sine', f * 2, f * 2, c.currentTime + t, .1, .05, musBus);
      }
      step++;
      next += spb;
    }
  }, 80);
}
function hat(t: number, g = .08, f = 7000) {
  const c = ac();
  const len = c.sampleRate * .05;
  const buf = c.createBuffer(1, len, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  const src = c.createBufferSource(); src.buffer = buf;
  const fl = c.createBiquadFilter(); fl.type = 'highpass'; fl.frequency.value = f;
  const gn = c.createGain();
  gn.gain.setValueAtTime(g, t);
  gn.gain.exponentialRampToValueAtTime(.001, t + .05);
  src.connect(fl); fl.connect(gn); gn.connect(musBus);
  src.start(t); src.stop(t + .06);
}
export function stopMusic() { if (musTimer) { clearInterval(musTimer); musTimer = null; } }

// ---------- voice lines ----------
const V = (n: string) => `voice/voice-${n}.mp3`;
const LINES = {
  frozen: ['wahala', 'dem-don-catch', 'ez-who-touch'],
  taggedByMe: ['gotcha', 'i-go-catch-you', 'one-down'],
  rescue: ['i-dey-come', 'heey-come-back'],
  taunt: ['you-can-run', 'no-hiding', 'come-back-here'],
  free: ['dem-don-free'],
};
const audioCache = new Map<string, HTMLAudioElement>();
function voice(name: string) {
  if (!sfxOn()) return;
  let a = audioCache.get(name);
  if (!a) { a = new Audio(V(name)); audioCache.set(name, a); }
  try {
    a.pause(); a.currentTime = 0;
    a.playbackRate = rand(.95, 1.1);
    a.volume = .9;
    void a.play().catch(() => {});
  } catch { /* ignore */ }
}
export const vFrozen = () => voice(pick(LINES.frozen));
export const vTagged = () => voice(pick(LINES.taggedByMe));
export const vRescue = () => voice(pick(LINES.rescue));
export const vTaunt = () => voice(pick(LINES.taunt));
export const vFree = () => voice(pick(LINES.free));
export const vNepa = () => voice('ez-nepa');
export const vUpNepa = () => voice('ez-up-nepa');
export const vRain = () => voice('ez-rain');
export const vBackup = () => voice('reinforcements');
export const vDismiss = () => voice('ez-ah-how'); // the coward's answer to COME SAVE ME
export const vEnterCell = () => voice('enter-cell');

export function unlockAudio() { ac(); }
export function initAudio() { setSfx(sfxOn()); if (musicOn()) startMusic(); }
