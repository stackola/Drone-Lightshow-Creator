import { describe, it, expect } from 'vitest'
import { formatTime, getTickInterval, computeTicks, waveformBarsInWindow, beatGridTimes } from './timelineMath'

describe('timelineMath', () => {
  it('formatTime renders m:ss.s', () => {
    expect(formatTime(0)).toBe('0:00.0')
    expect(formatTime(65.25)).toBe('1:05.3')
  })

  it('getTickInterval scales with density', () => {
    expect(getTickInterval(300)).toBe(1)
    expect(getTickInterval(100)).toBe(5)
    expect(getTickInterval(30)).toBe(10)
    expect(getTickInterval(10)).toBe(30)
  })

  it('computeTicks covers the window and marks majors', () => {
    const ticks = computeTicks(0, 20, 5)
    expect(ticks.map((t) => t.time)).toEqual([0, 5, 10, 15, 20])
    // interval 5 → major every 2nd
    expect(ticks.map((t) => t.isMajor)).toEqual([true, false, true, false, true])
  })

  it('computeTicks aligns the first tick below startTime', () => {
    const ticks = computeTicks(7, 20, 5)
    expect(ticks[0]!.time).toBe(5)
  })

  it('waveformBarsInWindow windows peaks by time', () => {
    const peaks = [0.1, 0.2, 0.3, 0.4] // duration 40 → t = 0,10,20,30
    const bars = waveformBarsInWindow(peaks, 40, 10, 25)
    expect(bars.map((b) => b.time)).toEqual([10, 20])
    expect(bars.map((b) => b.peak)).toEqual([0.2, 0.3])
  })

  it('waveformBarsInWindow handles missing audio', () => {
    expect(waveformBarsInWindow(null, 0, 0, 10)).toEqual([])
  })

  it('beatGridTimes prefers explicit markers, falls back to BPM grid', () => {
    expect(beatGridTimes([{ time: 1.5 }, { time: 3 }], 120, 10, true)).toEqual([1.5, 3])
    const grid = beatGridTimes([], 120, 2, false)
    expect(grid).toEqual([0, 0.5, 1, 1.5])
  })

  it('beatGridTimes clamps absurd BPM', () => {
    const grid = beatGridTimes([], 1, 4.1, false) // clamped to 30 bpm → 2s beats
    expect(grid).toEqual([0, 2, 4])
  })
})
