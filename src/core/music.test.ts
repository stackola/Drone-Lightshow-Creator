import { describe, expect, it } from 'vitest'
import { detectBeats } from './beats'
import { findSections } from './sections'
import { newScene, newShow } from './defaults'
import { compile } from './compile'
import { evaluate } from './evaluate'
import { validate } from './validate'
import { barTimes } from './music'
import { MUSIC_TAG, arriveAt, fitToSong, lightTheMusic, musicMoment } from './musicTools'
import type { LightCue, ShowDoc } from './types'

/**
 * A synthetic 72 s song at 120 BPM: quiet intro (0–16 s), drop with kick,
 * bass and hats (16–40 s), break (40–48 s), second drop (48–72 s); a crash
 * opens each drop.
 */
export function synthSong(sr = 22050): Float32Array {
  const dur = 72, n = dur * sr
  const x = new Float32Array(n)
  let seed = 1
  const noise = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1
  const loud = (t: number) => (t >= 16 && t < 40) || t >= 48
  for (let i = 0; i < n; i++) {
    const t = i / sr
    const beatPos = t * 2 // beats
    const bt = (beatPos - Math.floor(beatPos)) / 2 // seconds since beat
    let v = 0.04 * Math.sin(2 * Math.PI * 220 * t) + 0.03 * Math.sin(2 * Math.PI * 277 * t) // pad
    if (!loud(t)) v += 0.18 * Math.exp(-bt / 0.01) * Math.sin(2 * Math.PI * 1500 * t) // soft click
    else {
      v += 0.9 * Math.exp(-bt / 0.12) * Math.sin(2 * Math.PI * (50 + 90 * Math.exp(-bt / 0.03)) * t) // kick
      v += 0.25 * Math.sin(2 * Math.PI * 55 * t) // bass
      const off = ((beatPos + 0.5) % 1) / 2
      v += 0.18 * Math.exp(-off / 0.02) * noise() // hats on the off-beat
    }
    for (const c of [16, 48]) if (t >= c && t < c + 1.5) v += 0.8 * Math.exp(-(t - c) / 0.35) * noise() // crash
    x[i] = Math.max(-1, Math.min(1, v))
  }
  return x
}

describe('song structure', () => {
  const r = detectBeats(synthSong(), 22050)

  it('tracks the tempo', () => {
    expect(r.bpm).toBeGreaterThan(115)
    expect(r.bpm).toBeLessThan(125)
  })

  it('finds the sections and labels the drops and the break', () => {
    const edges = r.sections.slice(1).map((s) => s.start)
    for (const want of [16, 40, 48]) expect(edges.some((e) => Math.abs(e - want) <= 2.1), `boundary near ${want}s in ${edges}`).toBe(true)
    const at = (t: number) => r.sections.find((s) => t >= s.start && t < s.end)!.label
    expect(at(8)).toBe('intro')
    expect(at(28)).toBe('drop')
    expect(at(44)).toBe('break')
    expect(at(60)).toBe('drop')
  })

  it('hears the crashes as accents and the drops as bass-heavy', () => {
    for (const c of [16, 48]) expect(r.accents.some((a) => Math.abs(a - c) < 0.3), `accent near ${c}s in ${r.accents}`).toBe(true)
    const beatAt = (t: number) => r.beats.findIndex((b) => b >= t)
    expect(r.bass[beatAt(28)]!).toBeGreaterThan(r.bass[beatAt(8)]! + 0.3)
  })

  it('degrades gracefully: loudness alone still gives sections', () => {
    const s = findSections({ beats: r.beats, downbeat: r.downbeat, energy: r.energy, duration: 72 })
    expect(s.length).toBeGreaterThanOrEqual(3)
    expect(s[0]!.start).toBe(0)
    expect(s[s.length - 1]!.end).toBe(72)
  })
})

describe('music tools', () => {
  const r = detectBeats(synthSong(), 22050)
  const withSong = () => {
    const doc = newShow(60)
    doc.audio = { name: 'synth', duration: 72, offset: 0, beats: r.beats, downbeat: r.downbeat, bpm: r.bpm, energy: r.energy, bass: r.bass, bright: r.bright, accents: r.accents, sections: r.sections }
    for (const k of ['circle', 'heart', 'star'] as const) doc.scenes.push({ ...newScene(doc, k), hold: 6 })
    return doc
  }
  const brightness = (doc: ShowDoc, t: number) => {
    const c = compile(doc)
    const p = new Float32Array(c.n * 3), col = new Float32Array(c.n * 3)
    evaluate(c, t, p, col)
    let s = 0
    for (let i = 0; i < col.length; i++) s += col[i]!
    return s / c.n
  }

  it('lights the music: section-by-section cues, replaced when run again, hand-made cues kept', () => {
    const doc = withSong()
    doc.cues.push({ id: 'mine', start: 1, duration: 1, fadeIn: 0, fadeOut: 0, blend: 'add', effect: { kind: 'solid', color: '#ff0000', brightness: 1 } })
    const lit = lightTheMusic(doc, 'bold')
    expect(lit.added).toBeGreaterThan(3)
    expect(lit.doc.cues.some((q) => q.id === 'mine')).toBe(true)
    expect(lit.doc.cues.some((q) => q.effect.kind === 'flash' && q.effect.onAccents)).toBe(true)
    const again = lightTheMusic(lit.doc, 'subtle')
    expect(again.doc.cues.filter((q) => q.tag === MUSIC_TAG).length).toBe(again.added)
    expect(again.doc.cues.length).toBe(again.added + 1)
  })

  it('flashes on accents and breathes with the loudness', () => {
    const doc = withSong()
    const flash: LightCue = { id: 'f', start: 0, duration: 72, fadeIn: 0, fadeOut: 0, blend: 'add', effect: { kind: 'flash', color: '#ffffff', decay: 0.3, beatSync: true, every: 1, onAccents: true, brightness: 1 } }
    const a = r.accents.find((t) => t > 40)!
    const withFlash = { ...doc, cues: [flash] }
    expect(brightness(withFlash, a + 0.03)).toBeGreaterThan(brightness(withFlash, a - 0.4) + 0.5)
    const breathe: LightCue = { id: 'b', start: 0, duration: 72, fadeIn: 0, fadeOut: 0, blend: 'replace', effect: { kind: 'react', color: '#ffffff', floor: 0.1, brightness: 1 } }
    const br = { ...doc, cues: [breathe] }
    expect(brightness(br, 30)).toBeGreaterThan(brightness(br, 8) * 2)
  })

  it('lands a formation exactly on a section start — or as close as its safe flight allows', () => {
    const doc = withSong()
    const t = musicMoment(doc, { section: 3 })!
    const res = arriveAt(doc, 1, t)
    expect(res.arrival).toBeCloseTo(t, 2)
    expect(validate(res.doc, compile(res.doc)).issues).toEqual([])
    // Too early to reach safely: it gets as close as it can, never faster than safe.
    const early = arriveAt(doc, 2, 5)
    expect(early.arrival).toBeGreaterThan(5)
    expect(validate(early.doc, compile(early.doc)).issues).toEqual([])
  })

  it('fits the show to the song: arrivals on bars, ending with the music', () => {
    const doc = withSong()
    doc.scenes = doc.scenes.slice(0, 2)
    const fit = fitToSong(doc)
    const bars = barTimes(fit.doc)
    const barLen = bars[1]! - bars[0]!
    expect(Math.abs(fit.endGap)).toBeLessThanOrEqual(barLen + 1e-6)
    const c = compile(fit.doc)
    for (const st of c.sceneTimes) expect(bars.some((b) => Math.abs(b - st.holdStart) < 1e-3)).toBe(true)
    expect(validate(fit.doc, c).issues).toEqual([])
  })
})
