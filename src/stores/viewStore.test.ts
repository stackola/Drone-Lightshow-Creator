import { describe, it, expect } from 'vitest'
import { timeToCanvasX, canvasXToTime } from './viewStore'

describe('S1-07: viewStore', () => {
  it('timeToCanvasX → canvasXToTime round-trip', () => {
    const pps = 100
    const time = 7.5
    const x = timeToCanvasX(time, pps)
    expect(canvasXToTime(x, pps)).toBeCloseTo(time, 10)
  })

  it('canvasXToTime → timeToCanvasX round-trip', () => {
    const pps = 80
    const x = 640
    const time = canvasXToTime(x, pps)
    expect(timeToCanvasX(time, pps)).toBeCloseTo(x, 10)
  })

  it('zero time gives zero canvas X', () => {
    expect(timeToCanvasX(0, 100)).toBe(0)
    expect(canvasXToTime(0, 100)).toBe(0)
  })
})
