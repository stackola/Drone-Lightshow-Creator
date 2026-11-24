import { describe, expect, it } from 'vitest'
import { unzipSync, strFromU8 } from 'fflate'
import { detectBeats } from './beats'
import { compile } from './compile'
import { evaluate } from './evaluate'
import { exportCsvZip } from './export'
import { newId, newScene, newShow } from './defaults'
import { parseProjectFile, toProjectFile } from './serialize'
import { defaultEffect } from './effects'
import { rng } from './math'

function clickTrack(bpm: number, seconds: number, sr: number, offset = 0.3): Float32Array {
  const out = new Float32Array(Math.floor(seconds * sr))
  const r = rng(9)
  for (let i = 0; i < out.length; i++) out[i] = (r() - 0.5) * 0.02
  const period = 60 / bpm
  for (let b = 0; offset + b * period < seconds; b++) {
    const start = Math.floor((offset + b * period) * sr)
    const accent = b % 4 === 0 ? 1 : 0.55
    for (let k = 0; k < sr * 0.03 && start + k < out.length; k++) out[start + k]! += accent * Math.sin(k * 0.35) * Math.exp(-k / (sr * 0.006))
  }
  return out
}

describe('beat detection', () => {
  it.each([96, 120, 128, 140])('finds %d BPM and lands on the clicks', (bpm) => {
    const sr = 22050
    const res = detectBeats(clickTrack(bpm, 20, sr), sr)
    expect(res.bpm).toBeGreaterThan(bpm * 0.98)
    expect(res.bpm).toBeLessThan(bpm * 1.02)
    const period = 60 / bpm
    // Every detected beat within 35 ms of a click.
    for (const b of res.beats.slice(1, -1)) {
      const phase = ((b - 0.3) / period) % 1
      const err = Math.min(phase, 1 - phase) * period
      expect(err).toBeLessThan(0.035)
    }
    expect(res.beats.length).toBeGreaterThan((20 / period) * 0.85)
  })

  it('identifies the accented downbeat', () => {
    const sr = 22050
    const res = detectBeats(clickTrack(120, 20, sr), sr)
    const b = res.beats[res.downbeat]!
    const beatIndex = Math.round((b - 0.3) / 0.5)
    expect(((beatIndex % 4) + 4) % 4).toBe(0)
  })
})

describe('project files', () => {
  it('round-trips a document', () => {
    const doc = newShow(80, 'Round trip')
    doc.scenes.push(newScene(doc, 'star'), newScene(doc, 'text'))
    doc.cues.push({ id: newId('cue'), start: 5, duration: 3, fadeIn: 0.5, fadeOut: 1, blend: 'add', effect: defaultEffect('flash') })
    const text = JSON.stringify(toProjectFile(doc))
    const back = parseProjectFile(text).doc
    expect(back).toEqual(doc)
  })

  it('repairs malformed input instead of crashing', () => {
    const { doc } = parseProjectFile(JSON.stringify({ name: 3, droneCount: 'lots', scenes: [{ layers: [{ shape: { kind: 'nope' } }] }, 'junk'], cues: [{ effect: { kind: 'flash', color: 'red' } }] }))
    expect(doc.name).toBe('Untitled show')
    expect(doc.droneCount).toBe(100)
    expect(doc.scenes).toHaveLength(1)
    expect(doc.scenes[0]!.layers).toHaveLength(1)
    expect(doc.cues[0]!.effect).toMatchObject({ kind: 'flash', color: '#ffffff' })
    expect(() => compile(doc)).not.toThrow()
  })

  it('rejects files that are not projects', () => {
    expect(() => parseProjectFile('not json')).toThrow(/JSON/)
    expect(() => parseProjectFile('{"hello":1}')).toThrow(/not a drone show/)
  })
})

describe('light cues', () => {
  it('blend over the base look with fades, and do not move drones', () => {
    const doc = newShow(30)
    doc.scenes.push(newScene(doc, 'circle', { color: '#ff0000' }))
    const base = compile(doc)
    const hold = base.sceneTimes[0]!
    const t = hold.holdStart + 1
    doc.cues.push({ id: 'q', start: hold.holdStart, duration: 4, fadeIn: 2, fadeOut: 0, blend: 'replace', effect: defaultEffect('solid', '#0000ff') })
    const c = compile(doc)
    const p0 = new Float32Array(90), p1 = new Float32Array(90), c0 = new Float32Array(90), c1 = new Float32Array(90)
    evaluate(base, t, p0, c0)
    evaluate(c, t, p1, c1)
    expect(Array.from(p1)).toEqual(Array.from(p0))
    // Halfway through the fade-in: equal mix of red and blue.
    expect(c1[0]).toBeCloseTo(0.5, 5)
    expect(c1[2]).toBeCloseTo(0.5, 5)
    const after = new Float32Array(90)
    evaluate(c, hold.holdStart + 4.5, p1, after)
    expect(after[0]).toBeCloseTo(1, 5)
  })
})

describe('export', () => {
  it('writes one CSV per drone that matches evaluate()', () => {
    const doc = newShow(12, 'Export test')
    doc.scenes.push(newScene(doc, 'heart'))
    const c = compile(doc)
    const files = unzipSync(exportCsvZip(c, { rate: 4 }, doc.name))
    const names = Object.keys(files).filter((f) => f.endsWith('.csv'))
    expect(names).toHaveLength(12)
    const lines = strFromU8(files['drone_01.csv']!).trim().split('\n')
    expect(lines[0]).toBe('time_s,east_m,north_m,up_m,red,green,blue')
    expect(lines).toHaveLength(Math.ceil(c.duration * 4) + 2)
    const row = lines[20]!.split(',').map(Number)
    const pos = new Float32Array(36), col = new Float32Array(36)
    evaluate(c, row[0]!, pos, col)
    expect(row[1]).toBeCloseTo(pos[0]!, 2)
    expect(row[2]).toBeCloseTo(-pos[2]!, 2)
    expect(row[3]).toBeCloseTo(pos[1]!, 2)
    // Starts and ends on the ground.
    expect(Number(lines[1]!.split(',')[3])).toBe(0)
    expect(Number(lines[lines.length - 1]!.split(',')[3])).toBeCloseTo(0, 3)
  })
})
