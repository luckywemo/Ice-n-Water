// Generate the game's voice pack via YarnGPT (real Nigerian voices).
// Usage: node gen-voices.mjs            — generate ALL lines
//        node gen-voices.mjs voice-nepa — regenerate one file
// Reads the API key from .env (YARNGPT_KEY).

import { readFileSync, writeFileSync } from 'fs';
import { randomUUID } from 'crypto';

const KEY = readFileSync('.env', 'utf8').match(/YARNGPT_KEY=(\S+)/)?.[1];
if (!KEY) throw new Error('YARNGPT_KEY missing from .env');

const API = 'https://api.yarngpt.ai/api/v1';
const MILITIA = 'nonso';   // bold, resonant — the captain
const ANNOUNCER = 'tayo';  // upbeat, energetic — the commentator

// NOTE: YarnGPT minimum is 20 chars — short shouts are repeated,
// which is exactly how the streets yell them anyway.
const LINES = [
  // — militia (nonso) —
  ['voice-i-go-catch-you', 'I go catch you! I go catch you!', MILITIA],
  ['voice-come-back-here', 'COME BACK HERE! COME BACK!', MILITIA],
  ['voice-you-can-run', 'You can run, but you cannot hide!', MILITIA],
  ['voice-wahala', 'Wahala for you! Wahala!', MILITIA],
  ['voice-i-dey-come', 'I dey come o! I dey come o!', MILITIA],
  ['voice-no-hiding', 'No hiding today! No hiding!', MILITIA],
  ['voice-one-down', 'ONE DOWN! ONE DOWN! ONE DOWN!', MILITIA],
  ['voice-dem-don-catch', 'Dem don catch you o!', MILITIA],
  ['voice-enter-cell', 'Enter cell! Enter cell!', MILITIA],
  ['voice-gotcha', 'Gotcha! Gotcha! Gotcha!', MILITIA],
  ['voice-get-luck', 'You get luck today o!', MILITIA],
  ['voice-who-open-cell', 'WHO OPEN THE CELL?! WHO?!', MILITIA],
  ['voice-dem-don-free', 'Dem don free them o! Dem don free them!', MILITIA],
  ['voice-heey-come-back', 'Heeeeey! Come back here!', MILITIA],
  ['voice-reinforcements', 'MILITIA REINFORCEMENTS!', MILITIA],
  // — announcer / player cries (tayo) —
  ['voice-ez-ah-how', 'AH! HOW?! HOW?! HOW?! HOW?!', ANNOUNCER],
  ['voice-ez-who-touch', 'WHO TOUCH YOU?! WHO?! WHO?!', ANNOUNCER],
  ['voice-ez-arrgh', 'Arrgh! Arrgh! Arrgh! Arrgh!', ANNOUNCER],
  ['voice-ez-danfo', 'DANFO! DANFO! DANFO!', ANNOUNCER],
  ['voice-ez-nepa', 'NEPA DON TAKE LIGHT! NEPA!', ANNOUNCER],
  ['voice-ez-up-nepa', 'UP NEPA! UP NEPA! UP NEPA! UP NEPA O!', ANNOUNCER],
  ['voice-ez-rain', 'RAIN! Watch your footing!', ANNOUNCER],
  ['voice-ez-jailbreak', 'JAILBREAK! JAILBREAK! JAILBREAK!', ANNOUNCER],
];

const only = process.argv[2];

async function synth(name, text, voice) {
  const res = await fetch(`${API}/tts`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${KEY}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': randomUUID(),
    },
    body: JSON.stringify({ text, voice, output_format: 'mp3' }),
  });
  if (!res.ok) throw new Error(`${name}: POST ${res.status} ${await res.text()}`);
  const { job_id } = await res.json();

  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 1500));
    const st = await fetch(`${API}/status/${job_id}`, {
      headers: { Authorization: `Bearer ${KEY}` },
    }).then((r) => r.json());
    if (st.status === 'completed') {
      const audio = await fetch(st.audio_url).then((r) => r.arrayBuffer());
      writeFileSync(`public/${name}.mp3`, Buffer.from(audio));
      return console.log(`${name}  ✓  (${(audio.byteLength / 1024).toFixed(0)} KB)`);
    }
    if (st.status === 'failed') throw new Error(`${name}: job failed`);
  }
  throw new Error(`${name}: timed out`);
}

for (const [name, text, voice] of LINES) {
  if (only && name !== only) continue;
  await synth(name, text, voice);
}
console.log('DONE');
