// Music-driven editing: light a show from the song's structure, fit the show
// to the song, and land a formation exactly on a moment in the music. Pure
// document transforms, used by the editor and by the AI features alike.

import type { Effect, LightCue, ShowDoc } from './types'
import { compile } from './compile'
import { alignScenesToBars, barTimes, songAccents, songSections } from './music'
import { newId } from './defaults'
import type { Section } from './sections'

export const MUSIC_TAG = 'music'

export type LightingStyle = 'subtle' | 'bold'

const white = '#ffffff'

function cue(start: number, duration: number, blend: LightCue['blend'], effect: Effect, fadeIn = 0, fadeOut = 0): LightCue {
  return { id: newId('cue'), start: Math.round(start * 100) / 100, duration: Math.max(0.1, Math.round(duration * 100) / 100), fadeIn, fadeOut, blend, effect, tag: MUSIC_TAG }
}

/**
 * Light the music: cues that follow the song's structure, on top of each
 * formation's own look. Quiet parts breathe with the loudness, builds ramp up
 * with a sweep and flashes on the last bar's beats, drops flash on every
 * accent (and, bold, pulse on every beat), breaks dim down and sparkle, the
 * outro fades. Re-running replaces the previous music cues; hand-made cues stay.
 */
export function lightTheMusic(doc: ShowDoc, style: LightingStyle = 'bold'): { doc: ShowDoc; added: number } {
  const sections = songSections(doc)
  const kept = doc.cues.filter((q) => q.tag !== MUSIC_TAG)
  if (!sections.length) return { doc: { ...doc, cues: kept }, added: 0 }
  const bars = barTimes(doc)
  const barLen = bars.length > 1 ? (bars[bars.length - 1]! - bars[0]!) / (bars.length - 1) : 2
  const accents = songAccents(doc)
  const bold = style === 'bold'
  const out: LightCue[] = []
  const breathe = (s: Section, floor: number) => out.push(cue(s.start, s.end - s.start, 'multiply', { kind: 'react', color: white, floor, brightness: 1 }, Math.min(2, barLen), Math.min(2, barLen)))
  for (const s of sections) {
    const len = s.end - s.start
    switch (s.label) {
      case 'intro':
        breathe(s, 0.3)
        break
      case 'verse':
        breathe(s, bold ? 0.45 : 0.6)
        break
      case 'build': {
        // A sweep that brightens toward the drop, then flashes on every beat of the last bar.
        out.push(cue(s.start, len, 'add', { kind: 'wave', a: '#000000', b: white, angle: 90, speed: 0.5, width: 0.25, brightness: bold ? 0.6 : 0.35 }, len * 0.8, 0))
        if (len > barLen * 1.5) out.push(cue(s.end - barLen, barLen, 'add', { kind: 'flash', color: white, decay: 0.2, beatSync: true, every: 1, onAccents: false, brightness: bold ? 0.9 : 0.5 }))
        break
      }
      case 'drop':
        out.push(cue(s.start, len, 'add', { kind: 'flash', color: white, decay: 0.45, beatSync: true, every: 1, onAccents: true, brightness: 1 }))
        if (bold) {
          out.push(cue(s.start, len, 'multiply', { kind: 'react', color: white, floor: 0.6, brightness: 1 }, 0, Math.min(2, barLen)))
          out.push(cue(s.start, len, 'add', { kind: 'flash', color: white, decay: 0.22, beatSync: true, every: 2, onAccents: false, brightness: 0.3 }))
        }
        break
      case 'break':
        breathe(s, 0.2)
        out.push(cue(s.start, len, 'add', { kind: 'twinkle', a: '#000000', b: '#dfe8ff', rate: 0.8, brightness: 0.6 }, Math.min(2, barLen), Math.min(2, barLen)))
        break
      case 'outro':
        out.push(cue(s.start, len, 'multiply', { kind: 'react', color: white, floor: 0.25, brightness: 1 }, Math.min(2, barLen), Math.min(len * 0.6, barLen * 4)))
        break
    }
  }
  // Accents outside drops still get a flash of their own.
  const inDrop = (t: number) => sections.some((s) => s.label === 'drop' && t >= s.start - 0.05 && t < s.end)
  for (const a of accents) if (!inDrop(a) && (bold || sections.find((s) => a >= s.start && a < s.end)?.label === 'build')) out.push(cue(a, 1.2, 'add', { kind: 'flash', color: white, decay: 0.4, beatSync: false, every: 1, onAccents: false, brightness: bold ? 1 : 0.6 }))
  const cues = [...kept, ...out].sort((a, b) => a.start - b.start)
  return { doc: { ...doc, cues }, added: out.length }
}

/**
 * Retime so formation `index` arrives at show time `target`: by changing the
 * previous formation's hold (or the first flight), and if that's not enough,
 * this flight's own duration — never shorter than its safe minimum. Later
 * formations shift with it. Returns the arrival time actually achieved.
 */
export function arriveAt(doc: ShowDoc, index: number, target: number): { doc: ShowDoc; arrival: number } {
  const c = compile(doc)
  const st = c.sceneTimes[index]
  if (!st) return { doc, arrival: NaN }
  let delta = target - st.holdStart
  const scenes = doc.scenes.map((s) => ({ ...s, flight: { ...s.flight } }))
  const flight = st.holdStart - st.flightStart
  const minFlight = Math.ceil(st.minFlight * 10) / 10
  if (index > 0) {
    const prev = scenes[index - 1]!
    const hold = Math.max(0.5, prev.hold + delta)
    delta -= hold - prev.hold
    prev.hold = Math.round(hold * 1000) / 1000
  }
  if (Math.abs(delta) > 1e-6 || index === 0) {
    const want = Math.max(minFlight, flight + delta)
    scenes[index]!.flight.duration = Math.round(want * 1000) / 1000
  }
  const next = { ...doc, scenes }
  return { doc: next, arrival: compile(next).sceneTimes[index]!.holdStart }
}

/** The start of a section (by index into songSections) or a bar (1-based), in show time. */
export function musicMoment(doc: ShowDoc, at: { section?: number; bar?: number; time?: number }): number | null {
  if (at.time !== undefined) return at.time
  if (at.section !== undefined) return songSections(doc)[at.section]?.start ?? null
  if (at.bar !== undefined) return barTimes(doc)[Math.round(at.bar) - 1] ?? null
  return null
}

/**
 * Fit the show to the song: every arrival on a bar line, holds in whole bars,
 * and the whole show stretched or tightened (bar by bar, across the holds) so
 * the final formation ends with the music.
 */
export function fitToSong(doc: ShowDoc, opts: { from?: number } = {}): { doc: ShowDoc; endGap: number } {
  const a = doc.audio
  if (!a || !doc.scenes.length) return { doc, endGap: 0 }
  const bars = barTimes(doc)
  if (bars.length < 2) return { doc, endGap: 0 }
  const barLen = (bars[bars.length - 1]! - bars[0]!) / (bars.length - 1)
  const songEnd = a.offset + a.duration
  if (opts.from !== undefined) return fitTail(doc, opts.from, barLen, songEnd)
  let d = alignScenesToBars(doc).doc
  for (let pass = 0; pass < 6; pass++) {
    const c = compile(d)
    const last = c.sceneTimes[c.sceneTimes.length - 1]!
    const gapBars = Math.round((songEnd - last.holdEnd) / barLen)
    if (gapBars === 0) break
    // Spread whole bars over the holds: add to the longest holds first; remove from the longest too (keeping ≥ 1 bar).
    const order = d.scenes.map((s, i) => ({ i, hold: s.hold })).sort((p, q) => q.hold - p.hold)
    const scenes = d.scenes.map((s) => ({ ...s }))
    let left = Math.abs(gapBars), k = 0, guard = 0
    while (left > 0 && guard++ < 10000) {
      const sc = scenes[order[k % order.length]!.i]!
      if (gapBars > 0) { sc.hold += barLen; left-- }
      else if (sc.hold >= barLen * 2 - 1e-6) { sc.hold -= barLen; left-- }
      k++
      if (gapBars < 0 && k > order.length * 64) break
    }
    d = alignScenesToBars({ ...d, scenes }).doc
  }
  const c = compile(d)
  return { doc: d, endGap: songEnd - c.sceneTimes[c.sceneTimes.length - 1]!.holdEnd }
}

/**
 * Fit only the end of the show to the song: add or remove whole bars on the
 * holds of formations from `from` on, so everything before keeps its timing
 * (and anything on a bar line stays on one).
 */
function fitTail(doc: ShowDoc, from: number, barLen: number, songEnd: number): { doc: ShowDoc; endGap: number } {
  const c = compile(doc)
  const last = c.sceneTimes[c.sceneTimes.length - 1]!
  const gapBars = Math.round((songEnd - last.holdEnd) / barLen)
  const idx = doc.scenes.map((_, i) => i).filter((i) => i >= from)
  if (!gapBars || !idx.length) return { doc, endGap: songEnd - last.holdEnd }
  const scenes = doc.scenes.map((s) => ({ ...s }))
  let left = Math.abs(gapBars), k = 0, guard = 0
  while (left > 0 && guard++ < 10000) {
    const sc = scenes[idx[k % idx.length]!]!
    if (gapBars > 0) { sc.hold = Math.round((sc.hold + barLen) * 1000) / 1000; left-- }
    else if (sc.hold >= barLen * 2 - 1e-6) { sc.hold = Math.round((sc.hold - barLen) * 1000) / 1000; left-- }
    else if (k > idx.length * 64) break
    k++
  }
  const next = { ...doc, scenes }
  const c2 = compile(next)
  return { doc: next, endGap: songEnd - c2.sceneTimes[c2.sceneTimes.length - 1]!.holdEnd }
}
