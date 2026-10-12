// Original retro sci-fi ambient music + SFX, synthesized with WebAudio after the first gesture.

export type Layer = 'title' | 'base' | 'night' | 'storm' | 'research' | 'emergency';

let ctx: AudioContext | null = null;
let master: GainNode | null = null, musicGain: GainNode | null = null, sfxGain: GainNode | null = null;
let windGain: GainNode | null = null, windFilter: BiquadFilterNode | null = null;
let musicOn = true, sfxOn = true;
let layer: Layer = 'title';
let nextTime = 0, step = 0;

const N = (n: string) => {
  const m = /^([A-G])(#?)(\d)$/.exec(n);
  if (!m) return 0;
  const i = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[m[1] as 'C'] + (m[2] ? 1 : 0);
  return 440 * Math.pow(2, (i + (Number(m[3]) + 1) * 12 - 69) / 12);
};
interface Song { bpm: number; arp: string[]; bass: string[]; pad: string[][]; lead?: string[]; perc: string; arpWave: OscillatorType; arpVol: number }
const S = (s: string) => s.split(' ');
const SONGS: Record<Layer, Song> = {
  title: { bpm: 84, arpWave: 'triangle', arpVol: 0.03, arp: S('A3 E4 A4 C5 E5 C5 A4 E4 F3 C4 F4 A4 C5 A4 F4 C4 D3 A3 D4 F4 A4 F4 D4 A3 E3 B3 E4 G#4 B4 G#4 E4 B3'), bass: S('A1 . . . . . . . F1 . . . . . . . D2 . . . . . . . E1 . . . . . . .'), pad: [['A3', 'C4', 'E4'], ['F3', 'A3', 'C4'], ['D3', 'F3', 'A3'], ['E3', 'G#3', 'B3']], perc: '................', lead: S('. . . . E5 . . . . . . . D5 . C5 . . . . . A4 . . . . . . . B4 . . .') },
  base: { bpm: 100, arpWave: 'square', arpVol: 0.018, arp: S('E4 B4 E5 B4 G4 B4 E5 F#5 C4 G4 C5 G4 E4 G4 C5 D5 D4 A4 D5 A4 F#4 A4 D5 E5 B3 F#4 B4 F#4 D#4 F#4 B4 C#5'), bass: S('E2 . E2 . . . B1 . C2 . C2 . . . G1 . D2 . D2 . . . A1 . B1 . B1 . . . F#1 .'), pad: [['E3', 'G3', 'B3'], ['C3', 'E3', 'G3'], ['D3', 'F#3', 'A3'], ['B2', 'D#3', 'F#3']], perc: 'k...h...k.k.h..h', lead: S('B4 . . . . . E5 . . . G5 . F#5 . . . E5 . . . . . D5 . . . F#5 . E5 . . .') },
  night: { bpm: 72, arpWave: 'sine', arpVol: 0.03, arp: S('C4 G4 C5 . E5 . C5 . A3 E4 A4 . C5 . A4 . F3 C4 F4 . A4 . F4 . G3 D4 G4 . B4 . G4 .'), bass: S('C2 . . . . . . . A1 . . . . . . . F1 . . . . . . . G1 . . . . . . .'), pad: [['C3', 'E3', 'G3', 'B3'], ['A2', 'C3', 'E3', 'G3'], ['F2', 'A2', 'C3', 'E3'], ['G2', 'B2', 'D3', 'F3']], perc: '................' },
  storm: { bpm: 90, arpWave: 'sawtooth', arpVol: 0.012, arp: S('D3 D3 A3 D3 F3 D3 A3 C4 D3 D3 A3 D3 G3 D3 A3 F3 A#2 A#2 F3 A#2 D3 A#2 F3 A3 C3 C3 G3 C3 E3 C3 G3 A#3'), bass: S('D1 . D1 . . D1 . . D1 . D1 . . D1 . . A#0 . A#0 . . A#0 . . C1 . C1 . . C1 . .'), pad: [['D3', 'F3', 'A3'], ['D3', 'G3', 'A#3'], ['A#2', 'D3', 'F3'], ['C3', 'E3', 'G3']], perc: 'k..hk..hk..hk.hh' },
  research: { bpm: 112, arpWave: 'square', arpVol: 0.016, arp: S('G4 D5 G5 B5 G5 D5 B4 D5 E4 B4 E5 G5 E5 B4 G4 B4 C5 G5 C6 E6 C6 G5 E5 G5 D5 A5 D6 F#6 D6 A5 F#5 A5'), bass: S('G2 . G2 . D2 . D2 . E2 . E2 . B1 . B1 . C2 . C2 . G1 . G1 . D2 . D2 . A1 . A1 .'), pad: [['G3', 'B3', 'D4'], ['E3', 'G3', 'B3'], ['C3', 'E3', 'G3'], ['D3', 'F#3', 'A3']], perc: 'k.h.k.h.k.h.khkh' },
  emergency: { bpm: 132, arpWave: 'sawtooth', arpVol: 0.016, arp: S('A3 A3 . A3 C4 . A3 . G3 G3 . G3 A#3 . G3 . F3 F3 . F3 A3 . F3 . E3 E3 . E3 G#3 . E3 .'), bass: S('A1 A1 A1 A1 A1 A1 A1 A1 G1 G1 G1 G1 G1 G1 G1 G1 F1 F1 F1 F1 F1 F1 F1 F1 E1 E1 E1 E1 E1 E1 E1 E1'), pad: [['A2', 'C3', 'E3'], ['G2', 'A#2', 'D3'], ['F2', 'A2', 'C3'], ['E2', 'G#2', 'B2']], perc: 'k.k.s.k.k.k.s.kk' },
};

function tone(freq: number, t: number, dur: number, type: OscillatorType, vol: number, dest: AudioNode, slide = 0, attack = 0.01) {
  if (!ctx || !freq) return;
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * slide), t + dur);
  g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(dest); o.start(t); o.stop(t + dur + 0.05);
}
let noiseBuf: AudioBuffer | null = null;
function noise(t: number, dur: number, vol: number, dest: AudioNode, type: BiquadFilterType = 'highpass', freq = 3000, q = 0.7) {
  if (!ctx) return;
  if (!noiseBuf) { noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate); const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; }
  const s = ctx.createBufferSource(); s.buffer = noiseBuf;
  const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
  const g = ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(f).connect(g).connect(dest); s.start(t, Math.random()); s.stop(t + dur + 0.05);
}

function schedule() {
  if (!ctx || !musicGain) return;
  const song = SONGS[layer];
  const spb = 60 / song.bpm / 2;
  while (nextTime < ctx.currentTime + 0.3) {
    const i = step % 32;
    const a = song.arp[i];
    if (a && a !== '.') tone(N(a), nextTime, spb * 1.4, song.arpWave, song.arpVol, musicGain);
    const b = song.bass[i];
    if (b && b !== '.') tone(N(b), nextTime, spb * (layer === 'emergency' ? 0.9 : 3.5), 'triangle', 0.09, musicGain);
    const l = song.lead?.[i];
    if (l && l !== '.') tone(N(l), nextTime, spb * 5, 'triangle', 0.035, musicGain, 0, 0.08);
    if (i % 8 === 0) for (const p of song.pad[Math.floor(i / 8) % 4]) tone(N(p), nextTime, spb * 8.5, 'sine', 0.016, musicGain, 0, 0.6);
    const d = song.perc[i % 16];
    if (d === 'k') tone(90, nextTime, 0.14, 'sine', 0.11, musicGain, 0.45);
    if (d === 'h') noise(nextTime, 0.03, 0.025, musicGain, 'highpass', 8000);
    if (d === 's') noise(nextTime, 0.1, 0.05, musicGain, 'bandpass', 1800, 0.8);
    nextTime += spb; step++;
  }
}

export function startAudio() {
  if (ctx) { if (ctx.state === 'suspended') void ctx.resume(); return; }
  try {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    ctx = new AC();
    master = ctx.createGain(); master.gain.value = 0.8; master.connect(ctx.destination);
    musicGain = ctx.createGain(); musicGain.gain.value = musicOn ? 0.5 : 0; musicGain.connect(master);
    sfxGain = ctx.createGain(); sfxGain.gain.value = sfxOn ? 0.8 : 0; sfxGain.connect(master);
    // continuous wind bed
    const buf = ctx.createBuffer(1, ctx.sampleRate * 3, ctx.sampleRate);
    const d = buf.getChannelData(0); let last = 0;
    for (let i = 0; i < d.length; i++) { last = last * 0.97 + (Math.random() * 2 - 1) * 0.03; d[i] = last * 6; }
    const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
    windFilter = ctx.createBiquadFilter(); windFilter.type = 'lowpass'; windFilter.frequency.value = 500;
    windGain = ctx.createGain(); windGain.gain.value = 0.05;
    src.connect(windFilter).connect(windGain).connect(sfxGain); src.start();
    nextTime = ctx.currentTime + 0.1;
    window.setInterval(schedule, 100);
  } catch { ctx = null; }
}
export function setMusic(on: boolean) { musicOn = on; if (musicGain && ctx) musicGain.gain.setTargetAtTime(on ? 0.5 : 0, ctx.currentTime, 0.2); }
export function setSfx(on: boolean) { sfxOn = on; if (sfxGain && ctx) sfxGain.gain.setTargetAtTime(on ? 0.8 : 0, ctx.currentTime, 0.05); }
export function setWind(level: number) { if (!ctx || !windGain || !windFilter) return; windGain.gain.setTargetAtTime(0.03 + level * 0.25, ctx.currentTime, 1.5); windFilter.frequency.setTargetAtTime(400 + level * 1400, ctx.currentTime, 1.5); }
export function setLayer(l: Layer) {
  if (l === layer || !ctx || !musicGain) { layer = l; return; }
  const g = musicGain, c = ctx;
  g.gain.setTargetAtTime(0, c.currentTime, 0.3);
  setTimeout(() => { layer = l; step = 0; nextTime = c.currentTime + 0.05; if (musicOn) g.gain.setTargetAtTime(0.5, c.currentTime, 0.6); }, 800);
}
export function sfx(name: string) {
  if (!ctx || !sfxGain || !sfxOn) return;
  const t = ctx.currentTime + 0.005, d = sfxGain;
  switch (name) {
    case 'click': tone(900, t, 0.03, 'square', 0.03, d); break;
    case 'open': tone(500, t, 0.06, 'triangle', 0.06, d, 1.8); break;
    case 'close': tone(700, t, 0.06, 'triangle', 0.05, d, 0.55); break;
    case 'core': tone(988, t, 0.08, 'sine', 0.07, d); tone(1480, t + 0.08, 0.14, 'sine', 0.06, d); break;
    case 'think': for (let i = 0; i < 4; i++) tone(700 + i * 160, t + i * 0.05, 0.05, 'sine', 0.03, d); break;
    case 'plan': [523, 784, 1047].forEach((f, i) => tone(f, t + i * 0.06, 0.12, 'triangle', 0.05, d)); break;
    case 'confirm': tone(660, t, 0.07, 'square', 0.05, d); tone(990, t + 0.07, 0.14, 'square', 0.05, d); break;
    case 'error': tone(240, t, 0.15, 'square', 0.06, d, 0.7); tone(180, t + 0.12, 0.2, 'square', 0.05, d, 0.7); break;
    case 'build': for (let i = 0; i < 3; i++) { noise(t + i * 0.07, 0.04, 0.12, d, 'bandpass', 2400, 2); tone(1200 + i * 200, t + i * 0.07, 0.02, 'square', 0.02, d); } break;
    case 'drill': noise(t, 0.12, 0.08, d, 'bandpass', 900, 3); tone(140, t, 0.1, 'sawtooth', 0.02, d, 0.8); break;
    case 'airlock': noise(t, 0.35, 0.09, d, 'bandpass', 1500, 0.6); tone(120, t + 0.25, 0.1, 'square', 0.04, d, 0.6); break;
    case 'dock': tone(300, t, 0.08, 'triangle', 0.05, d, 2); tone(600, t + 0.08, 0.1, 'triangle', 0.04, d); break;
    case 'deliver': tone(220, t, 0.06, 'square', 0.05, d, 0.6); noise(t, 0.05, 0.06, d, 'lowpass', 700); break;
    case 'online': [262, 392, 523, 784, 1047].forEach((f, i) => tone(f, t + i * 0.07, 0.25, 'square', 0.04, d)); tone(110, t, 0.5, 'sawtooth', 0.04, d, 2); break;
    case 'warn': tone(880, t, 0.12, 'square', 0.05, d); tone(660, t + 0.15, 0.12, 'square', 0.05, d); break;
    case 'alarm': for (let i = 0; i < 3; i++) { tone(1046, t + i * 0.28, 0.12, 'square', 0.06, d); tone(784, t + i * 0.28 + 0.13, 0.12, 'square', 0.06, d); } break;
    case 'stage': [392, 523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, t + i * 0.1, 0.35, 'square', 0.045, d)); break;
    case 'shuttle': noise(t, 2.5, 0.2, d, 'lowpass', 300); tone(55, t, 2.4, 'sawtooth', 0.05, d, 0.7); break;
    case 'impact': noise(t, 0.8, 0.4, d, 'lowpass', 400); tone(60, t, 0.6, 'sine', 0.2, d, 0.4); break;
    case 'research': [523, 659, 784, 988, 1175, 1568].forEach((f, i) => tone(f, t + i * 0.07, 0.3, 'triangle', 0.05, d)); break;
    case 'robot': tone(200, t, 0.3, 'sawtooth', 0.04, d, 3); [784, 1047].forEach((f, i) => tone(f, t + 0.3 + i * 0.08, 0.12, 'square', 0.04, d)); break;
    case 'done': [523, 659, 784, 1047].forEach((f, i) => tone(f, t + i * 0.06, 0.12, 'square', 0.035, d)); break;
    case 'motor': tone(110 + Math.random() * 30, t, 0.15, 'sawtooth', 0.012, d, 1.1); break;
  }
}
export const audioReady = () => !!ctx;
