// A generated soundtrack: a section plan (intro, verse, build, drop, break,
// outro on a bar grid) rendered by a small deterministic synthesiser — pads,
// arpeggio, bass, kick, clap, hats, crashes, risers and a lead. Composed *to*
// a show (like a film score), so drops start exactly where formations arrive.
// Pure JS (no Web Audio), so it renders in a worker and its metadata is exact.

import type { AudioMeta } from './types'
import type { Section, SectionLabel } from './sections'

export interface SoundtrackPlan {
  bpm: number
  /** Seconds. */
  duration: number
  /** Sections in seconds, on bar lines, covering [0, duration]. */
  sections: Section[]
  seed: number
}

export const SOUNDTRACK_TAG = 'soundtrack-v1'

const ENERGY: Record<SectionLabel, number> = { intro: 0.28, verse: 0.55, build: 0.7, drop: 0.95, break: 0.3, outro: 0.3 }

const RANK: Record<SectionLabel, number> = { intro: 0, verse: 1, outro: 2, break: 3, build: 4, drop: 5 }

/**
 * A plan from timed marks ("a drop starts here"): marks snap to bar lines,
 * sections shorter than 4 bars give way to the more important neighbour
 * (drop > build > break > outro > verse > intro), repeats merge, and the
 * first section starts at 0.
 */
export function scorePlan(marks: [SectionLabel, number][], bpm: number, end: number, seed = 7): SoundtrackPlan {
  const bar = 240 / bpm
  const snapped = marks
    .map(([label, t]) => [label, Math.min(end - bar, Math.max(0, Math.round(t / bar) * bar))] as [SectionLabel, number])
    .sort((a, b) => a[1] - b[1] || RANK[a[0]] - RANK[b[0]])
  const kept: [SectionLabel, number][] = []
  for (const m of snapped) {
    let keep = true
    while (kept.length && m[1] - kept[kept.length - 1]![1] < 4 * bar - 1e-6) {
      if (RANK[kept[kept.length - 1]![0]] > RANK[m[0]]) { keep = false; break }
      kept.pop()
    }
    if (keep && kept[kept.length - 1]?.[0] !== m[0]) kept.push(m)
  }
  if (!kept.length) kept.push(['verse', 0])
  kept[0]![1] = 0
  const r3 = (x: number) => Math.round(x * 1000) / 1000
  const sections: Section[] = kept.map(([label, start], i) => ({ label, start: r3(start), end: r3(kept[i + 1]?.[1] ?? end), energy: 0 }))
  return { bpm, duration: r3(end), sections, seed }
}

/** Loudness at time t from the plan (builds ramp up, intros swell, outros fade). */
export function planEnergy(plan: SoundtrackPlan, t: number): number {
  const s = plan.sections.find((x) => t >= x.start && t < x.end) ?? plan.sections[plan.sections.length - 1]
  if (!s) return 0
  const f = Math.max(0, Math.min(1, (t - s.start) / Math.max(1e-6, s.end - s.start)))
  switch (s.label) {
    case 'intro': return 0.12 + 0.2 * f
    case 'build': return 0.55 + 0.35 * f
    case 'outro': return 0.35 * (1 - f) + 0.05
    default: return ENERGY[s.label]
  }
}

/** Exact metadata for the generated music: beats, loudness, sections and accents (crashes). */
export function soundtrackMeta(plan: SoundtrackPlan, name = 'Generated soundtrack'): AudioMeta {
  const beat = 60 / plan.bpm
  const beats: number[] = []
  for (let t = 0; t < plan.duration - 1e-6; t += beat) beats.push(Math.round(t * 1000) / 1000)
  const energy = beats.map((t) => Math.round(planEnergy(plan, t + beat / 2) * 100) / 100)
  const bass = beats.map((t) => { const s = sectionAt(plan, t); return s === 'drop' ? 1 : s === 'verse' || s === 'build' ? 0.6 : 0.15 })
  const bright = beats.map((t) => { const s = sectionAt(plan, t); return s === 'drop' || s === 'build' ? 0.9 : s === 'verse' ? 0.6 : 0.3 })
  return {
    name, duration: plan.duration, offset: 0, beats, downbeat: 0, bpm: plan.bpm, energy, bass, bright,
    accents: crashTimes(plan),
    sections: plan.sections.map((s) => ({ ...s, energy: Math.round(planEnergy(plan, (s.start + s.end) / 2) * 100) / 100 })),
    generated: `${SOUNDTRACK_TAG}#${plan.seed}`,
  }
}

function sectionAt(plan: SoundtrackPlan, t: number): SectionLabel {
  return (plan.sections.find((x) => t >= x.start && t < x.end) ?? plan.sections[plan.sections.length - 1])?.label ?? 'verse'
}

/** Crashes: the start of every drop, and every 8 bars inside drops. */
export function crashTimes(plan: SoundtrackPlan): number[] {
  const bar = (60 / plan.bpm) * 4
  const out: number[] = []
  for (const s of plan.sections) {
    if (s.label !== 'drop') continue
    for (let t = s.start; t < s.end - bar * 2; t += bar * 8) out.push(Math.round(t * 1000) / 1000)
  }
  return out
}

/** Rebuild the plan from stored metadata (to re-render a saved project's music). */
export function planFromMeta(meta: AudioMeta): SoundtrackPlan | null {
  const [tag, seed] = (meta.generated ?? '').split('#')
  if (tag !== SOUNDTRACK_TAG || !meta.sections?.length) return null
  return { bpm: meta.bpm, duration: meta.duration, sections: meta.sections, seed: Number(seed) || 7 }
}

// --- Synthesis -------------------------------------------------------------------------

const midi = (n: number) => 440 * Math.pow(2, (n - 69) / 12)

// A minor: Am – F – C – G, one chord per bar.
const CHORDS = [
  { root: 45, tones: [57, 60, 64] }, // Am
  { root: 41, tones: [57, 60, 65] }, // F
  { root: 48, tones: [55, 60, 64] }, // C
  { root: 43, tones: [55, 59, 62] }, // G
]
const LEAD = [[76, 72, 69, 72], [72, 69, 65, 69], [67, 72, 76, 79], [74, 71, 67, 71]]

function rng(seed: number) {
  let a = seed >>> 0 || 1
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Render the plan to mono PCM. Event-based: every note adds its own samples,
 * so silence costs nothing. ~1–3 s for 15 minutes at 22 kHz.
 */
export function renderSoundtrack(plan: SoundtrackPlan, sr = 22050, onProgress?: (f: number) => void): Float32Array {
  const n = Math.ceil(plan.duration * sr)
  const out = new Float32Array(n)
  const duck = new Float32Array(n).fill(1) // sidechain from the kick
  const rand = rng(plan.seed)
  const beat = 60 / plan.bpm, bar = beat * 4
  const S = (t: number) => Math.max(0, Math.min(n, Math.floor(t * sr)))

  // Noise table (reused for drums and risers).
  const NOISE = new Float32Array(1 << 16)
  for (let i = 0; i < NOISE.length; i++) NOISE[i] = rand() * 2 - 1

  const add = (start: number, dur: number, f: (i: number, x: number) => number) => {
    const a = S(start), b = S(start + dur)
    for (let i = a; i < b; i++) out[i]! += f(i - a, (i - a) / sr)
  }
  const kick = (t: number, v: number) => {
    let ph = 0
    add(t, 0.35, (_i, x) => {
      ph += (2 * Math.PI * (48 + 110 * Math.exp(-x / 0.035))) / sr
      return v * Math.sin(ph) * Math.exp(-x / 0.16)
    })
    const a = S(t), b = S(t + 0.25)
    for (let i = a; i < b; i++) duck[i] = Math.min(duck[i]!, 0.35 + 0.65 * ((i - a) / Math.max(1, b - a)))
  }
  const noiseHit = (t: number, dur: number, decay: number, v: number, bright: number) => {
    let lp = 0
    const k = Math.floor(rand() * NOISE.length)
    add(t, dur, (i, x) => {
      const w = NOISE[(k + i) & (NOISE.length - 1)]!
      lp += (w - lp) * (1 - bright)
      return v * (w - lp) * Math.exp(-x / decay)
    })
  }
  const pluck = (t: number, freq: number, dur: number, v: number) => {
    let ph = 0
    add(t, dur, (_i, x) => {
      ph += freq / sr
      const tri = 4 * Math.abs((ph % 1) - 0.5) - 1
      return v * tri * Math.exp(-x / 0.18) * Math.min(1, x / 0.004)
    })
  }
  const saw = (ph: number) => 2 * (ph % 1) - 1

  const sections = plan.sections
  const total = sections.length
  sections.forEach((sec, si) => {
    onProgress?.(si / total)
    const L = sec.label
    const bars = Math.max(1, Math.round((sec.end - sec.start) / bar))
    for (let k = 0; k < bars; k++) {
      const t0 = sec.start + k * bar
      if (t0 >= plan.duration) break
      const globalBar = Math.round(t0 / bar)
      const chord = CHORDS[globalBar % 4]!
      const f = bars > 1 ? k / (bars - 1) : 1
      const e = planEnergy(plan, t0)

      // Pad: two detuned saws per chord tone, low-passed; brighter when louder.
      {
        const cut = 0.04 + 0.12 * e
        const vol = 0.045 * (L === 'drop' ? 0.8 : 1) * (L === 'intro' ? 0.4 + 0.6 * f : L === 'outro' ? 1 - 0.85 * f : 1)
        const freqs = chord.tones.flatMap((m) => [midi(m) * 0.998, midi(m) * 1.003])
        const ph = freqs.map(() => rand())
        let lp = 0
        add(t0, bar + 0.05, (_i, x) => {
          let s = 0
          for (let j = 0; j < freqs.length; j++) { ph[j]! += freqs[j]! / sr; s += saw(ph[j]!) }
          lp += (s - lp) * cut
          const env = Math.min(1, x / 0.08) * Math.min(1, (bar + 0.05 - x) / 0.08)
          return vol * lp * env
        })
      }
      // Arpeggio: 8ths (verse/break), 16ths (build/drop).
      if (L !== 'intro' && !(L === 'outro' && f > 0.6)) {
        const step = L === 'build' || L === 'drop' ? beat / 4 : beat / 2
        const tones = [...chord.tones, chord.tones[0]! + 12]
        for (let q = 0, t = t0; t < t0 + bar - 1e-6; t += step, q++) pluck(t, midi(tones[q % tones.length]!), step * 1.6, (L === 'drop' ? 0.05 : 0.07) * (0.6 + 0.4 * e))
      }
      // Bass: root on every beat (8ths in drops), ducked by the kick.
      if (L === 'verse' || L === 'build' || L === 'drop') {
        const step = L === 'drop' ? beat / 2 : beat
        const fr = midi(chord.root)
        for (let t = t0; t < t0 + bar - 1e-6; t += step) {
          let ph = rand(), lp = 0
          add(t, step * 0.95, (_i, x) => {
            ph += fr / sr
            const s = Math.sin(2 * Math.PI * ph) * 0.7 + saw(ph) * 0.3
            lp += (s - lp) * 0.2
            return 0.16 * lp * Math.min(1, x / 0.005) * Math.exp(-x / (step * 1.2))
          })
        }
      }
      // Drums.
      for (let b = 0; b < 4; b++) {
        const t = t0 + b * beat
        if (L === 'drop' || (L === 'build' && f > 0.5)) kick(t, 0.9)
        else if (L === 'verse' && (b === 0 || b === 2)) kick(t, 0.6)
        if ((L === 'drop' || L === 'verse') && (b === 1 || b === 3)) noiseHit(t, 0.25, 0.08, L === 'drop' ? 0.35 : 0.2, 0.7)
        if (L === 'drop' || L === 'verse' || L === 'build') noiseHit(t + beat / 2, 0.06, 0.02, L === 'drop' ? 0.16 : 0.09, 0.15)
      }
      // Build: snare roll accelerating into the drop, and a rising noise sweep.
      if (L === 'build') {
        const div = f < 0.5 ? 2 : f < 0.85 ? 4 : 8
        for (let q = 0; q < 4 * div; q++) noiseHit(t0 + (q * beat) / div, 0.08, 0.04, 0.08 + 0.18 * f, 0.6)
        let lp = 0
        const kk = Math.floor(rand() * NOISE.length)
        add(t0, bar, (i, x) => {
          const g = (k + x / bar) / bars
          const w = NOISE[(kk + i) & (NOISE.length - 1)]!
          lp += (w - lp) * (0.02 + 0.5 * g * g)
          return 0.12 * g * g * lp
        })
      }
      // Lead melody over drops: one motif per chord, an octave above the pad.
      if (L === 'drop') {
        const notes = LEAD[globalBar % 4]!
        notes.forEach((m, q) => {
          const t = t0 + q * beat, fr = midi(m)
          let ph = rand(), ph2 = rand(), lp = 0
          add(t, beat * 0.95, (_i, x) => {
            const vib = 1 + 0.004 * Math.sin(2 * Math.PI * 5.5 * x)
            ph += (fr * vib) / sr; ph2 += (fr * 1.006 * vib) / sr
            lp += (saw(ph) + saw(ph2) - lp) * 0.15
            return 0.05 * lp * Math.min(1, x / 0.01) * Math.exp(-x / 0.6)
          })
        })
      }
    }
  })
  // Crashes on every drop start and every 8 bars inside drops.
  for (const t of crashTimes(plan)) noiseHit(t, 2.2, 0.7, 0.45, 0.05)
  // Final chord rings out at the very end of the outro.
  // Mix: sidechain the musical layers lightly with the kick, soft-clip, normalise.
  let peak = 1e-9
  for (let i = 0; i < n; i++) {
    const v = Math.tanh(out[i]! * (0.75 + 0.25 * duck[i]!) * 1.3)
    out[i] = v
    peak = Math.max(peak, Math.abs(v))
  }
  const g = 0.89 / peak
  for (let i = 0; i < n; i++) out[i]! *= g
  onProgress?.(1)
  return out
}
