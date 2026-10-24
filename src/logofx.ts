import Phaser from 'phaser';
import { REDUCED_MOTION } from './ui';

/**
 * Real material shaders for the logo — not overlays, per-pixel physics:
 *  WaterFxPipeline — a 2D water height field; its gradient gives a surface
 *    normal that refracts the letter behind it, throws a moving specular
 *    sheen where slopes catch the light, and shimmers caustic bands.
 *  IceFxPipeline   — domain-warped FBM frost that creeps inward from the
 *    glyph's true rim (neighbor-alpha edge detection), cold tint, and
 *    sparse crystal glints that twinkle.
 * WebGL only — callers must check renderer.type === Phaser.WEBGL and fall
 * back to the baked look otherwise.
 */

const WATER_FRAG = `
precision mediump float;

uniform sampler2D uMainSampler;
uniform float uTime;
uniform vec2 uRes;
uniform float uFill;

varying vec2 outTexCoord;

// surface height: three traveling waves interfering
float waveH(vec2 p, float t) {
  float h = 0.0;
  h += sin(dot(p, vec2(0.9, 0.4)) * 0.11 + t * 1.7) * 0.45;
  h += sin(dot(p, vec2(-0.5, 0.9)) * 0.17 + t * 2.3) * 0.30;
  h += sin(dot(p, vec2(0.3, -0.8)) * 0.23 - t * 1.4) * 0.25;
  return h;
}

void main() {
  vec2 uv = outTexCoord;
  vec2 p = uv * uRes;

  // central differences → surface gradient → normal
  float e = 1.5;
  float hC = waveH(p, uTime);
  float hX = waveH(p + vec2(e, 0.0), uTime);
  float hY = waveH(p + vec2(0.0, e), uTime);
  vec2 grad = vec2(hX - hC, hY - hC) / e;

  // refraction — the sloped surface bends what you see through it
  vec4 c = texture2D(uMainSampler, uv - grad * (16.0 / uRes) * uFill);

  // specular sheen — slopes facing the light glint
  vec3 n = normalize(vec3(-grad * 1.6, 1.0));
  vec3 L = normalize(vec3(-0.35, -0.6, 0.75));
  float spec = pow(max(0.0, dot(n, normalize(L + vec3(0.0, 0.0, 1.0)))), 10.0);
  c.rgb += spec * 0.5 * c.a * uFill;

  // traveling caustic shimmer — light refracted through moving water
  float ca = pow(abs(sin(uv.x * 34.0 + hC * 9.0 - uTime * 2.2)), 14.0);
  c.rgb += ca * 0.22 * vec3(0.65, 1.0, 1.0) * c.a * uFill;

  gl_FragColor = c;
}
`;

const ICE_FRAG = `
precision mediump float;

uniform sampler2D uMainSampler;
uniform float uTime;
uniform vec2 uRes;
uniform float uSeed;
uniform float uFreeze;

varying vec2 outTexCoord;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x),
    f.y
  );
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 5; i++) {
    v += a * vnoise(p);
    p *= 2.05;
    a *= 0.5;
  }
  return v;
}

void main() {
  vec2 uv = outTexCoord;
  vec4 c = texture2D(uMainSampler, uv);

  // thawed state — baked snow-cap/icicle whites melt back to water-blue
  float lum = dot(c.rgb, vec3(0.299, 0.587, 0.114));
  float iceWhite = smoothstep(0.8, 0.98, lum);
  c.rgb = mix(c.rgb, vec3(0.45, 0.82, 0.95), iceWhite * (1.0 - uFreeze) * 0.85 * c.a);

  // rim detection — frost creeps inward from the glyph's true edge
  vec2 e = vec2(2.5) / uRes;
  float nb = texture2D(uMainSampler, uv + vec2(e.x, 0.0)).a
           + texture2D(uMainSampler, uv - vec2(e.x, 0.0)).a
           + texture2D(uMainSampler, uv + vec2(0.0, e.y)).a
           + texture2D(uMainSampler, uv - vec2(0.0, e.y)).a;
  float rim = 1.0 - nb * 0.25;

  // crystal frost — domain-warped fbm makes feathery branches, not blobs.
  // uFreeze drives the threshold: frost visibly spreads inward from the rim
  vec2 q = uv * vec2(9.0, 7.0) + uSeed;
  float frost = fbm(q + fbm(q) * 1.6);
  float thresh = mix(0.98, 0.42, uFreeze);
  float amt = smoothstep(thresh, thresh + 0.35, frost * (0.62 + rim * 0.9)) * 0.9;
  c.rgb = mix(c.rgb, vec3(0.9, 0.97, 1.0), amt * c.a);

  // cold depth where the frost is thick
  c.rgb = mix(c.rgb, vec3(0.55, 0.8, 0.95), smoothstep(0.5, 0.9, frost) * 0.25 * c.a * uFreeze);

  // sparse crystal glints that twinkle — ice catching light
  vec2 cell = floor(uv * uRes / 3.0) + uSeed * 10.0;
  float tw = sin(uTime * 2.6 + hash(cell) * 43.0) * 0.5 + 0.5;
  c.rgb += step(0.994, hash(cell)) * tw * c.a * vec3(0.9) * uFreeze;

  gl_FragColor = c;
}
`;

export class WaterFxPipeline extends Phaser.Renderer.WebGL.Pipelines.PostFXPipeline {
  /** ms timestamp the effect was armed — refraction ramps in over ~1.2s */
  born = 0;

  constructor(game: Phaser.Game) {
    super({ game, fragShader: WATER_FRAG });
  }

  onPreRender(): void {
    const t = REDUCED_MOTION ? 0 : this.game.loop.time / 1000;
    this.set1f('uTime', t);
    const fill = REDUCED_MOTION ? 1 : Math.min(1, (this.game.loop.time - this.born) / 1200);
    this.set1f('uFill', fill);
    const go = this.gameObject as unknown as { width: number; height: number };
    this.set2f('uRes', Math.max(1, go.width), Math.max(1, go.height));
  }
}

export class IceFxPipeline extends Phaser.Renderer.WebGL.Pipelines.PostFXPipeline {
  seed = 0;
  /** ms timestamp the freeze cycle starts — armed by the caller on land */
  born = 0;

  constructor(game: Phaser.Game) {
    super({ game, fragShader: ICE_FRAG });
    this.born = game.loop.time;
  }

  onPreRender(): void {
    const t = REDUCED_MOTION ? 0 : this.game.loop.time / 1000;
    this.set1f('uTime', t);
    this.set1f('uSeed', this.seed);
    this.set1f('uFreeze', this.freezeAmount());
    const go = this.gameObject as unknown as { width: number; height: number };
    this.set2f('uRes', Math.max(1, go.width), Math.max(1, go.height));
  }

  /** 8s state cycle: freeze-in 1.4s → hold 2s → thaw 1.8s → hold 1.3s → refreeze 1.5s */
  static cycle(now: number, born: number): number {
    if (REDUCED_MOTION) return 1;
    const c = (now - born) % 8000;
    let f: number;
    if (c < 0) f = 0;
    else if (c < 1400) f = c / 1400;
    else if (c < 3400) f = 1;
    else if (c < 5200) f = 1 - (c - 3400) / 1800;
    else if (c < 6500) f = 0;
    else f = (c - 6500) / 1500;
    return f * f * (3 - 2 * f); // smoothstep — progressive, not linear
  }

  private freezeAmount(): number {
    return IceFxPipeline.cycle(this.game.loop.time, this.born);
  }
}
