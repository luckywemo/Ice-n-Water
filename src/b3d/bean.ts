// Bean characters in real-time 3D — the same cast as the 2D game:
// glossy capsule torso, pale face oval, tall eyes, droopy arms,
// same-material feet. Regalia is PAINTED: chest strip, coral bead arc,
// shoe colour, sleeve-tip line — plus head gear and rage brows.
// Shape variants: 'bean' default, 'round' the settled Baale frame,
// 'tall' the elder. furLen grows the militia's pale shaggy frost coat.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { clamp, lerp, rand } from './util';

// ---- the model vocabulary shared with characters.ts (was hero3d.ts)
export type BeanShape = 'bean' | 'round' | 'tall';
export type BeanGear = 'none' | 'cap' | 'hardhat' | 'band' | 'spikes' | 'crown' | 'frost';
export interface BeanMarks {
  strip?: number;
  bead?: number;
  shoe?: number;
  line?: number;
}
export interface Bean3DModel {
  body: number;
  skin?: number;
  shape?: BeanShape;
  gear?: BeanGear;
  marks?: BeanMarks;
  rage?: boolean;
  furLen?: number;
}

export const PALETTE: Bean3DModel[] = [ // crowd fills
  { body: 0xc98f4a }, { body: 0x8a4f24 }, { body: 0x7a4a8f }, { body: 0x3f7d5c },
  { body: 0x4a7ab5 }, { body: 0xc25b46 }, { body: 0xd9a03c }, { body: 0x58b7b0 },
];
const FACE = 0xf0d5a5;
const DARK = 0x14100c;
const ICE_TINT = 0x9fd8ff;

export interface Bean {
  root: THREE.Group;
  figure: THREE.Group;
  body: THREE.Mesh;
  face: THREE.Mesh;
  eyeL: THREE.Mesh; eyeR: THREE.Mesh;
  armL: THREE.Group; armR: THREE.Group;
  footL: THREE.Mesh; footR: THREE.Mesh;
  iceShell: THREE.Group;
  marker: THREE.Sprite;
  emote: THREE.Sprite;
  bodyMat: THREE.MeshStandardMaterial;
  furMats: THREE.MeshStandardMaterial[];
  baseColor: number;
  t: number;
  frozen: boolean;
  squash: number;
}

let envDone = false;
const texCache = new Map<string, THREE.Texture>();

function markerTexture(): THREE.Texture {
  let t = texCache.get('mark');
  if (t) return t;
  t = emoteTexture('!', '#ffd25e');
  texCache.set('mark', t);
  return t;
}

/** any short glyph as a floating sprite texture — '…', '!!', '💤' */
export function emoteTexture(txt: string, color = '#f5efe0'): THREE.Texture {
  const key = `em:${txt}:${color}`;
  let t = texCache.get(key);
  if (t) return t;
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = color;
  g.font = '900 40px sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.strokeStyle = '#000'; g.lineWidth = 7;
  g.strokeText(txt, 32, 34); g.fillText(txt, 32, 34);
  t = new THREE.CanvasTexture(c);
  texCache.set(key, t);
  return t;
}

const mat = (color: number, rough = .38) =>
  new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0 });

/** strand-dot alpha for the fur shells — one texture shared by every bean */
function furTexture(): THREE.Texture {
  let t = texCache.get('fur');
  if (t) return t;
  const fc = document.createElement('canvas');
  fc.width = fc.height = 128;
  const fg = fc.getContext('2d')!;
  for (let i = 0; i < 2400; i++) {
    fg.fillStyle = `rgba(255,255,255,${0.35 + Math.random() * 0.65})`;
    fg.fillRect(Math.random() * 128, Math.random() * 128, 1.5, 1.5);
  }
  t = new THREE.CanvasTexture(fc);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  texCache.set('fur', t);
  return t;
}

export function makeBean(def: Bean3DModel): Bean {
  const root = new THREE.Group();
  const figure = new THREE.Group();
  root.add(figure);

  const bodyMat = mat(def.body);
  const faceMat = mat(def.skin ?? FACE, .55);
  const darkMat = mat(DARK, .4);
  const feetMat = def.marks?.shoe ? mat(def.marks.shoe) : bodyMat;

  // ---- torso capsule
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(.42, .55, 6, 18), bodyMat);
  body.position.y = .78;
  body.castShadow = true;
  figure.add(body);

  // ---- shell fur — clones of the torso displaced along normals with the
  // shared strand-dot alpha texture; alphaTest rises per shell so the coat
  // thins toward the tips like real hair. Parented to the body mesh so the
  // run-bob carries the whole coat. furLen scales strand reach.
  const furMats: THREE.MeshStandardMaterial[] = [];
  {
    const len = 1 + ((def.furLen ?? 1) - 1) * 0.5;
    const src = body.geometry as THREE.BufferGeometry;
    const pos = src.attributes.position as THREE.BufferAttribute;
    const nor = src.attributes.normal as THREE.BufferAttribute;
    const SHELLS = 10;
    for (let i = 1; i <= SHELLS; i++) {
      const t = i / SHELLS;
      const g = src.clone();
      const gp = g.attributes.position as THREE.BufferAttribute;
      const gn = g.attributes.normal as THREE.BufferAttribute;
      for (let v = 0; v < gp.count; v++)
        gp.setXYZ(
          v,
          pos.getX(v) + gn.getX(v) * 0.1 * t * len,
          pos.getY(v) + gn.getY(v) * 0.1 * t * len,
          pos.getZ(v) + gn.getZ(v) * 0.1 * t * len,
        );
      const shellMat = new THREE.MeshStandardMaterial({
        color: def.body,
        roughness: 1,
        alphaMap: furTexture(),
        alphaTest: 0.08 + t * 0.6,
        side: THREE.FrontSide,
      });
      furMats.push(shellMat);
      body.add(new THREE.Mesh(g, shellMat));
    }
  }

  // ---- face oval — pushed proud of the fur tips so it reads through the coat
  const face = new THREE.Mesh(new THREE.SphereGeometry(.3, 18, 14), faceMat);
  face.scale.set(1, 1.25, .45);
  face.position.set(0, .92, .36);
  figure.add(face);

  const eyeGeo = new THREE.SphereGeometry(.055, 10, 8);
  const eyeL = new THREE.Mesh(eyeGeo, darkMat);
  eyeL.scale.set(1, 1.9, .7);
  eyeL.position.set(-.11, .97, .48);
  const eyeR = eyeL.clone(); eyeR.position.x = .11;
  figure.add(eyeL, eyeR);

  // ---- rage brows — the angry V over the eyes
  if (def.rage) {
    const browGeo = new THREE.BoxGeometry(.16, .035, .03);
    const bL = new THREE.Mesh(browGeo, darkMat);
    bL.position.set(-.11, 1.1, .49); bL.rotation.z = -.5;
    const bR = bL.clone(); bR.position.x = .11; bR.rotation.z = .5;
    figure.add(bL, bR);
  }

  // ---- arms
  const lineMat = def.marks?.line ? mat(def.marks.line) : null;
  const mkArm = (side: number) => {
    const g = new THREE.Group();
    g.position.set(.44 * side, 1.02, 0);
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(.09, .34, 4, 10), bodyMat);
    arm.position.y = -.24;
    arm.castShadow = true;
    const hand = new THREE.Mesh(new THREE.SphereGeometry(.11, 10, 8), bodyMat);
    hand.position.y = -.46;
    g.add(arm, hand);
    if (lineMat) {
      const tip = new THREE.Mesh(new THREE.SphereGeometry(.075, 8, 6), lineMat);
      tip.position.y = -.52;
      g.add(tip);
    }
    g.rotation.z = -.18 * side;
    figure.add(g);
    return g;
  };
  const armL = mkArm(-1), armR = mkArm(1);

  // ---- feet
  const footGeo = new THREE.SphereGeometry(.16, 12, 8);
  const footL = new THREE.Mesh(footGeo, feetMat);
  footL.scale.set(1, .55, 1.35);
  footL.position.set(-.18, .1, .04);
  footL.castShadow = true;
  const footR = footL.clone(); footR.position.x = .18;
  figure.add(footL, footR);

  // ---- painted regalia: chest strip + coral bead arc, baked into a torso
  // texture (white base → bodyMat.color still dyes the coat). Canvas-centre
  // lands on the capsule's +z front seam; the fur shells share the torso UVs
  // so the marks tint the strands too — regalia reads at every fur depth.
  if (def.marks && (def.marks.strip !== undefined || def.marks.bead !== undefined)) {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 256;
    const c = cv.getContext('2d')!;
    c.fillStyle = '#ffffff'; // white base → body colour shows through
    c.fillRect(0, 0, 256, 256);
    if (def.marks.strip !== undefined) {
      const ind = '#' + def.marks.strip.toString(16).padStart(6, '0');
      c.fillStyle = ind;
      c.fillRect(99, 78, 58, 174); // chest strip, centred on the front seam
      c.strokeStyle = 'rgba(255,255,255,0.85)';
      c.lineWidth = 3;
      c.strokeRect(103, 82, 50, 166); // border threads
      c.lineWidth = 2;
      c.strokeRect(109, 88, 38, 154);
      c.fillStyle = 'rgba(255,255,255,0.8)';
      for (let y = 104; y < 200; y += 26) {
        // running diamond + bar motif
        c.save();
        c.translate(128, y);
        c.rotate(Math.PI / 4);
        c.fillRect(-6.5, -6.5, 13, 13);
        c.restore();
        c.fillRect(116, y + 9, 24, 3);
      }
      for (const ox of [-9, 9]) {
        // interlocked knot at the hem
        c.save();
        c.translate(128 + ox, 226);
        c.rotate(Math.PI / 4);
        c.lineWidth = 4.5;
        c.strokeRect(-10, -10, 20, 20);
        c.restore();
      }
    }
    if (def.marks.bead !== undefined) {
      // coral dots — an arc dipping low on the open chest below the face oval
      const col = '#' + def.marks.bead.toString(16).padStart(6, '0');
      c.fillStyle = col;
      for (let i = 0; i < 11; i++) {
        const t = i / 10; // 0..1 across the chest
        const x = 128 + (t - 0.5) * 132;
        const y = 114 - Math.pow(Math.abs(t - 0.5) * 2, 1.7) * 30; // U-dip at centre
        c.beginPath();
        c.arc(x, y, 7, 0, Math.PI * 2);
        c.fill();
      }
    }
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = THREE.RepeatWrapping;
    tex.offset.x = 0.25; // canvas centre → capsule +z front
    bodyMat.map = tex;
    bodyMat.needsUpdate = true;
    for (const sm of furMats) {
      sm.map = tex;
      sm.needsUpdate = true;
    }
  }

  // ---- head gear
  const gear = def.gear ?? 'none';
  if (gear !== 'none') {
    const gg = new THREE.Group();
    const gold = mat(0xd9a02a, .35);
    if (gear === 'cap') {
      const capMat = mat(0x24303c, .6);
      const top = new THREE.Mesh(new THREE.CylinderGeometry(.28, .3, .14, 14), capMat);
      top.position.y = 1.42;
      const brim = new THREE.Mesh(new THREE.BoxGeometry(.4, .04, .3), capMat);
      brim.position.set(0, 1.36, .28);
      gg.add(top, brim);
    } else if (gear === 'hardhat') {
      const hatMat = mat(0xf2b70d, .45);
      const dome = new THREE.Mesh(new THREE.SphereGeometry(.3, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), hatMat);
      dome.position.y = 1.36;
      const rim = new THREE.Mesh(new THREE.TorusGeometry(.3, .035, 6, 18), hatMat);
      rim.rotation.x = Math.PI / 2; rim.position.y = 1.36;
      gg.add(dome, rim);
    } else if (gear === 'band') {
      const band = new THREE.Mesh(new THREE.TorusGeometry(.34, .05, 6, 18), mat(0xc23a2e, .6));
      band.rotation.x = Math.PI / 2;
      band.position.y = 1.12;
      gg.add(band);
    } else if (gear === 'spikes') {
      for (let i = -1; i <= 1; i++) {
        const s = new THREE.Mesh(new THREE.ConeGeometry(.07, .22, 6), mat(0xd8d0c4, .7));
        s.position.set(i * .14, 1.42 + Math.abs(i) * -.03, 0);
        s.rotation.z = -i * .3;
        gg.add(s);
      }
    } else if (gear === 'crown') {
      const band = new THREE.Mesh(new THREE.CylinderGeometry(.26, .28, .16, 10), gold);
      band.position.y = 1.4;
      gg.add(band);
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        const pt = new THREE.Mesh(new THREE.ConeGeometry(.05, .16, 4), gold);
        pt.position.set(Math.cos(a) * .24, 1.55, Math.sin(a) * .24);
        gg.add(pt);
      }
    } else if (gear === 'frost') {
      const frost = mat(0xcfeeff, .25);
      for (const [x, z, r] of [[-.2, .05, .4], [.22, -.05, -.5], [0, -.18, .9], [.1, .15, -.8]] as const) {
        const s = new THREE.Mesh(new THREE.TetrahedronGeometry(.14), frost);
        s.position.set(x, 1.38, z);
        s.rotation.set(r, r * 1.7, r * .6);
        gg.add(s);
      }
    }
    figure.add(gg);
  }

  // ---- shape: 'round' the Baale, 'tall' the elder
  if (def.shape === 'round') figure.scale.set(1.24, .84, 1.14);
  else if (def.shape === 'tall') figure.scale.set(.88, 1.14, .88);
  figure.userData.bs = figure.scale.clone();

  // ---- ice shell + rescue marker (on root, unscaled)
  const iceShell = new THREE.Group();
  const shellMat = new THREE.MeshStandardMaterial({
    color: 0xbfe6ff, transparent: true, opacity: .42, roughness: .15, metalness: 0,
  });
  const shell = new THREE.Mesh(new THREE.BoxGeometry(1.05, 1.55, .95), shellMat);
  shell.position.y = .82;
  const shard = new THREE.Mesh(new THREE.TetrahedronGeometry(.18), shellMat);
  shard.position.set(.48, 1.5, .38); shard.rotation.set(.4, .6, 0);
  const shard2 = shard.clone(); shard2.position.set(-.44, .12, -.4); shard2.scale.setScalar(.7);
  iceShell.add(shell, shard, shard2);
  iceShell.visible = false;
  root.add(iceShell);

  const marker = new THREE.Sprite(new THREE.SpriteMaterial({ map: markerTexture(), depthTest: false }));
  marker.scale.setScalar(.5);
  marker.position.y = 1.95;
  marker.visible = false;
  root.add(marker);

  const emote = new THREE.Sprite(new THREE.SpriteMaterial({ map: emoteTexture('…'), depthTest: false, transparent: true }));
  emote.scale.setScalar(.42);
  emote.position.y = 1.95;
  emote.visible = false;
  root.add(emote);

  return {
    root, figure, body, face, eyeL, eyeR, armL, armR, footL, footR, iceShell, marker, emote,
    bodyMat, furMats, baseColor: def.body,
    t: Math.random() * 10, frozen: false, squash: 1,
  };
}

export function setFrozen(b: Bean, on: boolean) {
  b.frozen = on;
  b.iceShell.visible = on;
  b.marker.visible = on;
  b.bodyMat.color.setHex(on ? ICE_TINT : b.baseColor);
  for (const sm of b.furMats) sm.color.setHex(on ? ICE_TINT : b.baseColor);
  b.eyeL.scale.y = b.eyeR.scale.y = on ? .5 : 1.9;
}

/** per-frame animation. `speed` = planar m/s, `airborne` = jumping */
export function animBean(b: Bean, dt: number, speed: number, airborne: boolean, frozen: boolean) {
  b.t += dt;
  const t = b.t;
  if (frozen) {
    b.root.rotation.z = Math.sin(t * 30) * .012;
    b.marker.position.y = 1.95 + Math.sin(t * 4) * .12;
    return;
  }
  const run = clamp(speed / 8, 0, 1.4);
  const phase = t * (6 + run * 7);
  const sw = Math.sin(phase) * run;
  const bob = Math.abs(Math.sin(phase)) * .09 * run;

  b.body.position.y = .78 + bob;
  b.face.position.y = .92 + bob;
  b.eyeL.position.y = .97 + bob; b.eyeR.position.y = .97 + bob;
  b.root.rotation.x = lerp(b.root.rotation.x, run * .16, .2);

  b.armL.rotation.x = sw * .9; b.armR.rotation.x = -sw * .9;
  b.footL.position.z = .04 + sw * .14; b.footR.position.z = .04 - sw * .14;
  b.footL.position.y = .1 + Math.max(0, sw) * .12; b.footR.position.y = .1 + Math.max(0, -sw) * .12;

  if (airborne) {
    b.armL.rotation.z = lerp(b.armL.rotation.z, -1.6, .25);
    b.armR.rotation.z = lerp(b.armR.rotation.z, 1.6, .25);
    b.footL.position.y = b.footR.position.y = .22;
  } else {
    b.armL.rotation.z = lerp(b.armL.rotation.z, .18, .15);
    b.armR.rotation.z = lerp(b.armR.rotation.z, -.18, .15);
  }

  b.squash = lerp(b.squash, 1, .18);
  b.root.scale.set(1 + (1 - b.squash) * .5, b.squash, 1 + (1 - b.squash) * .5);
}

export function squashOnLand(b: Bean) { b.squash = .62; }

export function idleBean(b: Bean, dt: number) {
  b.t += dt;
  const s = 1 + Math.sin(b.t * 2.2) * .015;
  const bs = b.figure.userData.bs as THREE.Vector3 | undefined;
  b.figure.scale.set((bs?.x ?? 1) * s, (bs?.y ?? 1) * (1 + Math.sin(b.t * 2.2) * .02), (bs?.z ?? 1) * s);
  b.armL.rotation.x = Math.sin(b.t * 2.2) * .06;
  b.armR.rotation.x = -Math.sin(b.t * 2.2) * .06;
}

export function ensureEnv(renderer: THREE.WebGLRenderer, scene: THREE.Scene) {
  if (envDone) return;
  envDone = true;
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), .04).texture;
}
