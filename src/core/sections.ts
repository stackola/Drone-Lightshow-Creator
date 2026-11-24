// Song structure from beat-level features.
//
// Each bar (4 beats from the downbeat) gets a feature vector — loudness,
// bass, brightness. A boundary's novelty is how different the bars before it
// are from the bars after it (Foote-style, with a 4-bar window), plus a bonus
// when a strong accent lands on it (drops start with a hit). Boundaries are
// the novelty peaks, at least 4 bars apart and snapped to 4-bar phrases when
// close. Sections are then labelled from their loudness relative to the song
// and their neighbours: intro, verse, build, drop, break, outro.

export type SectionLabel = 'intro' | 'verse' | 'build' | 'drop' | 'break' | 'outro'

export interface Section {
  /** Seconds (audio time, or show time once offset). */
  start: number
  end: number
  label: SectionLabel
  /** Mean loudness 0..1. */
  energy: number
}

export interface SectionInput {
  beats: number[]
  downbeat: number
  energy: number[]
  bass?: number[]
  bright?: number[]
  accents?: number[]
  duration: number
}

export const SECTION_COLORS: Record<SectionLabel, string> = {
  intro: '#5b7cfa',
  verse: '#22b8cf',
  build: '#fab005',
  drop: '#ff4d6d',
  break: '#845ef7',
  outro: '#748ffc',
}

const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0)

export function findSections(inp: SectionInput): Section[] {
  const { beats, downbeat, energy, duration } = inp
  const bass = inp.bass ?? energy, bright = inp.bright ?? energy.map(() => 0.5)
  const bars: { t: number; e: number; b: number; h: number }[] = []
  for (let i = downbeat; i + 3 < beats.length; i += 4) {
    const sl = (a: number[]) => mean(a.slice(i, i + 4))
    bars.push({ t: beats[i]!, e: sl(energy), b: sl(bass), h: sl(bright) })
  }
  if (bars.length < 8) return duration > 0 ? [{ start: 0, end: duration, label: 'verse', energy: mean(energy) }] : []

  // Novelty at each bar line k (between bar k-1 and bar k).
  const W = 4
  const beatLen = beats.length > 1 ? (beats[beats.length - 1]! - beats[0]!) / (beats.length - 1) : 0.5
  const nov = bars.map((bar, k) => {
    if (k < 2 || k > bars.length - 2) return 0
    const before = bars.slice(Math.max(0, k - W), k), after = bars.slice(k, Math.min(bars.length, k + W))
    const d = (f: 'e' | 'b' | 'h', w: number) => w * Math.abs(mean(before.map((x) => x[f])) - mean(after.map((x) => x[f])))
    const hit = (inp.accents ?? []).some((a) => Math.abs(a - bar.t) < beatLen * 0.6) ? 0.12 : 0
    return d('e', 1) + d('b', 0.6) + d('h', 0.5) + hit
  })
  // A boundary must be a real change: at least 0.1, and at least 30% of the song's biggest change.
  const thr = Math.max(0.1, 0.3 * Math.max(...nov))
  const peaks = nov
    .map((v, k) => ({ k, v }))
    .filter(({ k, v }) => v >= thr && v >= (nov[k - 1] ?? 0) && v >= (nov[k + 1] ?? 0))
    .sort((p, q) => q.v - p.v)
  const chosen: number[] = []
  for (const p of peaks) {
    let k = p.k
    // Prefer the phrase line (every 4 bars) when the novelty there is nearly as strong.
    if (k % 4 !== 0) for (const c of [k - 1, k + 1, k - 2, k + 2]) if (c > 0 && c % 4 === 0 && (nov[c] ?? 0) >= 0.8 * p.v) { k = c; break }
    if (chosen.every((c) => Math.abs(c - k) >= 4)) chosen.push(k)
  }
  chosen.sort((a, b) => a - b)

  // Build sections: the first starts at 0 (pickup included), the last ends with the song.
  const edges = [0, ...chosen.map((k) => bars[k]!.t), duration]
  const secs = edges.slice(0, -1).map((start, i) => {
    const end = edges[i + 1]!
    const inside = bars.filter((b) => b.t >= start - 1e-6 && b.t < end - 1e-6)
    const half = Math.floor(inside.length / 2)
    return {
      start, end, label: 'verse' as SectionLabel,
      energy: Math.round(mean(inside.map((b) => b.e)) * 100) / 100,
      rising: mean(inside.slice(half).map((b) => b.e + b.h * 0.5)) > mean(inside.slice(0, half).map((b) => b.e + b.h * 0.5)) + 0.04,
    }
  }).filter((s) => s.end - s.start > 1e-6)

  const lo = Math.min(...secs.map((s) => s.energy)), hi = Math.max(...secs.map((s) => s.energy))
  const rel = (e: number) => (hi > lo + 1e-6 ? (e - lo) / (hi - lo) : 0.5)
  secs.forEach((s, i) => {
    const r = rel(s.energy)
    const next = secs[i + 1]
    if (i === 0 && r < 0.6 && secs.length > 1) s.label = 'intro'
    else if (i === secs.length - 1 && secs.length > 2 && r < 0.7 && s.end - s.start <= 0.3 * duration) s.label = 'outro'
    else if (r >= 0.72) s.label = 'drop'
    else if (next && rel(next.energy) >= 0.72 && (s.rising || r >= 0.35)) s.label = 'build'
    else if (r < 0.35) s.label = 'break'
    else s.label = 'verse'
  })
  return secs.map(({ start, end, label, energy }) => ({ start: Math.round(start * 1000) / 1000, end: Math.round(end * 1000) / 1000, label, energy }))
}
