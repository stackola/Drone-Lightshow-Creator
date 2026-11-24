// Music-aware timing: land formations on downbeats and summarise a song's
// structure for people and for AI features.

import type { ShowDoc } from './types'
import { autoFlightDuration, compile, showBeats } from './compile'

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
      // Re-derive from the automatic (safe, comfortable) duration so re-aligning tightens timing again.
      const safe = autoFlightDuration(st.minFlight)
      const arrival = nextBarAtOrAfter(bars, t + safe)
      if (arrival === null) {
        t += safe + scene.hold
        return scene
      }
      aligned++
      let hold = scene.hold
      if (opts.holdBars !== false) {
        const n = Math.max(1, Math.round(hold / barLen))
        // End the hold on a bar line too (if the music is still going).
        const end = bars[bars.indexOf(arrival) + n]
        hold = end !== undefined ? end - arrival : n * barLen
      }
      const flight = Math.round((arrival - t) * 1000) / 1000
      t = arrival + hold
      return { ...scene, hold: Math.round(hold * 1000) / 1000, flight: { ...scene.flight, duration: flight } }
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
  /** Contiguous stretches of similar loudness. */
  sections: { start: number; end: number; level: 'quiet' | 'medium' | 'loud' }[]
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
  // Smooth over 2 bars either side, then split into quiet/medium/loud runs.
  const smooth = perBar.map((_, i) => {
    const w = perBar.slice(Math.max(0, i - 2), i + 3)
    return w.reduce((x, y) => x + y.energy, 0) / w.length
  })
  const level = (v: number): 'quiet' | 'medium' | 'loud' => (v < 3.5 ? 'quiet' : v < 6.5 ? 'medium' : 'loud')
  const sections: MusicSummary['sections'] = []
  perBar.forEach((b, i) => {
    const l = level(smooth[i]!)
    const last = sections[sections.length - 1]
    const end = perBar[i + 1]?.t ?? a.offset + a.duration
    if (last && last.level === l) last.end = end
    else sections.push({ start: b.t, end, level: l })
  })
  // Fold runs of two bars or less into a neighbour (the 5-bar smoothing creates short ramps).
  const barLength = bars.length > 1 ? (bars[bars.length - 1]! - bars[0]!) / (bars.length - 1) : 240 / Math.max(1, a.bpm)
  for (let i = 0; i < sections.length; i++) {
    const sec = sections[i]!
    if (sections.length > 1 && sec.end - sec.start < barLength * 3 - 1e-6) {
      const prev = sections[i - 1], next = sections[i + 1]
      if (prev) prev.end = sec.end
      else if (next) next.start = sec.start
      sections.splice(i--, 1)
      // Re-join neighbours that now share a level.
      const a2 = sections[i], b2 = sections[i + 1]
      if (a2 && b2 && a2.level === b2.level) { a2.end = b2.end; sections.splice(i + 1, 1) }
    }
  }
  return {
    bpm: a.bpm,
    duration: a.duration,
    offset: a.offset,
    barLength,
    bars: perBar,
    sections,
  }
}
