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
    'Enter cell!': 'voice-enter-cell',
    'Gotcha!': 'voice-gotcha',
    // Ezinne (en-NG, female) — player cries + the announcer
    'AH! HOW?!': 'voice-ez-ah-how',
    'WHO TOUCH YOU?!': 'voice-ez-who-touch',
    'You get luck today!': 'voice-get-luck',
    'Arrgh!': 'voice-ez-arrgh',
    'WHO OPEN CELL?!': 'voice-who-open-cell',
    'Dem don free them o!': 'voice-dem-don-free',
    'Heeeeey! Come back!': 'voice-heey-come-back',
    'DANFO!': 'voice-ez-danfo',
    'NEPA DON TAKE LIGHT!': 'voice-ez-nepa',
    'UP NEPA!': 'voice-ez-up-nepa',
    'RAIN': 'voice-ez-rain',
    'JAILBREAK!': 'voice-ez-jailbreak',
    'MILITIA REINFORCEMENTS!': 'voice-reinforcements',
  };

  /** Call from any user gesture (keydown/pointer) — browsers block audio before that. */
  ensure() {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
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

  /** Jail door clangs shut */
  jail() {
    this.tone('square', 320, 140, 0.2, 0.2);
    this.noise(0.18, 0.22, 1500, 300, 0.02);
    this.tone('square', 180, 120, 0.3, 0.14, 0.12);
  }

  /** Jailbreak — mates are free */
  breakout() {
    [392, 523, 659, 784].forEach((f, i) => this.tone('triangle', f, f, 0.16, 0.16, i * 0.07));
    this.noise(0.35, 0.14, 2500, 500, 0.15);
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
