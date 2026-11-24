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
  })
})
