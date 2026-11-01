// Procedural sound — every SFX + the background groove is synthesized
// with Web Audio at runtime, so the game ships zero audio files.

export class Sfx {
  private static _inst: Sfx;
  static get inst(): Sfx {
    return (this._inst ??= new Sfx());
  }

  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private musicTimer: number | null = null;
  private lastVoiceAt = 0;
  private voicePick: SpeechSynthesisVoice | null = null;
  private voiceBufs = new Map<string, AudioBuffer>();
  private voiceBusy = false;
  private muted = localStorage.getItem('icenwater_muted') === '1';

  get isMuted() {
    return this.muted;
  }

  /** master-bus mute — covers synth sfx, the groove, voice files + browser TTS */
  toggleMute(): boolean {
    this.muted = !this.muted;
    localStorage.setItem('icenwater_muted', this.muted ? '1' : '0');
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.5;
    if (this.muted && typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
    return this.muted;
  }

  // recorded en-NG neural voices, fetched on demand — two speakers:
  //   Abeo (male)  = the militia captain — barks, taunts, capture calls
  //   Ezinne (female) = player cries ("AH! HOW?!") + the announcer (DANFO/NEPA/RAIN)
  private static readonly VOICE_FILES: Record<string, string> = {
    'I go catch you!': 'voice-i-go-catch-you',
    'COME BACK HERE!': 'voice-come-back-here',
    'You can run but...': 'voice-you-can-run',
    'Wahala for you!': 'voice-wahala',
    'I dey come o!': 'voice-i-dey-come',
    'No hiding today!': 'voice-no-hiding',
    'ONE DOWN!': 'voice-one-down',
    'Dem don catch you!': 'voice-dem-don-catch',
    'Gotcha!': 'voice-gotcha',
    // Ezinne (en-NG, female) — player cries + the announcer
    'AH! HOW?!': 'voice-ez-ah-how',
    'WHO TOUCH YOU?!': 'voice-ez-who-touch',
    'You get luck today!': 'voice-get-luck',
    'Arrgh!': 'voice-ez-arrgh',
    'DANFO!': 'voice-ez-danfo',
    'NEPA DON TAKE LIGHT!': 'voice-ez-nepa',
    'UP NEPA!': 'voice-ez-up-nepa',
    'RAIN': 'voice-ez-rain',
    'MILITIA REINFORCEMENTS!': 'voice-reinforcements',
  };

  /** Call from any user gesture (keydown/pointer) — browsers block audio before that. */
  ensure() {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.5;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  private tone(type: OscillatorType, f0: number, f1: number, dur: number, vol: number, delay = 0) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private noise(
    dur: number,
    vol: number,
    f0 = 2000,
    f1 = 400,
    delay = 0,
    type: BiquadFilterType = 'lowpass',
  ) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + delay;
    const len = Math.max(1, Math.floor(this.ctx.sampleRate * dur));
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const flt = this.ctx.createBiquadFilter();
    flt.type = type;
    flt.frequency.setValueAtTime(f0, t);
    flt.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(flt).connect(g).connect(this.master);
    src.start(t);
  }

  // ---------- game SFX ----------

  /** Referee whistle — match start */
  whistle() {
    this.tone('square', 2300, 2400, 0.13, 0.14);
    this.tone('square', 2300, 2400, 0.13, 0.14, 0.18);
    this.tone('square', 2700, 2700, 0.4, 0.16, 0.36);
  }

  shortWhistle() {
    this.tone('square', 2600, 2600, 0.2, 0.15);
  }

  tick() {
    this.tone('sine', 880, 880, 0.07, 0.18);
  }

  /** Ice shimmer — someone got frozen */
  freeze() {
    this.tone('sine', 1400, 2700, 0.18, 0.18);
    this.noise(0.25, 0.1, 4500, 8000, 0, 'highpass');
    this.tone('sine', 700, 350, 0.25, 0.12, 0.02);
  }

  /** Splash — a rescue */
  thaw() {
    this.noise(0.3, 0.22, 3200, 450);
    this.tone('sine', 480, 950, 0.16, 0.14, 0.04);
  }

  pickup() {
    this.tone('square', 620, 990, 0.09, 0.11);
    this.tone('square', 990, 1240, 0.08, 0.09, 0.07);
  }

  /** Juju charm blocks a tag */
  charm() {
    this.tone('triangle', 1500, 1500, 0.28, 0.15);
    this.tone('triangle', 2100, 2100, 0.3, 0.11, 0.09);
    this.noise(0.2, 0.08, 5000, 9000, 0, 'highpass');
  }

  /** Militia dash whoosh */
  dash() {
    this.noise(0.2, 0.16, 800, 2600, 0, 'bandpass');
  }

  /** Screen-change blade whoosh — softer than the dash, rides the wipe */
  swoosh() {
    this.noise(0.26, 0.1, 600, 3200, 0, 'bandpass');
  }

  /** Heartbeat — militia is closing in */
  thump() {
    this.tone('sine', 95, 42, 0.13, 0.45);
    this.tone('sine', 85, 40, 0.11, 0.3, 0.13);
  }

  /** Danfo horn — two-tone */
  honk() {
    this.tone('square', 340, 340, 0.16, 0.18);
    this.tone('square', 430, 430, 0.22, 0.18, 0.1);
  }

  /** Rain burst */
  rain() {
    this.noise(1.6, 0.14, 5000, 1500, 0, 'bandpass');
  }

  /** NEPA takes the light — power sags */
  powerDown() {
    this.tone('sawtooth', 220, 40, 0.8, 0.16);
    this.noise(0.4, 0.1, 900, 200, 0.1);
  }

  powerUp() {
    this.tone('sawtooth', 60, 240, 0.5, 0.14);
    this.tone('sine', 880, 990, 0.12, 0.1, 0.45);
  }

  win() {
    [523, 659, 784, 1047].forEach((f, i) => this.tone('triangle', f, f, 0.24, 0.18, i * 0.12));
    this.tone('triangle', 1319, 1319, 0.5, 0.15, 0.5);
  }

  lose() {
    [392, 330, 262, 196].forEach((f, i) => this.tone('sawtooth', f, f * 0.92, 0.3, 0.1, i * 0.17));
  }

  /** the crowd's "oooOOOH!" — a tag that just missed */
  crowdOoh() {
    // four staggered voice-band layers sliding down + a low fall — reads as
    // a stadium gasp without any samples
    for (let i = 0; i < 4; i++)
      this.noise(0.45, 0.09, 1400 - i * 260, 240, i * 0.05, 'bandpass');
    this.tone('triangle', 700, 380, 0.5, 0.08);
  }

  /** the militia heard your shout — a quick "you're made" alert pair */
  marked() {
    this.tone('triangle', 520, 520, 0.09, 0.16);
    this.tone('triangle', 660, 660, 0.12, 0.16, 0.1);
    this.noise(0.1, 0.05, 2000, 5000, 0, 'highpass');
  }

  // ---------- UI chrome — Fall Guys-style candy blips ----------
  // shared recipe: a rounded sine body with a fast pitch sweep, an octave
  // sparkle on top, and a tiny high-end click for the attack — reads as a
  // soft "bwip", bright but never harsh. Tap sounds self-ensure (they only
  // ever fire inside user gestures).

  /** the default button pop */
  uiTap() {
    this.ensure();
    this.tone('sine', 520, 940, 0.07, 0.2);
    this.tone('triangle', 1040, 1880, 0.05, 0.08, 0.012);
    this.noise(0.025, 0.045, 5200, 9000, 0, 'highpass');
  }

  /** back / cancel — the tap's mirror, pitched down */
  uiBack() {
    this.ensure();
    this.tone('sine', 760, 430, 0.08, 0.18);
    this.noise(0.025, 0.04, 4800, 8000, 0, 'highpass');
  }

  /** panel / modal open — an airy swell + a pop */
  uiOpen() {
    this.ensure();
    this.noise(0.14, 0.07, 700, 3600, 0, 'bandpass');
    this.tone('sine', 620, 1150, 0.09, 0.16, 0.02);
    this.tone('triangle', 1240, 1720, 0.07, 0.07, 0.05);
  }

  /** panel / modal close — a softer settle, no swell */
  uiClose() {
    this.ensure();
    this.noise(0.1, 0.05, 2400, 700, 0, 'bandpass');
    this.tone('sine', 880, 470, 0.07, 0.13, 0.015);
  }

  /** hover — a whisper tick. No self-ensure: it should only sound once
   *  audio is already running (a real tap has happened) */
  uiHover() {
    this.tone('sine', 1500, 1900, 0.028, 0.04);
  }

  /** denied — the muted "brrt" for locked / not-allowed taps */
  denied() {
    this.ensure();
    this.tone('square', 190, 150, 0.14, 0.1);
    this.tone('square', 143, 110, 0.12, 0.07, 0.02);
  }

  /** confirm — the bigger two-note commit chirp (READY / START / saves) */
  uiConfirm() {
    this.ensure();
    this.tone('triangle', 660, 990, 0.09, 0.2);
    this.tone('triangle', 990, 1480, 0.12, 0.14, 0.07);
    this.noise(0.05, 0.05, 5000, 8000, 0.06, 'highpass');
  }

  // ---------- bean noises — the little creature living in the menus ----------
  // Pitched higher and rounder than the chrome blips — these are the bean's
  // "voice", not UI. Hooked inside Hero3D so every podium/map/drop bean gets
  // the same vocabulary automatically. Ambient ones (hops, tricks) still
  // self-ensure harmlessly — they just stay silent until audio is running.

  /** startle squeak — "eep!" when the bean gets poked */
  beanEep() {
    this.ensure();
    this.tone('triangle', 1350, 2200, 0.06, 0.15);
    this.tone('triangle', 2100, 2600, 0.05, 0.08, 0.05);
  }

  /** idle hop — a tiny "boip" on take-off */
  beanHop() {
    this.ensure();
    this.tone('sine', 400, 720, 0.08, 0.12);
    this.tone('triangle', 640, 980, 0.06, 0.05, 0.02);
  }

  /** pratfall launch — the big cartoon spring */
  beanBoing() {
    this.ensure();
    this.tone('sine', 260, 620, 0.14, 0.17);
    this.tone('triangle', 520, 1150, 0.1, 0.08, 0.04);
  }

  /** midair backflip — excited "whee!" slide whistle */
  beanWhee() {
    this.ensure();
    this.tone('sine', 900, 1950, 0.2, 0.11, 0.05);
    this.tone('triangle', 1400, 2400, 0.16, 0.05, 0.14);
  }

  /** soft landing pomf after a hop */
  beanLand() {
    this.ensure();
    this.tone('sine', 230, 130, 0.09, 0.13);
    this.noise(0.05, 0.05, 1200, 400, 0);
  }

  /** the pancake SPLAT — flat pomf + a dazed little "oof" */
  beanSplat() {
    this.ensure();
    this.noise(0.09, 0.15, 900, 220, 0);
    this.tone('sine', 180, 85, 0.12, 0.17);
    this.tone('triangle', 950, 480, 0.1, 0.06, 0.13);
  }

  /** drag-spin warble — two-tone wobble, callers throttle the repeat */
  beanSpin() {
    this.ensure();
    this.tone('sine', 680, 1150, 0.05, 0.08);
    this.tone('sine', 1150, 700, 0.05, 0.07, 0.05);
  }

  /** skydive — wind rush + the classic long falling whistle */
  beanWhistle() {
    this.ensure();
    this.noise(0.9, 0.05, 3200, 800, 0, 'bandpass');
    this.tone('sine', 1700, 480, 0.8, 0.09);
    this.tone('triangle', 2400, 700, 0.7, 0.04, 0.06);
  }

  // ---------- militia voice ----------
  // Browser speech synthesis — deep pitch + quick delivery approximates the
  // street-shout energy. No audio files needed. (A true Pidgin accent needs
  // recorded lines — this is the zero-asset stand-in.)

  private pickVoice() {
    if (this.voicePick || typeof speechSynthesis === 'undefined') return;
    const voices = speechSynthesis.getVoices();
    this.voicePick =
      voices.find((v) => v.lang === 'en-NG') ??
      voices.find((v) => v.lang === 'en-GB') ??
      voices.find((v) => v.lang.startsWith('en')) ??
      null;
  }

  /** Shout a line — recorded Abeo (en-NG) first, browser TTS for dynamic text. */
  voice(line: string) {
    if (!this.ctx) return;
    const now = performance.now();
    if (now - this.lastVoiceAt < 900 || this.voiceBusy) return;
    const file = Sfx.VOICE_FILES[line];
    if (file) {
      this.lastVoiceAt = now;
      void this.playVoiceFile(file);
      return;
    }
    if (typeof speechSynthesis === 'undefined' || speechSynthesis.speaking) return;
    this.lastVoiceAt = now;
    this.pickVoice();
    const u = new SpeechSynthesisUtterance(line);
    if (this.voicePick) u.voice = this.voicePick;
    u.rate = 1.05;
    u.pitch = 0.95; // announcer register — militia lines come from the Abeo files
    u.volume = 0.6;
    speechSynthesis.speak(u);
  }

  /** Fetch → decode → cache → play through the master bus. */
  private async playVoiceFile(name: string) {
    if (!this.ctx) return;
    try {
      let buf = this.voiceBufs.get(name);
      if (!buf) {
        const res = await fetch(`${name}.mp3`);
        if (!res.ok) return;
        buf = await this.ctx.decodeAudioData(await res.arrayBuffer());
        this.voiceBufs.set(name, buf);
      }
      this.voiceBusy = true;
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      const g = this.ctx.createGain();
      g.gain.value = 0.85;
      src.connect(g).connect(this.master);
      src.onended = () => {
        this.voiceBusy = false;
      };
      src.start();
    } catch {
      this.voiceBusy = false; // decode/fetch failed — voices are flavor, not fatal
    }
  }

  // ---------- background groove ----------
  // Simple syncopated loop: kick + shaker + a wandering bass line.

  startMusic() {
    this.ensure();
    if (!this.ctx || this.musicTimer !== null) return;
    let step = 0;
    const bass: number[] = [110, 0, 0, 131, 0, 0, 98, 0, 110, 0, 0, 165, 0, 131, 0, 0];
    const kicks = new Set([0, 4, 7, 10, 12]);
    this.musicTimer = window.setInterval(() => {
      const s = step % 16;
      if (kicks.has(s)) this.tone('sine', 140, 44, 0.14, 0.3);
      if (s % 2 === 1) this.noise(0.05, 0.04, 6500, 6500, 0, 'highpass');
      const n = bass[s];
      if (n > 0) this.tone('triangle', n, n, 0.24, 0.11);
      step++;
    }, 290);
  }

  stopMusic() {
    if (this.musicTimer !== null) {
      clearInterval(this.musicTimer);
      this.musicTimer = null;
    }
  }
}
