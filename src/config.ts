export const CONFIG = {
  // camera viewport — the canvas + all HUD coordinates
  view: { width: 1280, height: 800 },
  // the world itself — much bigger than what you see; camera follows you
  arena: { width: 2304, height: 1440, wall: 22 },
  camera: { zoom: 1.15, deadzone: { w: 120, h: 70 } },

  round: {
    seconds: 90,
    countdownSec: 3,
    reinforceAt: 0.5, // second militia joins when this fraction of time remains
  },

  runner: {
    radius: 14,
    speed: 205,
    sprintSpeed: 272,
    sprintDrain: 0.75, // per second
    staminaRegen: 0.4, // per second
    accel: 14, // higher = snappier
    adrenalineMult: 1.1, // speed boost for the last free runner
  },

  chaser: {
    radius: 15,
    speed: 196,
    dash: {
      cooldownMs: 5200,
      warnMs: 480, // telegraph flash before dashing — dodge window
      durMs: 430,
      mult: 1.55,
    },
  },

  heartbeat: {
    radius: 320, // chaser proximity that triggers the pulse + vignette
    minMs: 270, // fastest thump interval
    maxMs: 650,
  },

  aiRunners: 4,

  tagRange: 27, // chaser reach — "arm's length" rule from the street game
  thawRange: 30,
  thawImmunityMs: 1400, // can't be re-frozen instantly after rescue
  charmImmunityMs: 1000, // brief window after juju charm blocks a tag

  items: {
    slippers: { count: 3, speedMult: 1.4, durationMs: 6000 },
    charm: { count: 2 },
    water: { count: 2, thawRange: 190 },
    key: { count: 2, jailRange: 230 }, // police mode — instant jailbreak near the cell
    respawnMs: 8000,
  },

  // police & thief mode — the jail cell top-left of the yard
  jail: {
    x: 118,
    y: 108,
    w: 124,
    h: 92,
    pad: { x: 118, y: 246, r: 36 }, // stand here to break mates out
    channelMs: 2400,
  },

  // named crew — each AI mate gets a personality
  crew: [
    { name: 'Ngozi', fleeMult: 0.85, speedMult: 0.95, rescue: 1.0, seeksItems: false }, // the hero
    { name: 'Emeka', fleeMult: 1.35, speedMult: 1.02, rescue: 0.25, seeksItems: false }, // the coward
    { name: 'Tunde', fleeMult: 0.6, speedMult: 1.08, rescue: 0.6, seeksItems: false }, // reckless
    { name: 'Fatima', fleeMult: 1.0, speedMult: 0.95, rescue: 0.8, seeksItems: true }, // the smart one
    { name: 'Chidi', fleeMult: 1.0, speedMult: 0.92, rescue: 0.7, seeksItems: false },
    { name: 'Blessing', fleeMult: 1.05, speedMult: 0.92, rescue: 0.7, seeksItems: true },
  ],

  // militia voice — Pidgin barks floating over the chasers' heads
  barks: {
    hunt: [
      'I go catch you!',
      'COME BACK HERE!',
      'You can run but...',
      'Wahala for you!',
      'I dey come o!',
      'No hiding today!',
    ],
    catch: ['ONE DOWN!', 'Dem don catch you!', 'Enter cell!', 'Gotcha!'],
    dodge: ['AH! HOW?!', 'WHO TOUCH YOU?!', 'You get luck today!', 'Arrgh!'],
    jailbreak: ['WHO OPEN CELL?!', 'Dem don free them o!', 'Heeeeey! Come back!'],
  },

  // random mid-round chaos
  events: {
    delayMs: { min: 14000, max: 21000 },
    danfo: { speed: 175 },
    nepa: { durationMs: 7000, lightRadius: 250 },
    rain: { durationMs: 6000, accelMult: 0.32 },
  },

  ai: {
    fleeRadius: 250,
    runnerThinkMs: 130,
    chaserThinkMs: 100,
    stuckWindowMs: 500,
    stuckDist: 14,
    strafeMs: 650,
    probeAhead: 72,
  },

  // obstacles come from mapgen.generateLayout(seed) — a fresh layout each round

  colors: {
    skin1: 0x6b4423,
    skin2: 0x7d5230,
    skin3: 0x54341c,
    chalk: 0xf5efe0,
    ground: 0xd8c9a3, // dusty schoolyard sand
    wall: 0x6b5537,
    obstacle: 0x8a6d4b,
    player: 0x2f9bff,
    runner: 0x4ecb71,
    frozen: 0x9adcf0,
    chaser: 0xe84848,
    slippers: 0xffd54a,
    charm: 0xb388ff,
    water: 0x4dd0e1,
    key: 0xf0c04a,
  },
} as const;
