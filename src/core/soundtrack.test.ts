import { describe, expect, it } from 'vitest'
import { crashTimes, planEnergy, planFromMeta, renderSoundtrack, scorePlan, soundtrackMeta, type SoundtrackPlan } from './soundtrack'
import { parseProjectFile, toProjectFile } from './serialize'
import { newShow } from './defaults'

// 120 BPM → 2 s bars. 8 bars intro, 8 verse, 4 build, 8 drop, 4 outro = 64 s.
const plan: SoundtrackPlan = {
  bpm: 120, duration: 64, seed: 3,
  sections: [
    { label: 'intro', start: 0, end: 16, energy: 0 },
    { label: 'verse', start: 16, end: 32, energy: 0 },
    { label: 'build', start: 32, end: 40, energy: 0 },
    { label: 'drop', start: 40, end: 56, energy: 0 },
    { label: 'outro', start: 56, end: 64, energy: 0 },
  ],
}

describe('generated soundtrack', () => {
  it('knows its own music exactly: beat grid, sections, crashes, loudness', () => {
    const m = soundtrackMeta(plan, 'Test score')
    expect(m.bpm).toBe(120)
    expect(m.beats.length).toBe(128)
    expect(m.beats.every((b, i) => Math.abs(b - i * 0.5) < 1e-9)).toBe(true)
    expect(m.sections!.map((s) => s.label)).toEqual(['intro', 'verse', 'build', 'drop', 'outro'])
    expect(m.accents).toEqual(crashTimes(plan))
    expect(m.accents![0]).toBe(40)
    expect(planEnergy(plan, 48)).toBeGreaterThan(planEnergy(plan, 8))
    expect(planEnergy(plan, 39)).toBeGreaterThan(planEnergy(plan, 33))
  })

  it('saves as a recipe and comes back identical', () => {
    const doc = newShow(20)
    doc.audio = soundtrackMeta(plan, 'Test score')
    const back = parseProjectFile(JSON.stringify(toProjectFile(doc, null))).doc
    expect(back.audio!.generated).toBe(doc.audio.generated)
    expect(planFromMeta(back.audio!)).toEqual({ ...plan, sections: doc.audio.sections })
  })

  it('renders deterministic, clean audio that is louder in the drop than the intro', () => {
    const sr = 8000
    const a = renderSoundtrack(plan, sr), b = renderSoundtrack(plan, sr)
    expect(a.length).toBe(64 * sr)
    expect(a.every((x, i) => x === b[i])).toBe(true)
    let peak = 0
    for (const x of a) { expect(Number.isFinite(x)).toBe(true); peak = Math.max(peak, Math.abs(x)) }
    expect(peak).toBeLessThanOrEqual(1)
    expect(peak).toBeGreaterThan(0.5)
    const rms = (t0: number, t1: number) => { let s = 0; for (let i = t0 * sr; i < t1 * sr; i++) s += a[i]! ** 2; return Math.sqrt(s / ((t1 - t0) * sr)) }
    expect(rms(42, 54)).toBeGreaterThan(rms(2, 14) * 2)
  })
})

describe('score plans from marks', () => {
  it('snaps to bars, lets the more important section win a clash, merges repeats and starts at 0', () => {
    const p = scorePlan([['intro', 0], ['verse', 20.3], ['build', 25], ['drop', 41], ['verse', 43], ['verse', 60], ['outro', 70]], 120, 80)
    // verse@20 loses to build@26 (< 4 bars apart); verse@44 loses to drop@42; verse@60 continues it.
    expect(p.sections.map((s) => [s.label, s.start])).toEqual([['intro', 0], ['build', 26], ['drop', 42], ['verse', 60], ['outro', 70]])
    expect(p.sections[p.sections.length - 1]!.end).toBe(80)
    const first = scorePlan([['build', -10], ['drop', 10]], 120, 40)
    expect(first.sections[0]!.start).toBe(0)
  })
})
