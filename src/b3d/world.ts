// The street playground — dusty pitch, block walls, kiosks, danfo,
// ad boards, tyres, spectators. Everything procedural low-poly.
import * as THREE from 'three';
import { makeBean, idleBean, type Bean, PALETTE } from './bean';
import { canvasTex, pick, rand } from './util';

export interface Obstacle { x: number; z: number; r: number }
export interface SafeZone { x: number; z: number; r: number }
export interface World {
  root: THREE.Group;
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  obstacles: Obstacle[];
  spectators: Bean[];
  safeZone: SafeZone | null;
  sun: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  sunI?: number;
  hemiI?: number;
}
export type MapId = 'street' | 'school';

const PITCH_W = 34, PITCH_H = 52; // playable interior

function groundTexture() {
  const c = canvasTex(1024, 1536, (g) => {
    // dusty base
    g.fillStyle = '#b5693c'; g.fillRect(0, 0, 1024, 1536);
    // mottled wear
    for (let i = 0; i < 2600; i++) {
      const x = Math.random() * 1024, y = Math.random() * 1536, r = 2 + Math.random() * 26;
      g.fillStyle = `rgba(${140 + Math.random() * 60 | 0},${80 + Math.random() * 40 | 0},${45 + Math.random() * 25 | 0},${.06 + Math.random() * .12})`;
      g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
    }
    // faint darker patches
    for (let i = 0; i < 40; i++) {
      g.fillStyle = `rgba(90,50,28,${.05 + Math.random() * .09})`;
      g.beginPath();
      g.ellipse(Math.random() * 1024, Math.random() * 1536, 40 + Math.random() * 120, 30 + Math.random() * 90, Math.random() * 3, 0, 7);
      g.fill();
    }
    // pitch lines — worn white paint
    g.strokeStyle = 'rgba(245,240,228,.85)';
    g.lineWidth = 7; g.lineCap = 'round';
    const M = 60; // margin (matches inner wall gap)
    // outer
    g.strokeRect(M, M, 1024 - M * 2, 1536 - M * 2);
    // halfway
    g.beginPath(); g.moveTo(M, 768); g.lineTo(1024 - M, 768); g.stroke();
    // centre circle + spot
    g.beginPath(); g.arc(512, 768, 130, 0, 7); g.stroke();
    g.fillStyle = 'rgba(245,240,228,.8)';
    g.beginPath(); g.arc(512, 768, 9, 0, 7); g.fill();
    // goal boxes both ends
    for (const top of [true, false]) {
      const y0 = top ? M : 1536 - M;
      const dir = top ? 1 : -1;
      g.strokeRect(512 - 230, top ? y0 : y0 - 170, 460, 170);
      g.beginPath(); g.arc(512, y0 + dir * 170, 10, 0, 7); g.fill();
    }
    // paint wear — erase streaks over lines
    g.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 300; i++) {
      g.fillStyle = `rgba(0,0,0,${.1 + Math.random() * .3})`;
      g.beginPath(); g.arc(Math.random() * 1024, Math.random() * 1536, 1 + Math.random() * 5, 0, 7); g.fill();
    }
    g.globalCompositeOperation = 'source-over';
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function signTexture(text: string[], bg: string, fg: string, accent?: string) {
  const c = canvasTex(512, 128, (g) => {
    g.fillStyle = bg; g.fillRect(0, 0, 512, 128);
    g.fillStyle = fg;
    g.font = '900 44px Arial';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    if (text.length === 1) g.fillText(text[0], 256, 64);
    else {
      g.font = '900 40px Arial';
      g.fillText(text[0], 256, 40);
      g.font = '700 32px Arial';
      g.fillText(text[1], 256, 92);
    }
    if (accent) { g.fillStyle = accent; g.fillRect(0, 0, 512, 10); g.fillRect(0, 118, 512, 10); }
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const concrete = () => new THREE.MeshStandardMaterial({ color: 0xb8b0a2, roughness: .95 });
const rust = () => new THREE.MeshStandardMaterial({ color: 0x8a6a4a, roughness: .9, metalness: .15 });

function box(w: number, h: number, d: number, mat: THREE.Material, x = 0, y = 0, z = 0, shadow = true) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  if (shadow) { m.castShadow = true; m.receiveShadow = true; }
  return m;
}

function kiosk(x: number, z: number, ry: number): THREE.Group {
  const g = new THREE.Group();
  const blue = new THREE.MeshStandardMaterial({ color: 0x2e6b8f, roughness: .8 });
  g.add(box(3.2, 2.2, 2.2, blue, 0, 1.1, 0));
  // corrugated slant roof
  const roof = box(3.8, .08, 2.8, rust(), 0, 2.42, .1);
  roof.rotation.x = .12;
  g.add(roof);
  for (let i = -1.5; i <= 1.5; i += .5) g.add(box(.05, .06, 2.8, new THREE.MeshStandardMaterial({ color: 0x74563c, roughness: .9 }), i, 2.46, .12));
  // counter + cooler + crates
  g.add(box(3.4, .5, .6, new THREE.MeshStandardMaterial({ color: 0x5a7f96 }), 0, .95, 1.3));
  const cooler = box(.9, .7, .6, new THREE.MeshStandardMaterial({ color: 0xe8e4da, roughness: .6 }), 1.6, .35, 1.5);
  g.add(cooler);
  g.add(box(.6, .6, .6, new THREE.MeshStandardMaterial({ color: 0x8a5a2a, roughness: .9 }), -1.9, .3, 1.4));
  g.position.set(x, 0, z); g.rotation.y = ry;
  return g;
}

function umbrella(x: number, z: number): THREE.Group {
  const g = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(.05, .05, 2.6), new THREE.MeshStandardMaterial({ color: 0x888888 }));
  pole.position.y = 1.3;
  g.add(pole);
  const canopy = new THREE.Group();
  for (let i = 0; i < 8; i++) {
    const seg = new THREE.Mesh(new THREE.ConeGeometry(1.5, .5, 4, 1, true, i * Math.PI / 4, Math.PI / 4),
      new THREE.MeshStandardMaterial({ color: i % 2 ? 0xd8402e : 0xf0ead8, side: THREE.DoubleSide, roughness: .8 }));
    canopy.add(seg);
  }
  canopy.position.y = 2.6;
  canopy.scale.y = .8;
  g.add(canopy);
  g.position.set(x, 0, z);
  return g;
}

function danfo(x: number, z: number, ry: number): THREE.Group {
  const g = new THREE.Group();
  const yellow = new THREE.MeshStandardMaterial({ color: 0xf2b70d, roughness: .5 });
  const body = box(2.2, 1.7, 5.6, yellow, 0, 1.15, 0);
  g.add(body);
  // windshield + window band
  g.add(box(2.24, .5, 5.4, new THREE.MeshStandardMaterial({ color: 0x2a3038, roughness: .3 }), 0, 1.55, 0));
  // stripes
  g.add(box(2.24, .14, 5.6, new THREE.MeshStandardMaterial({ color: 0x1d1d1d }), 0, .78, 0));
  // wheels
  const wg = new THREE.CylinderGeometry(.42, .42, .3, 14);
  const wm = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: .9 });
  for (const [wx, wz] of [[-1.05, -1.8], [1.05, -1.8], [-1.05, 1.8], [1.05, 1.8]]) {
    const w = new THREE.Mesh(wg, wm);
    w.rotation.z = Math.PI / 2;
    w.position.set(wx, .42, wz);
    w.castShadow = true;
    g.add(w);
  }
  g.position.set(x, 0, z); g.rotation.y = ry;
  return g;
}

function mangoTree(x: number, z: number, s = 1): THREE.Group {
  const g = new THREE.Group();
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(.28 * s, .45 * s, 3.4 * s, 8),
    new THREE.MeshStandardMaterial({ color: 0x5d4326, roughness: 1 }));
  trunk.position.y = 1.7 * s; trunk.castShadow = true;
  g.add(trunk);
  const leaf = new THREE.MeshStandardMaterial({ color: 0x4a7d35, roughness: .9 });
  for (const [lx, ly, lz, lr] of [[0, 4, 0, 2.2], [1.4, 3.4, .6, 1.5], [-1.3, 3.5, -.5, 1.6], [.3, 3.6, -1.2, 1.4]]) {
    const b = new THREE.Mesh(new THREE.SphereGeometry(lr * s, 10, 8), leaf);
    b.position.set(lx * s, ly * s, lz * s);
    b.scale.y = .75;
    b.castShadow = true;
    g.add(b);
  }
  g.position.set(x, 0, z);
  return g;
}

function waterTank(x: number, z: number): THREE.Group {
  const g = new THREE.Group();
  const blk = new THREE.MeshStandardMaterial({ color: 0x9c9488, roughness: .95 });
  for (const [bx, bz] of [[-.7, -.7], [.7, -.7], [-.7, .7], [.7, .7]])
    g.add(box(.5, 2.6, .5, blk, bx, 1.3, bz));
  const tank = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.15, 1.6, 14),
    new THREE.MeshStandardMaterial({ color: 0x1f2226, roughness: .7 }));
  tank.position.y = 3.4; tank.castShadow = true;
  g.add(tank);
  g.position.set(x, 0, z);
  return g;
}

function pole(x: number, z: number): THREE.Group {
  const g = new THREE.Group();
  const p = new THREE.Mesh(new THREE.CylinderGeometry(.09, .12, 8, 8), concrete());
  p.position.y = 4; p.castShadow = true;
  const arm = box(1.4, .12, .12, concrete(), 0, 7.2, 0);
  g.add(p, arm);
  g.position.set(x, 0, z);
  return g;
}

function wire(a: THREE.Vector3, b: THREE.Vector3, sag = 1.2): THREE.Line {
  const mid = a.clone().add(b).multiplyScalar(.5); mid.y -= sag;
  const curve = new THREE.QuadraticBezierCurve3(a, mid, b);
  const geo = new THREE.BufferGeometry().setFromPoints(curve.getPoints(16));
  return new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0x2a2622 }));
}

function plasticChair(x: number, z: number, ry: number, color = 0x3f7d9c): THREE.Group {
  const g = new THREE.Group();
  const m = new THREE.MeshStandardMaterial({ color, roughness: .7 });
  g.add(box(.55, .08, .5, m, 0, .45, 0));
  g.add(box(.55, .55, .07, m, 0, .75, -.24));
  for (const [lx, lz] of [[-.24, -.2], [.24, -.2], [-.24, .2], [.24, .2]])
    g.add(box(.05, .45, .05, m, lx, .22, lz));
  g.position.set(x, 0, z); g.rotation.y = ry;
  return g;
}

function tyreStack(x: number, z: number, n = 2): { g: THREE.Group; ob: Obstacle } {
  const g = new THREE.Group();
  const m = new THREE.MeshStandardMaterial({ color: 0x1c1c1e, roughness: .95 });
  for (let i = 0; i < n; i++) {
    const t = new THREE.Mesh(new THREE.TorusGeometry(.42, .17, 8, 16), m);
    t.rotation.x = Math.PI / 2;
    t.position.y = .17 + i * .3;
    t.castShadow = true;
    g.add(t);
  }
  g.position.set(x, 0, z);
  return { g, ob: { x, z, r: .75 } };
}

function slippers(x: number, z: number): THREE.Group {
  const g = new THREE.Group();
  const cols = [0xd84f2e, 0x2e7d46, 0x3f7d9c, 0xd9a03c];
  for (let i = 0; i < 2; i++) {
    const s = box(.16, .04, .4, new THREE.MeshStandardMaterial({ color: pick(cols), roughness: .8 }),
      i * .28 - .14, .02, rand(-.08, .08), false);
    s.rotation.y = rand(-.5, .5);
    g.add(s);
  }
  g.position.set(x, 0, z);
  return g;
}

function building(x: number, z: number, w: number, h: number, d: number, color: number): THREE.Group {
  const g = new THREE.Group();
  g.add(box(w, h, d, new THREE.MeshStandardMaterial({ color, roughness: .9 }), 0, h / 2, 0));
  // window rows
  const winMat = new THREE.MeshStandardMaterial({ color: 0x27333f, roughness: .4 });
  const cols = Math.floor(w / 2.2);
  for (let i = 0; i < cols; i++)
    for (let j = 0; j < Math.floor(h / 2.4); j++)
      g.add(box(1, .9, .06, winMat, -w / 2 + 1.4 + i * 2.2, 1.8 + j * 2.4, d / 2 + .02, false));
  // roof edge
  g.add(box(w + .4, .18, d + .4, concrete(), 0, h + .09, 0));
  g.position.set(x, 0, z);
  return g;
}

// a small police-post booth — the safe zone marker (from the 2D game's refuge rule)
function policePost(x: number, z: number): THREE.Group {
  const g = new THREE.Group();
  const wall = new THREE.MeshStandardMaterial({ color: 0xe8e4da, roughness: .85 });
  const blue = new THREE.MeshStandardMaterial({ color: 0x24408f, roughness: .7 });
  g.add(box(2.6, 2.3, 2.2, wall, 0, 1.15, 0));
  g.add(box(2.7, .5, 2.3, blue, 0, .85, 0)); // the blue band every naija station wears
  g.add(box(2.9, .1, 2.5, rust(), 0, 2.42, 0));
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(2, .5),
    new THREE.MeshStandardMaterial({ map: signTexture(['POLICE'], '#24408f', '#ffffff'), roughness: .8 }));
  sign.position.set(0, 1.8, 1.12);
  g.add(sign);
  // striped ground ring — the refuge
  const ring = new THREE.Mesh(new THREE.RingGeometry(2.4, 3.1, 32),
    new THREE.MeshBasicMaterial({ color: 0x4dd0e1, transparent: true, opacity: .5, depthWrite: false }));
  ring.rotation.x = -Math.PI / 2; ring.position.set(0, .04, 2.6);
  g.add(ring);
  g.position.set(x, 0, z);
  return g;
}

export function buildWorld(scene: THREE.Scene): World {
  const root = new THREE.Group();
  scene.add(root);
  const add = (o: THREE.Object3D) => { root.add(o); return o; };
  const obstacles: Obstacle[] = [];
  const spectators: Bean[] = [];
  const B = { minX: -PITCH_W / 2, maxX: PITCH_W / 2, minZ: -PITCH_H / 2, maxZ: PITCH_H / 2 };

  // ---- ground: pitch + surrounding apron
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(PITCH_W + 30, PITCH_H + 30),
    new THREE.MeshStandardMaterial({ map: groundTexture(), roughness: 1 }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  add(ground);

  // ---- perimeter walls (segments with corner gaps like the refs)
  const wallMat = concrete();
  const wallH = 2.1, wallT = .5; // >1.9u sprite — beans can't peek over at low cam angles
  const mkWall = (x: number, z: number, w: number, d: number) => {
    const m = box(w, wallH, d, wallMat, x, wallH / 2, z);
    m.receiveShadow = true;
    add(m);
  };
  const gx = PITCH_W / 2 + .9, gz = PITCH_H / 2 + .9;
  mkWall(0, -gz, PITCH_W + 2.4, wallT);          // north
  mkWall(0, gz, PITCH_W + 2.4, wallT);           // south
  mkWall(-gx, 0, wallT, PITCH_H + 2.4);          // west
  mkWall(gx, 0, wallT, PITCH_H + 2.4);           // east

  // ---- ad boards on walls
  const boards: [string[], string, string, number, number, number][] = [
    [['MTN', 'EVERYWHERE YOU GO'], '#ffcc00', '#1d1d1d', -6, gz + .28, Math.PI],
    [['BET9JA'], '#1d7a3d', '#ffffff', 7, -gz - .28, 0],
    [['COLD', 'PURE WATER HERE'], '#e8f4ff', '#1d6fa5', -gx - .28, -8, -Math.PI / 2],
    [['MILO', 'ENERGY DRINK'], '#1d5c2e', '#ffd25e', gx + .28, 10, Math.PI / 2],
  ];
  for (const [lines, bgc, fgc, x, z, ry] of boards) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(4.6, 1.15),
      new THREE.MeshStandardMaterial({ map: signTexture(lines, bgc, fgc), roughness: .85 }));
    m.position.set(x, .75, z); m.rotation.y = ry;
    add(m);
  }

  // ---- kiosks + umbrellas + chairs along east wall & corners
  add(kiosk(gx + 3.4, -12, -Math.PI / 2));
  add(kiosk(-gx - 3.4, 16, Math.PI / 2));
  add(umbrella(gx + 3, -8));
  add(umbrella(-gx - 3, 20));
  add(plasticChair(gx + 2.4, -10, -Math.PI / 2));
  add(plasticChair(-gx - 2.4, 18, Math.PI / 2, 0xd9a03c));
  add(plasticChair(-gx - 2.4, 14, Math.PI / 2));

  // ---- danfo parked on the street south side
  add(danfo(-6, gz + 6.5, .1));

  // ---- water tank on a corner
  add(waterTank(gx + 4, gz + 4));

  // ---- poles + sagging wires
  const p1 = new THREE.Vector3(-gx - 4, 7.2, -gz - 4);
  const p2 = new THREE.Vector3(gx + 5, 7.2, -gz - 6);
  const p3 = new THREE.Vector3(-gx - 5, 7.2, gz + 5);
  add(pole(-gx - 4, -gz - 4));
  add(pole(gx + 5, -gz - 6));
  add(pole(-gx - 5, gz + 5));
  add(wire(p1, p2));
  add(wire(p1, p3, 1.6));

  // ---- tree over the west wall
  add(mangoTree(-gx - 4.5, -2, 1.15));

  // ---- buildings around the block
  const builds: [number, number, number, number, number, number][] = [
    [-8, -gz - 12, 14, 8, 8, 0xe8c46a],
    [10, -gz - 13, 10, 11, 8, 0x7fa8b8],
    [-14, gz + 13, 12, 7, 9, 0xd88a5a],
    [12, gz + 12, 9, 9, 8, 0xc9b8d8],
    [-gx - 12, -14, 8, 10, 10, 0xe0d8b8],
    [gx + 12, 16, 8, 8, 9, 0x8fb88f],
  ];
  for (const [x, z, w, h, d, c] of builds) add(building(x, z, w, h, d, c));

  // ---- on-pitch obstacles
  const t1 = tyreStack(-8, -14, 2); add(t1.g); obstacles.push(t1.ob);
  const t2 = tyreStack(9, 8, 3); add(t2.g); obstacles.push(t2.ob);
  const t3 = tyreStack(-11, 17, 1); add(t3.g); obstacles.push(t3.ob);
  // stones + cardboard
  const stoneMat = new THREE.MeshStandardMaterial({ color: 0x8a8078, roughness: 1 });
  for (const [x, z, r] of [[4, -6, .5], [-3, 12, .4], [12, -18, .45]] as const) {
    const s = new THREE.Mesh(new THREE.DodecahedronGeometry(r, 0), stoneMat);
    s.position.set(x, r * .55, z); s.castShadow = true;
    add(s); obstacles.push({ x, z, r: r + .35 });
  }
  const card = box(1.2, .03, .9, new THREE.MeshStandardMaterial({ color: 0xa8845c, roughness: 1 }), 2, .02, 19, false);
  card.rotation.y = .5; add(card);
  // stray slippers at the edges — players kicked them off
  add(slippers(-gx + 1.4, -6));
  add(slippers(gx - 1.4, 14));
  add(slippers(-4, -gz + 1.6));

  // ---- spectators along the walls
  const spots: [number, number, number][] = [];
  for (let x = -PITCH_W / 2 + 3; x < PITCH_W / 2 - 2; x += rand(3.4, 5)) {
    spots.push([x, -gz + .2, 0]);           // north wall inside
    spots.push([x + 1.5, gz + 2.2, Math.PI]); // south street side
  }
  for (let z = -PITCH_H / 2 + 4; z < PITCH_H / 2 - 4; z += rand(4.5, 6.5)) {
    spots.push([-gx + .2, z, Math.PI / 2]);
    spots.push([gx + 2.2, z + 1, -Math.PI / 2]);
  }
  for (const [sx, sz, ry] of spots) {
    if (Math.random() < .18) continue;
    const b = makeBean(pick(PALETTE));
    b.root.position.set(sx + rand(-.4, .4), 0, sz + rand(-.3, .3));
    b.root.rotation.y = ry + rand(-.35, .35);
    b.root.scale.setScalar(rand(.82, 1));
    add(b.root);
    spectators.push(b);
  }

  // ---- lighting: warm Nigerian afternoon
  const sun = new THREE.DirectionalLight(0xffe2b0, 2.6);
  sun.position.set(-22, 30, -14);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -45; sun.shadow.camera.right = 45;
  sun.shadow.camera.top = 45; sun.shadow.camera.bottom = -45;
  sun.shadow.camera.far = 90;
  sun.shadow.bias = -0.0004;
  add(sun);
  const hemi = new THREE.HemisphereLight(0xcfe4ff, 0x8a5a34, .85);
  add(hemi);
  const bounce = new THREE.DirectionalLight(0xffc890, .35);
  bounce.position.set(18, 12, 20);
  add(bounce);

  scene.fog = new THREE.Fog(0xe8c9a0, 70, 160);

  // ---- police post in the south-west corner — the refuge
  const px = B.minX + 3.6, pz = B.maxZ - 6.4;
  add(policePost(px, pz));
  obstacles.push({ x: px, z: pz, r: 1.9 });
  const safeZone: SafeZone = { x: px, z: pz + 2.6, r: 3.0 };

  return { root, bounds: B, obstacles, spectators, safeZone, sun, hemi };
}

// ================= MAP 2 — PRIMARY SCHOOL COMPOUND =================
// Assembly ground between two classroom blocks. Cover = building
// lanes, flag pole, benches, mango trees. Same rules, new hiding spots.

function schoolGroundTexture() {
  const c = canvasTex(1024, 1536, (g) => {
    g.fillStyle = '#c28050'; g.fillRect(0, 0, 1024, 1536);
    for (let i = 0; i < 2200; i++) {
      const x = Math.random() * 1024, y = Math.random() * 1536, r = 2 + Math.random() * 24;
      g.fillStyle = `rgba(${150 + Math.random() * 55 | 0},${95 + Math.random() * 40 | 0},${55 + Math.random() * 25 | 0},${.06 + Math.random() * .11})`;
      g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
    }
    // assembly-ground lines — where classes line up at the flag
    g.strokeStyle = 'rgba(245,240,228,.75)';
    g.lineWidth = 6; g.lineCap = 'round';
    const M = 60;
    g.strokeRect(M, M, 1024 - M * 2, 1536 - M * 2);
    for (let i = 0; i < 7; i++) {
      const y = 300 + i * 120;
      g.beginPath(); g.moveTo(220, y); g.lineTo(804, y); g.stroke();
    }
    // parade circle round the flag pole (north centre)
    g.beginPath(); g.arc(512, 190, 90, 0, 7); g.stroke();
    g.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 240; i++) {
      g.fillStyle = `rgba(0,0,0,${.1 + Math.random() * .3})`;
      g.beginPath(); g.arc(Math.random() * 1024, Math.random() * 1536, 1 + Math.random() * 5, 0, 7); g.fill();
    }
    g.globalCompositeOperation = 'source-over';
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function classroom(x: number, z: number, w: number): { g: THREE.Group; obs: Obstacle[] } {
  const g = new THREE.Group();
  const wall = new THREE.MeshStandardMaterial({ color: 0xf0e6cc, roughness: .9 });
  const gable = new THREE.MeshStandardMaterial({ color: 0x8a4a3a, roughness: .85 });
  g.add(box(w, 3.2, 5.6, wall, 0, 1.6, 0));
  // veranda roof slab + columns — the classic naija school block
  g.add(box(w + 1.6, .22, 7.6, gable, 0, 3.3, .5));
  for (let i = -Math.floor(w / 4); i <= Math.floor(w / 4); i++)
    g.add(box(.22, 2.6, .22, new THREE.MeshStandardMaterial({ color: 0xb8b0a2 }), i * 4, 1.3, 3.4));
  // windows + doors — dark openings down the wall
  const winMat = new THREE.MeshStandardMaterial({ color: 0x37474f, roughness: .4 });
  for (let i = -Math.floor(w / 5); i <= Math.floor(w / 5); i++)
    g.add(box(1.4, 1.2, .08, winMat, i * 5, 1.7, 2.84, false));
  g.position.set(x, 0, z);
  const obs: Obstacle[] = [];
  for (let i = -w / 2 + 1.5; i <= w / 2 - 1.5; i += 3) obs.push({ x: x + i, z, r: 3.1 });
  return { g, obs };
}

function bench(x: number, z: number, ry: number): { g: THREE.Group; ob: Obstacle } {
  const g = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ color: 0x9a6a3a, roughness: .9 });
  g.add(box(2.4, .12, .5, wood, 0, .5, 0));
  for (const lx of [-1, 1]) g.add(box(.12, .5, .44, wood, lx, .25, 0));
  g.position.set(x, 0, z); g.rotation.y = ry;
  return { g, ob: { x, z, r: 1.1 } };
}

function flagPole(x: number, z: number): { g: THREE.Group; ob: Obstacle } {
  const g = new THREE.Group();
  const p = new THREE.Mesh(new THREE.CylinderGeometry(.06, .09, 9, 8),
    new THREE.MeshStandardMaterial({ color: 0xd8d0c4, metalness: .4, roughness: .5 }));
  p.position.y = 4.5; p.castShadow = true;
  g.add(p);
  // green-white-green, drooping in the afternoon heat
  const cols = [0x0f7a3d, 0xf5efe0, 0x0f7a3d];
  for (let i = 0; i < 3; i++) {
    const f = new THREE.Mesh(new THREE.PlaneGeometry(.42, .8),
      new THREE.MeshStandardMaterial({ color: cols[i], side: THREE.DoubleSide, roughness: .9 }));
    f.position.set(.24 + i * .42, 8.4 - i * .04, 0);
    f.rotation.z = -.12; f.rotation.y = .2;
    g.add(f);
  }
  g.position.set(x, 0, z);
  return { g, ob: { x, z, r: .6 } };
}

export function buildSchool(scene: THREE.Scene): World {
  const root = new THREE.Group();
  scene.add(root);
  const add = (o: THREE.Object3D) => { root.add(o); return o; };
  const obstacles: Obstacle[] = [];
  const spectators: Bean[] = [];
  const B = { minX: -PITCH_W / 2, maxX: PITCH_W / 2, minZ: -PITCH_H / 2, maxZ: PITCH_H / 2 };

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(PITCH_W + 30, PITCH_H + 30),
    new THREE.MeshStandardMaterial({ map: schoolGroundTexture(), roughness: 1 }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  add(ground);

  // ---- school walls — cream with a sky-blue top strip
  const gx = PITCH_W / 2 + .9, gz = PITCH_H / 2 + .9;
  const wallMat = new THREE.MeshStandardMaterial({ color: 0xe8dcbd, roughness: .95 });
  const stripMat = new THREE.MeshStandardMaterial({ color: 0x6fa8c8, roughness: .85 });
  const mkWall = (x: number, z: number, w: number, d: number) => {
    add(box(w, 2.0, d, wallMat, x, 1.0, z));
    add(box(w === .5 ? .56 : w, .16, d === .5 ? .56 : d, stripMat, x, 2.04, z, false));
  };
  mkWall(0, -gz, PITCH_W + 2.4, .5);
  mkWall(0, gz, PITCH_W + 2.4, .5);
  mkWall(-gx, 0, .5, PITCH_H + 2.4);
  mkWall(gx, 0, .5, PITCH_H + 2.4);
  // gate pillars south
  add(box(.9, 2.2, .9, stripMat, -3, 1.1, gz + .4));
  add(box(.9, 2.2, .9, stripMat, 3, 1.1, gz + .4));

  // ---- the two classroom blocks — long buildings make the lanes
  const c1 = classroom(0, -16, 24); add(c1.g); obstacles.push(...c1.obs);
  const c2 = classroom(-3, 16, 18); add(c2.g); obstacles.push(...c2.obs);

  // ---- flag pole on the parade circle (north centre)
  const fp = flagPole(0, -22.4); add(fp.g); obstacles.push(fp.ob);

  // ---- benches under the east wall
  for (const [bx, bz, r] of [[14, -4, 0], [14, 0, 0], [14, 4, 0]] as const) {
    const b = bench(bx, bz, Math.PI / 2); add(b.g); obstacles.push(b.ob);
  }

  // ---- mango trees for shade + a water drum by class 2
  const tr1 = mangoTree(-13, -21, 1.2); add(tr1); obstacles.push({ x: -13, z: -21, r: 1 });
  const tr2 = mangoTree(13, 20, 1.05); add(tr2); obstacles.push({ x: 13, z: 20, r: 1 });
  const tr3 = mangoTree(-14, 8, .9); add(tr3); obstacles.push({ x: -14, z: 8, r: .9 });
  const drum = new THREE.Mesh(new THREE.CylinderGeometry(.7, .7, 1.3, 12),
    new THREE.MeshStandardMaterial({ color: 0x3f7d9c, roughness: .8 }));
  drum.position.set(8, .65, 13); drum.castShadow = true;
  add(drum); obstacles.push({ x: 8, z: 13, r: 1.1 });

  // ---- staffroom block + neighbour flats outside
  add(building(-gx - 10, -18, 10, 7, 9, 0xd8b06a));
  add(building(gx + 11, 10, 9, 9, 8, 0x9fb8a8));
  add(building(-8, gz + 12, 12, 8, 9, 0xc88a6a));

  // ---- pupils: assembly rows up north + strays along the walls
  const kids: [number, number, number][] = [];
  for (let r = 0; r < 4; r++)
    for (let i = -4; i <= 4; i++)
      if (Math.random() < .8) kids.push([i * 1.5 + rand(-.2, .2), -19 + r * 1.4, 0]);
  for (let z = -18; z < 22; z += rand(5, 8)) kids.push([-gx + .3, z, Math.PI / 2]);
  for (let x = -14; x < 15; x += rand(4, 7)) kids.push([x, gz + 2, Math.PI]);
  for (const [sx, sz, ry] of kids) {
    const b = makeBean(pick(PALETTE));
    b.root.position.set(sx, 0, sz);
    b.root.rotation.y = ry + rand(-.3, .3);
    b.root.scale.setScalar(rand(.68, .8)); // they're small — it's primary school
    add(b.root);
    spectators.push(b);
  }

  // ---- lighting — slightly harsher midday
  const sun = new THREE.DirectionalLight(0xffecca, 2.7);
  sun.position.set(-18, 34, -12);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -45; sun.shadow.camera.right = 45;
  sun.shadow.camera.top = 45; sun.shadow.camera.bottom = -45;
  sun.shadow.camera.far = 90;
  sun.shadow.bias = -0.0004;
  add(sun);
  const hemi = new THREE.HemisphereLight(0xd4e8ff, 0x8a5a34, .9);
  add(hemi);
  const bounce = new THREE.DirectionalLight(0xffc890, .3);
  bounce.position.set(18, 12, 20);
  add(bounce);

  scene.fog = new THREE.Fog(0xe8cfa8, 75, 170);

  // ---- the refuge stays — a corner of the staffroom is "staff only"
  const safeZone: SafeZone = { x: 8, z: 13, r: 2.6 }; // the water drum shade

  return { root, bounds: B, obstacles, spectators, safeZone, sun, hemi };
}

export function disposeWorld(scene: THREE.Scene, w: World) {
  scene.remove(w.root);
}

export function updateWorld(w: World, dt: number) {
  for (const b of w.spectators) idleBean(b, dt);
}
