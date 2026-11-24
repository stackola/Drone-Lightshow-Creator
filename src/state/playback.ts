// Transport. When music is loaded, the audio clock is the master clock, so
// lights stay locked to the beat; otherwise performance.now() drives time.

import { getState, useStore } from './store'

let ctx: AudioContext | null = null
let source: AudioBufferSourceNode | null = null
let gain: GainNode | null = null
let raf = 0
let startClock = 0
let startShow = 0
let usingAudio = false

export function audioContext(): AudioContext {
  if (!ctx) {
    ctx = new AudioContext()
    gain = ctx.createGain()
    gain.connect(ctx.destination)
  }
  return ctx
}

function clockNow(): number {
  return usingAudio && ctx ? ctx.currentTime : performance.now() / 1000
}

export function showNow(): number {
  return startShow + (clockNow() - startClock) * getState().rate
}

function stopSource() {
  if (source) {
    try { source.stop() } catch { /* already stopped */ }
    source.disconnect()
    source = null
  }
}

function startSource(t: number) {
  const s = getState()
  usingAudio = false
  if (!s.audio || !s.doc.audio) return
  const c = audioContext()
  void c.resume()
  const src = c.createBufferSource()
  src.buffer = s.audio.buffer
  src.playbackRate.value = s.rate
  src.connect(gain!)
  const audioT = t - s.doc.audio.offset
  if (audioT >= s.audio.buffer.duration) return
  if (audioT >= 0) src.start(0, audioT)
  else src.start(c.currentTime + -audioT / s.rate, 0)
  source = src
  usingAudio = true
}

function tick() {
  const s = getState()
  const dur = s.compiled?.duration ?? 0
  const t = showNow()
  if (t >= dur) {
    if (s.loop && dur > 0) {
      begin(0)
      return
    }
    pause()
    s.set({ time: dur })
    return
  }
  s.set({ time: t })
  raf = requestAnimationFrame(tick)
}

function begin(t: number) {
  stopSource()
  cancelAnimationFrame(raf)
  startSource(t)
  startShow = t
  startClock = clockNow()
  getState().set({ time: t, playing: true })
  raf = requestAnimationFrame(tick)
}

export function play() {
  const s = getState()
  const dur = s.compiled?.duration ?? 0
  if (!dur) return
  begin(s.time >= dur - 0.05 ? 0 : s.time)
}

export function pause() {
  cancelAnimationFrame(raf)
  stopSource()
  getState().set({ playing: false })
}

export function togglePlay() {
  if (getState().playing) pause()
  else play()
}

export function seek(t: number) {
  const s = getState()
  const dur = s.compiled?.duration ?? 0
  const clamped = Math.max(0, Math.min(dur, t))
  if (s.playing) begin(clamped)
  else s.set({ time: clamped })
}

export function setRate(rate: number) {
  const s = getState()
  const t = s.playing ? showNow() : s.time
  s.set({ rate })
  if (s.playing) begin(t)
}

// Restart audio if the music or its offset changes mid-playback.
useStore.subscribe((s, prev) => {
  if (s.playing && (s.audio !== prev.audio || s.doc.audio?.offset !== prev.doc.audio?.offset)) begin(showNow())
})
