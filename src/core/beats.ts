// Beat tracking for music sync.
//
// 1. Onset strength: half-wave rectified log-spectral flux.
// 2. Tempo: autocorrelation of the onset envelope, weighted toward ~120 BPM.
// 3. Beats: dynamic-programming tracker (Ellis, 2007) that balances onset
//    strength against keeping a steady tempo.
// 4. Downbeat: the beat phase (of 4) with the strongest onsets.
// 5. Character per beat (loudness, bass, brightness), accents (the hits that
//    stand out) and sections (see sections.ts).

import { findSections, type Section } from './sections'

export interface BeatResult {
  bpm: number
  /** Beat times in seconds (audio time). */
  beats: number[]
  /** Index of the first downbeat in `beats`. */
  downbeat: number
  /** Loudness of each beat (RMS from this beat to the next), normalised so the loudest is 1. */
  energy: number[]
  /** Low-frequency (kick/bass, < ~150 Hz) loudness per beat, normalised. */
  bass: number[]
  /** Share of high-frequency content per beat (hats, cymbals, brightness), normalised. */
  bright: number[]
  /** Times (s) of accents: hits that stand clearly above their surroundings. */
  accents: number[]
  /** Song structure: intro, verse, build, drop, break, outro. */
  sections: Section[]
}

const TARGET_SR = 11025
const FRAME = 512
const HOP = 128

export function detectBeats(samples: Float32Array, sampleRate: number): BeatResult {
  // Downsample with a box filter.
  const factor = Math.max(1, Math.round(sampleRate / TARGET_SR))
  const sr = sampleRate / factor
  const len = Math.floor(samples.length / factor)
  const x = new Float32Array(len)
  for (let i = 0; i < len; i++) {
    let s = 0
    for (let k = 0; k < factor; k++) s += samples[i * factor + k]!
    x[i] = s / factor
  }
  const env = onsetEnvelope(x)
  const hopTime = HOP / sr
  if (env.length < 64) return { bpm: 0, beats: [], downbeat: 0, energy: [], bass: [], bright: [], accents: [], sections: [] }

  const period = estimatePeriod(env, hopTime)
  const frames = trackBeats(env, period)
  const beats = frames.map((f) => f * hopTime + FRAME / 2 / sr)

  // Downbeat: phase with the most onset energy.
  let bestPhase = 0, bestScore = -Infinity
  for (let ph = 0; ph < 4; ph++) {
    let s = 0, c = 0
    for (let i = ph; i < frames.length; i += 4) { s += env[frames[i]!]!; c++ }
    const score = c ? s / c : 0
    if (score > bestScore) { bestScore = score; bestPhase = ph }
  }
  const downbeat = Math.min(bestPhase, Math.max(0, beats.length - 1))
  const energy = beatEnergy(x, sr, beats)
  const { bass, bright } = beatCharacter(x, sr, beats)
  const accents = findAccents(env, hopTime, FRAME / 2 / sr, period * hopTime)
  const duration = x.length / sr
  const sections = findSections({ beats, downbeat, energy, bass, bright, accents, duration })
  // Where the music steps up (a drop, a chorus), the first hit is an accent too.
  for (let i = 1; i < sections.length; i++) {
    const a = sections[i - 1]!, b = sections[i]!
    if (b.energy < a.energy * 1.3 + 0.05 || accents.some((t) => Math.abs(t - b.start) < 0.3)) continue
    // Snap to the strongest onset within ±0.25 s of the boundary.
    const f0 = Math.max(0, Math.round((b.start - 0.25 - FRAME / 2 / sr) / hopTime)), f1 = Math.min(env.length - 1, Math.round((b.start + 0.25 - FRAME / 2 / sr) / hopTime))
    let bf = f0
    for (let f = f0; f <= f1; f++) if (env[f]! > env[bf]!) bf = f
    accents.push(Math.round((bf * hopTime + FRAME / 2 / sr) * 1000) / 1000)
  }
  accents.sort((p, q) => p - q)
  return { bpm: 60 / (period * hopTime), beats, downbeat, energy, bass, bright, accents, sections }
}

/** One-pole low-pass, in place on a copy. */
function lowpass(x: Float32Array, sr: number, fc: number): Float32Array {
  const a = Math.exp((-2 * Math.PI * fc) / sr)
  const out = new Float32Array(x.length)
  let y = 0
  for (let i = 0; i < x.length; i++) { y = (1 - a) * x[i]! + a * y; out[i] = y }
  return out
}

/** Per-beat bass loudness and brightness (high-band share), each normalised to its maximum. */
export function beatCharacter(x: Float32Array, sr: number, beats: number[]): { bass: number[]; bright: number[] } {
  if (!beats.length) return { bass: [], bright: [] }
  // Two passes of a one-pole filter ≈ a gentle 12 dB/octave slope.
  const low = lowpass(lowpass(x, sr, 150), sr, 150)
  const mid = lowpass(lowpass(x, sr, 2000), sr, 2000)
  const bass: number[] = [], bright: number[] = []
  beats.forEach((b, i) => {
    const a = Math.max(0, Math.floor(b * sr))
    const next = beats[i + 1] ?? b + (i > 0 ? b - beats[i - 1]! : 0.5)
    const e = Math.min(x.length, Math.max(a + 1, Math.floor(next * sr)))
    let sl = 0, sh = 0, st = 0
    for (let k = a; k < e; k++) {
      sl += low[k]! * low[k]!
      const h = x[k]! - mid[k]!
      sh += h * h
      st += x[k]! * x[k]!
    }
    const m = Math.max(1, e - a)
    bass.push(Math.sqrt(sl / m))
    bright.push(st > 1e-12 ? Math.sqrt(sh / st) : 0)
  })
  const nb = Math.max(...bass, 1e-9), nh = Math.max(...bright, 1e-9)
  return { bass: bass.map((v) => Math.round((v / nb) * 100) / 100), bright: bright.map((v) => Math.round((v / nh) * 100) / 100) }
}

/**
 * Accents: onset peaks that stand well above the typical hits just before
 * them (70th percentile of peaks in the previous 4 s) and are at least as
 * strong as those just after — a crash opening a drop, a hit after a quiet
 * bar — not the last kicks before a break. At most one every two beats.
 */
export function findAccents(env: Float32Array, hopTime: number, offset: number, beatLen: number): number[] {
  const n = env.length
  const peaks: { f: number; v: number }[] = []
  for (let f = 1; f < n - 1; f++) if (env[f]! >= env[f - 1]! && env[f]! > env[f + 1]! && env[f]! > 0.5) peaks.push({ f, v: env[f]! })
  const w = Math.max(8, Math.round(4 / hopTime))
  // Only the song's strongest onsets qualify (top 10% of peaks, and well above the noise).
  const sorted = peaks.map((p) => p.v).sort((a, b) => a - b)
  const strong = Math.max(4, sorted[Math.floor(sorted.length * 0.9)] ?? 4)
  const cands: { f: number; v: number }[] = []
  let lo = 0
  for (let i = 0; i < peaks.length; i++) {
    const p = peaks[i]!
    while (peaks[lo]!.f < p.f - w) lo++
    const before: number[] = [], after: number[] = []
    for (let k = lo; k < peaks.length && peaks[k]!.f <= p.f + w; k++) {
      if (k < i) before.push(peaks[k]!.v)
      else if (k > i) after.push(peaks[k]!.v)
    }
    const pct = (a: number[]) => { if (!a.length) return 0; a.sort((x, y) => x - y); return a[Math.floor(a.length * 0.7)]! }
    if (p.v > strong && p.v > 2.2 * pct(before) && p.v > 1.1 * pct(after)) cands.push(p)
  }
  // Strongest first, at most one every two beats.
  cands.sort((p, q) => q.v - p.v)
  const minGap = Math.max(1, Math.round((beatLen * 1.9) / hopTime))
  const taken: number[] = []
  for (const c of cands) if (taken.every((t) => Math.abs(t - c.f) >= minGap)) taken.push(c.f)
  return taken.sort((p, q) => p - q).map((f) => Math.round((f * hopTime + offset) * 1000) / 1000)
}

/** RMS of the signal between consecutive beats, normalised to the loudest beat. */
export function beatEnergy(x: Float32Array, sr: number, beats: number[]): number[] {
  if (!beats.length) return []
  const out = beats.map((b, i) => {
    const a = Math.max(0, Math.floor(b * sr))
    const next = beats[i + 1] ?? b + (i > 0 ? b - beats[i - 1]! : 0.5)
    const e = Math.min(x.length, Math.max(a + 1, Math.floor(next * sr)))
    let s = 0
    for (let k = a; k < e; k++) s += x[k]! * x[k]!
    return Math.sqrt(s / Math.max(1, e - a))
  })
  const max = Math.max(...out, 1e-9)
  return out.map((v) => Math.round((v / max) * 100) / 100)
}

function onsetEnvelope(x: Float32Array): Float32Array {
  const nFrames = Math.max(0, Math.floor((x.length - FRAME) / HOP) + 1)
  const re = new Float64Array(FRAME), im = new Float64Array(FRAME)
  const win = new Float64Array(FRAME)
  for (let i = 0; i < FRAME; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FRAME - 1))
  const bins = FRAME / 2
  let prev = new Float64Array(bins)
  let cur = new Float64Array(bins)
  const env = new Float32Array(nFrames)
  for (let f = 0; f < nFrames; f++) {
    const o = f * HOP
    for (let i = 0; i < FRAME; i++) { re[i] = x[o + i]! * win[i]!; im[i] = 0 }
    fft(re, im)
    let flux = 0
    for (let b = 1; b < bins; b++) {
      const mag = Math.log1p(1000 * Math.hypot(re[b]!, im[b]!))
      cur[b] = mag
      const d = mag - prev[b]!
      if (d > 0 && f > 0) flux += d
    }
    env[f] = flux
    const t = prev; prev = cur; cur = t
  }
  // Remove slow trend, rectify, normalise.
  const w = 32
  const out = new Float32Array(nFrames)
  let sum = 0
  const pre = new Float64Array(nFrames + 1)
  for (let i = 0; i < nFrames; i++) pre[i + 1] = pre[i]! + env[i]!
  for (let i = 0; i < nFrames; i++) {
    const a = Math.max(0, i - w), b = Math.min(nFrames, i + w + 1)
    const mean = (pre[b]! - pre[a]!) / (b - a)
    out[i] = Math.max(0, env[i]! - mean)
    sum += out[i]! * out[i]!
  }
  const sd = Math.sqrt(sum / Math.max(1, nFrames)) || 1
  for (let i = 0; i < nFrames; i++) out[i]! /= sd
  return out
}

function estimatePeriod(env: Float32Array, hopTime: number): number {
  const minLag = Math.floor(60 / 190 / hopTime)
  const maxLag = Math.ceil(60 / 55 / hopTime)
  const center = 0.5 / hopTime // 120 BPM
  const ac = new Float64Array(maxLag + 2)
  for (let lag = minLag - 1; lag <= maxLag + 1; lag++) {
    let s = 0
    for (let i = lag; i < env.length; i++) s += env[i]! * env[i - lag]!
    ac[lag] = s / (env.length - lag)
  }
  let best = minLag, bestScore = -Infinity
  for (let lag = minLag; lag <= maxLag; lag++) {
    const wgt = Math.exp(-0.5 * (Math.log2(lag / center) / 0.9) ** 2)
    const score = ac[lag]! * wgt
    if (score > bestScore) { bestScore = score; best = lag }
  }
  // Parabolic refinement.
  const a = ac[best - 1]!, b = ac[best]!, c = ac[best + 1]!
  const denom = a - 2 * b + c
  const shift = denom !== 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / denom)) : 0
  return best + shift
}

function trackBeats(env: Float32Array, period: number): number[] {
  const n = env.length
  const score = new Float64Array(n)
  const back = new Int32Array(n).fill(-1)
  const tight = 100
  const lo = Math.max(1, Math.round(period / 2)), hi = Math.round(period * 2)
  for (let t = 0; t < n; t++) {
    let best = 0, bi = -1
    for (let d = lo; d <= hi; d++) {
      const p = t - d
      if (p < 0) break
      const pen = Math.log(d / period)
      const v = score[p]! - tight * pen * pen
      if (bi < 0 || v > best) { best = v; bi = p }
    }
    score[t] = env[t]! + (bi >= 0 ? Math.max(0, best) : 0)
    back[t] = bi >= 0 && best > 0 ? bi : -1
  }
  // Best end point within the last period.
  let end = n - 1, bestEnd = -Infinity
  for (let t = Math.max(0, n - Math.round(period)); t < n; t++) if (score[t]! > bestEnd) { bestEnd = score[t]!; end = t }
  const frames: number[] = []
  for (let t = end; t >= 0; t = back[t]!) {
    frames.push(t)
    if (back[t]! < 0) break
  }
  frames.reverse()
  // Extend the grid backwards to the start of the music if the tracker began late.
  while (frames.length && frames[0]! - period > period / 2) frames.unshift(Math.round(frames[0]! - period))
  return frames
}

/** In-place radix-2 complex FFT. */
function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      let t = re[i]!; re[i] = re[j]!; re[j] = t
      t = im[i]!; im[i] = im[j]!; im[j] = t
    }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const ang = (-2 * Math.PI) / size
    const wr = Math.cos(ang), wi = Math.sin(ang)
    for (let start = 0; start < n; start += size) {
      let cr = 1, ci = 0
      for (let k = 0; k < size / 2; k++) {
        const a = start + k, b = a + size / 2
        const tr = re[b]! * cr - im[b]! * ci
        const ti = re[b]! * ci + im[b]! * cr
        re[b] = re[a]! - tr; im[b] = im[a]! - ti
        re[a]! += tr; im[a]! += ti
        const ncr = cr * wr - ci * wi
        ci = cr * wi + ci * wr
        cr = ncr
      }
    }
  }
}

/** Downsampled peak envelope for drawing a waveform. */
export function waveformPeaks(samples: Float32Array, buckets: number): Float32Array {
  const out = new Float32Array(buckets)
  const per = samples.length / buckets
  for (let b = 0; b < buckets; b++) {
    let m = 0
    const a = Math.floor(b * per), e = Math.min(samples.length, Math.floor((b + 1) * per))
    for (let i = a; i < e; i++) {
      const v = Math.abs(samples[i]!)
      if (v > m) m = v
    }
    out[b] = m
  }
  return out
}
