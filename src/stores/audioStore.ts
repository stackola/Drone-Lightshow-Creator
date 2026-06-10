// ============================================================================
// S18-01: AudioStore — Audio state management for music sync
// S18-02: Audio file import
// S18-03: Waveform computation
// S18-04: Audio playback sync
// S18-06/07/08/09/10/11: Beat detection, markers, snap, regions
// ============================================================================

import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'

export interface BeatMarker {
  time: number
  type: 'detected' | 'manual'
}

export interface AudioRegion {
  id: string
  label: string
  start: number
  end: number
  color: string
}

export interface AudioStoreState {
  // Audio file
  audioBuffer: AudioBuffer | null
  audioFileName: string | null
  duration: number

  // Waveform data (peaks for visualization)
  waveformPeaks: Float32Array | null
  waveformSampleRate: number

  // Beat detection
  bpm: number
  beatMarkers: BeatMarker[]
  beatSubdivision: 1 | 2 | 4 | 8

  // Regions
  regions: AudioRegion[]

  // Playback sync
  isAudioLoaded: boolean

  // Actions
  loadAudio: (file: File) => Promise<void>
  clearAudio: () => void
  setBpm: (bpm: number) => void
  addBeatMarker: (time: number) => void
  removeBeatMarker: (time: number) => void
  setBeatSubdivision: (sub: 1 | 2 | 4 | 8) => void
  addRegion: (region: AudioRegion) => void
  removeRegion: (id: string) => void
  snapToNearestBeat: (time: number) => number
}

let audioContext: AudioContext | null = null

function getAudioContext(): AudioContext {
  if (!audioContext) audioContext = new AudioContext()
  return audioContext
}

// S18-03: Compute waveform peaks from AudioBuffer
function computeWaveformPeaks(buffer: AudioBuffer, targetSamples: number = 4096): Float32Array {
  const channel = buffer.getChannelData(0)
  const samplesPerPeak = Math.max(1, Math.floor(channel.length / targetSamples))
  const peaks = new Float32Array(targetSamples)
  for (let i = 0; i < targetSamples; i++) {
    let max = 0
    const start = i * samplesPerPeak
    const end = Math.min(start + samplesPerPeak, channel.length)
    for (let j = start; j < end; j++) {
      const abs = Math.abs(channel[j]!)
      if (abs > max) max = abs
    }
    peaks[i] = max
  }
  return peaks
}

// S18-06: Simple beat detection via onset energy
function detectBeats(buffer: AudioBuffer): { bpm: number; markers: BeatMarker[] } {
  const channel = buffer.getChannelData(0)
  const sampleRate = buffer.sampleRate
  const windowSize = Math.floor(sampleRate * 0.02) // 20ms windows
  const hopSize = Math.floor(windowSize / 2)
  const energies: number[] = []

  for (let i = 0; i < channel.length - windowSize; i += hopSize) {
    let energy = 0
    for (let j = 0; j < windowSize; j++) {
      energy += channel[i + j]! * channel[i + j]!
    }
    energies.push(energy / windowSize)
  }

  // Find peaks in energy (onsets)
  const markers: BeatMarker[] = []
  const threshold = energies.reduce((s, e) => s + e, 0) / energies.length * 1.5

  for (let i = 1; i < energies.length - 1; i++) {
    if (energies[i]! > threshold && energies[i]! > energies[i - 1]! && energies[i]! > energies[i + 1]!) {
      const time = (i * hopSize) / sampleRate
      // Avoid markers too close together
      if (markers.length === 0 || time - markers[markers.length - 1]!.time > 0.2) {
        markers.push({ time, type: 'detected' })
      }
    }
  }

  // Estimate BPM from average beat interval
  let bpm = 120
  if (markers.length > 2) {
    const intervals = markers.slice(1).map((m, i) => m.time - markers[i]!.time)
    const avgInterval = intervals.reduce((s, i) => s + i, 0) / intervals.length
    bpm = Math.round(60 / avgInterval)
    bpm = Math.max(60, Math.min(240, bpm))
  }

  return { bpm, markers }
}

export const useAudioStore = create<AudioStoreState>()(
  immer((set, get) => ({
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

    async loadAudio(file: File) {
      const ctx = getAudioContext()
      const arrayBuffer = await file.arrayBuffer()
      const audioBuffer = await ctx.decodeAudioData(arrayBuffer)
      const peaks = computeWaveformPeaks(audioBuffer)
      const { bpm, markers } = detectBeats(audioBuffer)

      set((state) => {
        state.audioBuffer = audioBuffer as unknown as AudioBuffer
        state.audioFileName = file.name
        state.duration = audioBuffer.duration
        state.waveformPeaks = peaks as unknown as Float32Array
        state.bpm = bpm
        state.beatMarkers = markers
        state.isAudioLoaded = true
      })
    },

    clearAudio() {
      set((state) => {
        state.audioBuffer = null
        state.audioFileName = null
        state.duration = 0
        state.waveformPeaks = null
        state.bpm = 120
        state.beatMarkers = []
        state.regions = []
        state.isAudioLoaded = false
      })
    },

    setBpm(bpm) {
      set((state) => { state.bpm = Math.max(30, Math.min(300, bpm)) })
    },

    addBeatMarker(time) {
      set((state) => {
        state.beatMarkers.push({ time, type: 'manual' })
        state.beatMarkers.sort((a, b) => a.time - b.time)
      })
    },

    removeBeatMarker(time) {
      set((state) => {
        state.beatMarkers = state.beatMarkers.filter((m) => Math.abs(m.time - time) > 0.01)
      })
    },

    setBeatSubdivision(sub) {
      set((state) => { state.beatSubdivision = sub })
    },

    addRegion(region) {
      set((state) => { state.regions.push(region) })
    },

    removeRegion(id) {
      set((state) => { state.regions = state.regions.filter((r) => r.id !== id) })
    },

    // S18-09: Snap to nearest beat marker
    snapToNearestBeat(time) {
      const { beatMarkers, beatSubdivision, bpm } = get()
      if (beatMarkers.length === 0) {
        // Use BPM grid
        const beatInterval = 60 / bpm / beatSubdivision
        return Math.round(time / beatInterval) * beatInterval
      }
      // Find nearest marker
      let nearest = beatMarkers[0]!.time
      let minDist = Math.abs(time - nearest)
      for (const m of beatMarkers) {
        const dist = Math.abs(time - m.time)
        if (dist < minDist) { minDist = dist; nearest = m.time }
      }
      return nearest
    },
  })),
)
