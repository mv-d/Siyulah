// Synthesises the soundtrack (a warm pad, a soft plucked arpeggio and a sub bass in
// D major, 84 BPM) into public/music.wav. Deterministic, no samples, no licences.
// Usage: node music.mjs [seconds]
import fs from "node:fs";

const RATE = 44100;
const SECONDS = Number(process.argv[2] ?? 80);
const N = Math.floor(RATE * SECONDS);
const L = new Float32Array(N);
const R = new Float32Array(N);

const BEAT = 60 / 84;
const CHORD_LEN = BEAT * 8; // two bars per chord
const hz = (midi) => 440 * 2 ** ((midi - 69) / 12);
// Dmaj9, Bm9, Gmaj9, A6sus: voiced low and open
const CHORDS = [
  [50, 57, 61, 64, 66],
  [47, 54, 57, 61, 62],
  [43, 50, 54, 57, 59],
  [45, 52, 57, 59, 64],
];

function add(buf, i, v) {
  if (i >= 0 && i < N) buf[i] += v;
}

// Pad: detuned partials with a slow swell per chord.
const chordCount = Math.ceil(SECONDS / CHORD_LEN) + 1;
for (let c = 0; c < chordCount; c++) {
  const chord = CHORDS[c % CHORDS.length];
  const t0 = c * CHORD_LEN;
  const len = CHORD_LEN + 1.8;
  const s0 = Math.floor(t0 * RATE);
  const sN = Math.floor(len * RATE);
  for (const note of chord) {
    const f = hz(note);
    for (let k = 0; k < sN; k++) {
      const t = k / RATE;
      const env = Math.min(1, t / 1.4) * Math.min(1, Math.max(0, (len - t) / 1.8));
      const vib = 1 + 0.0012 * Math.sin(2 * Math.PI * 0.21 * (t0 + t));
      const base = 2 * Math.PI * f * vib * t;
      const tone = Math.sin(base) + 0.3 * Math.sin(2 * base) + 0.08 * Math.sin(3 * base);
      const detL = Math.sin(base * 1.0015);
      const detR = Math.sin(base * 0.9985);
      const v = 0.028 * env;
      add(L, s0 + k, v * (tone + 0.6 * detL));
      add(R, s0 + k, v * (tone + 0.6 * detR));
    }
  }
  // Sub bass on the root.
  const root = hz(chord[0] - 12);
  for (let k = 0; k < sN; k++) {
    const t = k / RATE;
    const env = Math.min(1, t / 0.6) * Math.min(1, Math.max(0, (len - t) / 1.8));
    const v = 0.06 * env * Math.sin(2 * Math.PI * root * t);
    add(L, s0 + k, v);
    add(R, s0 + k, v);
  }
}

// Plucked arpeggio in eighth notes, from bar 3 until the last chord, with two echoes.
const PATTERN = [0, 2, 3, 4, 3, 2, 1, 2];
const startPluck = CHORD_LEN * 0.9;
const endPluck = SECONDS - CHORD_LEN * 0.8;
for (let t0 = startPluck, step = 0; t0 < endPluck; t0 += BEAT / 2, step++) {
  const chord = CHORDS[Math.floor(t0 / CHORD_LEN) % CHORDS.length];
  const f = hz(chord[PATTERN[step % PATTERN.length]] + 12);
  const accent = step % 8 === 0 ? 1 : step % 2 === 0 ? 0.8 : 0.62;
  const pan = 0.5 + 0.28 * Math.sin(step * 0.9);
  const dur = 1.4;
  for (const [delay, gain, flip] of [
    [0, 1, false],
    [0.321, 0.32, true],
    [0.643, 0.14, false],
  ]) {
    const s0 = Math.floor((t0 + delay) * RATE);
    for (let k = 0; k < dur * RATE; k++) {
      const t = k / RATE;
      const env = Math.min(1, t / 0.004) * Math.exp(-t / 0.32);
      const x = 2 * Math.PI * f * t;
      const v = 0.05 * accent * gain * env * (Math.sin(x) + 0.18 * Math.sin(2 * x));
      const p = flip ? 1 - pan : pan;
      add(L, s0 + k, v * (1 - p) * 1.4);
      add(R, s0 + k, v * p * 1.4);
    }
  }
}

// Master: gentle saturation, fade in and out, normalise, write 16-bit stereo PCM.
let peak = 0;
for (let i = 0; i < N; i++) {
  const t = i / RATE;
  const fade = Math.min(1, t / 2.5) * Math.min(1, Math.max(0, (SECONDS - t) / 4));
  L[i] = Math.tanh(L[i] * 1.2) * fade;
  R[i] = Math.tanh(R[i] * 1.2) * fade;
  peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
}
const gain = 0.7 / (peak || 1);
const buf = Buffer.alloc(44 + N * 4);
buf.write("RIFF", 0);
buf.writeUInt32LE(36 + N * 4, 4);
buf.write("WAVEfmt ", 8);
buf.writeUInt32LE(16, 16);
buf.writeUInt16LE(1, 20);
buf.writeUInt16LE(2, 22);
buf.writeUInt32LE(RATE, 24);
buf.writeUInt32LE(RATE * 4, 28);
buf.writeUInt16LE(4, 32);
buf.writeUInt16LE(16, 34);
buf.write("data", 36);
buf.writeUInt32LE(N * 4, 40);
for (let i = 0; i < N; i++) {
  buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, L[i] * gain)) * 32767), 44 + i * 4);
  buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, R[i] * gain)) * 32767), 46 + i * 4);
}
fs.mkdirSync("public", { recursive: true });
fs.writeFileSync("public/music.wav", buf);
console.log(`public/music.wav: ${SECONDS}s, ${(buf.length / 1e6).toFixed(1)} MB`);
