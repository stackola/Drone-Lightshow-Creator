import { describe, it, expect, beforeEach } from 'vitest'
import { useAudioStore } from './audioStore'

function reset() {
  useAudioStore.setState({
    audioBuffer: null,
    audioFileName: null,
    duration: 0,
    waveformPeaks: null,
    waveformSampleRate: 4096,
    bpm: 120,
    beatMarkers: [],
    beatSubdivision: 1,
    regions: [],
    isAudioLoaded: false,
  })
}

describe('audioStore', () => {
  beforeEach(reset)

  it('starts with sensible defaults', () => {
    const s = useAudioStore.getState()
    expect(s.bpm).toBe(120)
    expect(s.beatSubdivision).toBe(1)
    expect(s.beatMarkers).toEqual([])
    expect(s.isAudioLoaded).toBe(false)
  })

  it('setBpm clamps to [30, 300]', () => {
    useAudioStore.getState().setBpm(15)
    expect(useAudioStore.getState().bpm).toBe(30)
    useAudioStore.getState().setBpm(500)
    expect(useAudioStore.getState().bpm).toBe(300)
    useAudioStore.getState().setBpm(140)
    expect(useAudioStore.getState().bpm).toBe(140)
  })

  it('addBeatMarker inserts sorted by time', () => {
    const s = useAudioStore.getState()
    s.addBeatMarker(5)
    s.addBeatMarker(2)
    s.addBeatMarker(8)
    const markers = useAudioStore.getState().beatMarkers
    expect(markers.map((m) => m.time)).toEqual([2, 5, 8])
    expect(markers.every((m) => m.type === 'manual')).toBe(true)
  })

  it('removeBeatMarker drops a marker within 10 ms tolerance', () => {
    useAudioStore.getState().addBeatMarker(2.5)
    useAudioStore.getState().addBeatMarker(7.5)
    useAudioStore.getState().removeBeatMarker(2.505)
    const remaining = useAudioStore.getState().beatMarkers.map((m) => m.time)
    expect(remaining).toEqual([7.5])
  })

  it('addRegion + removeRegion by id', () => {
    useAudioStore.getState().addRegion({ id: 'r1', label: 'Intro', start: 0, end: 5, color: '#fff' })
    useAudioStore.getState().addRegion({ id: 'r2', label: 'Chorus', start: 5, end: 10, color: '#000' })
    expect(useAudioStore.getState().regions.length).toBe(2)
    useAudioStore.getState().removeRegion('r1')
    expect(useAudioStore.getState().regions.map((r) => r.id)).toEqual(['r2'])
  })

  describe('snapToNearestBeat', () => {
    it('with empty markers, snaps to BPM grid', () => {
      // 120 BPM = 0.5 s per beat. Snap of 0.8 → 1.0; snap of 0.2 → 0.0.
      const s = useAudioStore.getState()
      expect(s.snapToNearestBeat(0.8)).toBeCloseTo(1.0)
      expect(s.snapToNearestBeat(0.2)).toBeCloseTo(0.0)
    })

    it('with empty markers + beatSubdivision=2, halves the grid', () => {
      useAudioStore.getState().setBeatSubdivision(2)
      // 120 BPM / 2 = 0.25 s per sub-beat.
      const s = useAudioStore.getState()
      expect(s.snapToNearestBeat(0.4)).toBeCloseTo(0.5)
      expect(s.snapToNearestBeat(0.1)).toBeCloseTo(0.0)
    })

    it('with markers, snaps to the nearest one', () => {
      useAudioStore.getState().addBeatMarker(1.0)
      useAudioStore.getState().addBeatMarker(2.7)
      useAudioStore.getState().addBeatMarker(5.5)
      const s = useAudioStore.getState()
      expect(s.snapToNearestBeat(2.9)).toBeCloseTo(2.7)
      expect(s.snapToNearestBeat(5.0)).toBeCloseTo(5.5)
      expect(s.snapToNearestBeat(1.5)).toBeCloseTo(1.0)
    })
  })

  it('clearAudio resets everything', () => {
    useAudioStore.setState({
      isAudioLoaded: true,
      bpm: 140,
      beatMarkers: [{ time: 1, type: 'detected' }],
      regions: [{ id: 'r', label: 'x', start: 0, end: 1, color: '#fff' }],
      duration: 60,
    })
    useAudioStore.getState().clearAudio()
    const after = useAudioStore.getState()
    expect(after.isAudioLoaded).toBe(false)
    expect(after.bpm).toBe(120)
    expect(after.beatMarkers).toEqual([])
    expect(after.regions).toEqual([])
    expect(after.duration).toBe(0)
  })
})
