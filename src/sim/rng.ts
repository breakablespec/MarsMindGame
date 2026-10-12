// Deterministic randomness. The live sim keeps its RNG state inside GameState so that
// the same seed + the same action sequence always produces the same colony.

export function mulberry32Step(s: number): [number, number] {
  s = (s + 0x6d2b79f5) >>> 0;
  let t = s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return [((t ^ (t >>> 14)) >>> 0) / 4294967296, s];
}

/** Stateless hash-noise: same inputs → same number in [0,1). Used for world gen and weather. */
export function hashNoise(...xs: number[]): number {
  let h = 0x811c9dc5;
  for (const x of xs) {
    h ^= x | 0;
    h = Math.imul(h, 0x01000193);
    h ^= h >>> 13;
    h = Math.imul(h, 0x5bd1e995);
    h ^= h >>> 15;
  }
  return (h >>> 0) / 4294967296;
}

export class StreamRng {
  constructor(public s: number) {}
  next(): number {
    const [v, s] = mulberry32Step(this.s);
    this.s = s;
    return v;
  }
  int(lo: number, hi: number): number {
    return lo + Math.floor(this.next() * (hi - lo + 1));
  }
  pick<T>(arr: T[]): T {
    return arr[Math.floor(this.next() * arr.length)];
  }
}
