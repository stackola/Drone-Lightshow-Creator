import { describe, it, expect, beforeEach } from 'vitest'
import { usePlayheadStore } from './playheadStore'

function resetStore() {
  usePlayheadStore.setState({
    currentTime: 0,
    isPlaying: false,
    playbackSpeed: 1,
    loopStart: 0,
    loopEnd: 30,
    loopEnabled: false,
    loopMode: 'loop',
    pingDir: 1,
  })
}

describe('S1-06: playheadStore', () => {
  beforeEach(resetStore)

  it('tick advances currentTime', () => {
    usePlayheadStore.getState().setPlaying(true)
    usePlayheadStore.getState().tick(1000) // 1 second at 1x speed
    expect(usePlayheadStore.getState().currentTime).toBeCloseTo(1, 5)
  })

  it('tick does not advance when not playing', () => {
    usePlayheadStore.getState().tick(1000)
    expect(usePlayheadStore.getState().currentTime).toBe(0)
  })

  it('loop wraps around when enabled', () => {
    const store = usePlayheadStore.getState()
    store.setPlaying(true)
    store.setLoopRange(5, 10)
    store.toggleLoop()
    store.setCurrentTime(9.5)

    // Tick 1 second — should wrap from 10.5 to 5.5
    usePlayheadStore.getState().tick(1000)
    expect(usePlayheadStore.getState().currentTime).toBeCloseTo(5.5, 5)
  })

  it('speed multiplier works', () => {
    const store = usePlayheadStore.getState()
    store.setPlaying(true)
    store.setPlaybackSpeed(2)
    store.tick(500) // 0.5 seconds * 2x = 1 second
    expect(usePlayheadStore.getState().currentTime).toBeCloseTo(1, 5)
  })

  it('setCurrentTime clamps to >= 0', () => {
    usePlayheadStore.getState().setCurrentTime(-5)
    expect(usePlayheadStore.getState().currentTime).toBe(0)
  })

  it('F-01: ping-pong mode reverses at loopEnd and loopStart', () => {
    const store = usePlayheadStore.getState()
    store.setPlaying(true)
    store.setLoopRange(2, 5)
    store.toggleLoop()
    store.setLoopMode('ping-pong')
    store.setCurrentTime(4.5)

    // Tick forward past loopEnd (5). Should reflect back: 4.5 + 1 = 5.5 → reflected to 4.5
    usePlayheadStore.getState().tick(1000)
    expect(usePlayheadStore.getState().currentTime).toBeCloseTo(4.5, 5)
    expect(usePlayheadStore.getState().pingDir).toBe(-1)

    // Next tick should travel backwards (deltaSec < 0)
    usePlayheadStore.getState().tick(500)
    expect(usePlayheadStore.getState().currentTime).toBeCloseTo(4.0, 5)
    expect(usePlayheadStore.getState().pingDir).toBe(-1)
  })

  it('F-01: setLoopMode resets pingDir', () => {
    usePlayheadStore.setState({ pingDir: -1 })
    usePlayheadStore.getState().setLoopMode('loop')
    expect(usePlayheadStore.getState().pingDir).toBe(1)
  })
})
