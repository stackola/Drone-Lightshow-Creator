import { describe, expect, it } from 'vitest'
import { DEMOS } from './demos'
import { compile } from '@/core/compile'
import { validate } from '@/core/validate'

describe('demo shows', () => {
  it.each(DEMOS.map((d) => [d.id, d] as const))('%s passes every safety check', (_id, demo) => {
    const doc = demo.build()
    expect(doc.droneCount).toBe(demo.drones)
    const c = compile(doc)
    const v = validate(doc, c)
    expect(v.issues.map((i) => `${i.title}: ${i.detail}`)).toEqual([])
    expect(v.stats.minDistance).toBeGreaterThanOrEqual(doc.limits.minSpacing)
    expect(c.duration).toBeLessThan(doc.limits.maxFlightTime)
  }, 180_000)
})

describe('Odyssey', () => {
  it('has its own score, composed to the show: drops start as the hero formations arrive', async () => {
    const { buildOdyssey } = await import('./odyssey')
    const doc = buildOdyssey(compile)
    const c = compile(doc)
    const audio = doc.audio!
    expect(audio.generated).toMatch(/^soundtrack-v1/)
    const bar = (60 / audio.bpm) * 4
    const arrive = (name: string) => c.sceneTimes[doc.scenes.findIndex((s) => s.name === name)]!.holdStart
    for (const st of c.sceneTimes) expect(Math.abs(st.holdStart / bar - Math.round(st.holdStart / bar))).toBeLessThan(1e-3)
    const drops = audio.sections!.filter((s) => s.label === 'drop').map((s) => s.start)
    for (const hero of ['Tree of life', 'Earth', 'Together (LED)', 'Saturn', 'Ring of fire']) expect(drops.some((d) => Math.abs(d - arrive(hero)) < 1e-3), hero).toBe(true)
    expect(audio.duration).toBeGreaterThanOrEqual(c.duration)
    expect(audio.duration - c.duration).toBeLessThan(2 * bar + 1e-6)
    expect(doc.cues.some((q) => q.tag === 'music')).toBe(true)
    expect(validate(doc, c).issues).toEqual([])
  }, 180_000)
})
