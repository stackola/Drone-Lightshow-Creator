// Music-aware timing: land formations on downbeats and summarise a song's
// structure for people and for AI features.

import type { ShowDoc } from './types'
import { autoFlightDuration, compile, showBeats } from './compile'
import { findSections, type Section } from './sections'

/**
 * The song's sections in show time: from the analysis, or (for music added
 * before sections were detected) derived from the per-beat loudness.
 */
export function songSections(doc: ShowDoc): Section[] {
  const a = doc.audio
  if (!a || a.beats.length < 8) return []
  const secs = a.sections?.length ? a.sections : findSections({ beats: a.beats, downbeat: a.downbeat, energy: a.energy ?? a.beats.map(() => 0.5), duration: a.duration })
  return secs.map((x) => ({ ...x, start: x.start + a.offset, end: x.end + a.offset }))
}

/** Accents (stand-out hits) in show time. */
export function songAccents(doc: ShowDoc): number[] {
  const a = doc.audio
  return a?.accents ? a.accents.map((t) => t + a.offset) : []
}

/** Music loudness at show time t, 0..1 (interpolated between beats), or null outside the music. */
export function energyAt(doc: ShowDoc, t: number): number | null {
  const a = doc.audio
  if (!a?.energy?.length) return null
  const beats = showBeats(doc)
  if (t < beats[0]! || t > beats[beats.length - 1]!) return null
  let lo = 0, hi = beats.length - 1
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (beats[mid]! <= t) lo = mid; else hi = mid - 1 }
  const e0 = a.energy[lo] ?? 0, e1 = a.energy[lo + 1] ?? e0
  const span = (beats[lo + 1] ?? beats[lo]! + 0.5) - beats[lo]!
  return e0 + (e1 - e0) * Math.max(0, Math.min(1, (t - beats[lo]!) / span))
}

/** Bar start times in show time (every 4th beat from the downbeat). */
export function barTimes(doc: ShowDoc): number[] {
  if (!doc.audio || doc.audio.beats.length < 8) return []
  const beats = showBeats(doc)
  const out: number[] = []
  for (let i = doc.audio.downbeat; i < beats.length; i += 4) out.push(beats[i]!)
  return out
}

function nextBarAtOrAfter(bars: number[], t: number): number | null {
  for (const b of bars) if (b >= t - 1e-6) return b
  return null
}

/**
 * Retime the show so every formation arrives exactly on a bar line and holds
 * for whole bars, while the music plays. Flights only ever get longer than
 * their automatic (safe) duration, never shorter. Scenes after the music ends
 * keep their timing. Two passes, because a hold's length changes where a
 * spinning formation ends, which can change the next flight's minimum.
 */
export function alignScenesToBars(doc: ShowDoc, opts: { holdBars?: boolean } = {}): { doc: ShowDoc; aligned: number } {
  const bars = barTimes(doc)
  if (bars.length < 2 || !doc.scenes.length) return { doc, aligned: 0 }
  const barLen = (bars[bars.length - 1]! - bars[0]!) / (bars.length - 1)
  let aligned = 0
  for (let pass = 0; pass < 2; pass++) {
    const c = compile(doc)
    let t = c.takeoff.t1
    aligned = 0
    const scenes = doc.scenes.map((scene, i) => {
      const st = c.sceneTimes[i]!
      // Groups flying their own sequences after the hold keep their own timing.
      const split = st.splitEnd - st.holdEnd
      // Re-derive from the automatic (safe, comfortable) duration so re-aligning tightens timing again.
      const safe = autoFlightDuration(st.minFlight)
      const arrival = nextBarAtOrAfter(bars, t + safe)
      if (arrival === null) {
        t += safe + scene.hold + split
        return scene
      }
      aligned++
      // Times are stored to the millisecond; carry the rounded values forward so the error never builds up.
      const flight = Math.round((arrival - t) * 1000) / 1000
      const at = t + flight
      let hold = scene.hold
      if (opts.holdBars !== false) {
        const n = Math.max(1, Math.round(hold / barLen))
        // End the hold on a bar line too (if the music is still going).
        const end = bars[bars.indexOf(arrival) + n]
        hold = end !== undefined ? end - at : n * barLen
      }
      hold = Math.round(hold * 1000) / 1000
      t = at + hold + split
      return { ...scene, hold, flight: { ...scene.flight, duration: flight } }
    })
    doc = { ...doc, scenes }
  }
  return { doc, aligned }
}

export interface MusicSummary {
  bpm: number
  duration: number
  offset: number
  barLength: number
  /** Per bar: start time (show time) and loudness 0..9. */
  bars: { t: number; energy: number }[]
  /** Song structure (show time), with a loudness level for each part. */
  sections: { start: number; end: number; level: 'quiet' | 'medium' | 'loud'; label: Section['label']; energy: number; bars: number }[]
  /** Accents in show time. */
  accents: number[]
}

export function summarizeMusic(doc: ShowDoc): MusicSummary | null {
  const a = doc.audio
  if (!a || a.beats.length < 8) return null
  const bars = barTimes(doc)
  const energy = a.energy ?? []
  const perBar = bars.map((t, k) => {
    const i0 = a.downbeat + k * 4
    const slice = energy.slice(i0, i0 + 4)
    const e = slice.length ? slice.reduce((x, y) => x + y, 0) / slice.length : 0.5
    return { t: Math.round(t * 100) / 100, energy: Math.min(9, Math.round(e * 9)) }
  })
  const barLength = bars.length > 1 ? (bars[bars.length - 1]! - bars[0]!) / (bars.length - 1) : 240 / Math.max(1, a.bpm)
  const level = (v: number): 'quiet' | 'medium' | 'loud' => (v < 0.38 ? 'quiet' : v < 0.7 ? 'medium' : 'loud')
  const sections = songSections(doc).map((x) => ({
    start: Math.round(x.start * 100) / 100, end: Math.round(x.end * 100) / 100, label: x.label, energy: x.energy,
    level: level(x.energy), bars: Math.max(1, Math.round((x.end - x.start) / barLength)),
  }))
  return {
    bpm: a.bpm,
    duration: a.duration,
    offset: a.offset,
    barLength,
    bars: perBar,
    sections,
    accents: songAccents(doc).map((t) => Math.round(t * 100) / 100),
  }
}
