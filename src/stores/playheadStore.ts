// ============================================================================
// Playhead Store — Playback State
// ============================================================================

import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'

/** F-01: sub-mode applied when `loopEnabled === true`. */
export type LoopMode = 'loop' | 'ping-pong'

export interface PlayheadStoreState {
  currentTime: number
  isPlaying: boolean
  playbackSpeed: number
  loopStart: number
  loopEnd: number
  loopEnabled: boolean
  /** F-01: which kind of looping. Only consulted when `loopEnabled === true`. */
  loopMode: LoopMode
  /** F-01: ping-pong direction. Internal; not user-set. +1 forward, -1 backward. */
  pingDir: 1 | -1
  maxTime: number

  setCurrentTime: (t: number) => void
  setMaxTime: (t: number) => void
  setPlaying: (playing: boolean) => void
  setPlaybackSpeed: (speed: number) => void
  setLoopRange: (start: number, end: number) => void
  toggleLoop: () => void
  setLoopMode: (mode: LoopMode) => void
  tick: (deltaMs: number) => void
}

export const usePlayheadStore = create<PlayheadStoreState>()(
  immer((set) => ({
    currentTime: 0,
    isPlaying: false,
    playbackSpeed: 1,
    loopStart: 0,
    loopEnd: 30,
    loopEnabled: false,
    loopMode: 'loop' as LoopMode,
    pingDir: 1 as 1 | -1,
    maxTime: 600, // 10 minutes default max

    setCurrentTime(t) {
      set((state) => {
        state.currentTime = Math.max(0, t)
      })
    },

    setPlaying(playing) {
      set((state) => {
        state.isPlaying = playing
      })
    },

    setPlaybackSpeed(speed) {
      set((state) => {
        state.playbackSpeed = speed
      })
    },

    setLoopRange(start, end) {
      set((state) => {
        state.loopStart = Math.max(0, start)
        state.loopEnd = Math.max(state.loopStart + 0.1, end)
      })
    },

    setMaxTime(t) {
      set((state) => { state.maxTime = Math.max(1, t) })
    },

    toggleLoop() {
      set((state) => {
        state.loopEnabled = !state.loopEnabled
        // Reset ping-pong direction when toggling so re-entering the loop
        // doesn't pick up a stale -1 from the prior session.
        state.pingDir = 1
      })
    },

    setLoopMode(mode) {
      set((state) => {
        state.loopMode = mode
        state.pingDir = 1
      })
    },

    tick(deltaMs) {
      set((state) => {
        if (!state.isPlaying) return
        const dirMul = state.loopEnabled && state.loopMode === 'ping-pong' ? state.pingDir : 1
        const deltaSec = (deltaMs * state.playbackSpeed * dirMul) / 1000
        let newTime = state.currentTime + deltaSec

        if (state.loopEnabled) {
          if (state.loopMode === 'loop' && newTime >= state.loopEnd) {
            const loopDuration = state.loopEnd - state.loopStart
            newTime = state.loopStart + ((newTime - state.loopStart) % loopDuration)
          } else if (state.loopMode === 'ping-pong') {
            if (newTime >= state.loopEnd) {
              newTime = state.loopEnd - (newTime - state.loopEnd)
              state.pingDir = -1
            } else if (newTime <= state.loopStart) {
              newTime = state.loopStart + (state.loopStart - newTime)
              state.pingDir = 1
            }
          }
        }

        // Clamp to maxTime; stop playing if we reach the end (non-loop mode)
        if (!state.loopEnabled && newTime >= state.maxTime) {
          newTime = state.maxTime
          state.isPlaying = false
        }

        state.currentTime = Math.max(0, newTime)
      })
    },
  })),
)
