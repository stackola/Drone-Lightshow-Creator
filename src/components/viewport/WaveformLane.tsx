// ============================================================================
// Bundle 5: Waveform + Beat markers + Loop region for the timeline ruler.
// ============================================================================

import { useEffect, useRef } from 'react'
import { useAudioStore } from '../../stores/audioStore'
import { usePlayheadStore } from '../../stores/playheadStore'
import { useViewStore } from '../../stores/viewStore'
import { beatGridTimes } from '../timeline/timelineMath'

const WAVEFORM_HEIGHT = 36

export function WaveformLane({ totalDuration, totalPx }: { totalDuration: number; totalPx: number }) {
  const peaks = useAudioStore((s) => s.waveformPeaks)
  const audioDuration = useAudioStore((s) => s.duration)
  const audioName = useAudioStore((s) => s.audioFileName)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const c = canvasRef.current
    if (!c) return
    const w = Math.max(1, Math.floor(totalPx))
    const h = WAVEFORM_HEIGHT
    c.width = w
    c.height = h
    const ctx = c.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, w, h)
    if (!peaks || audioDuration <= 0) {
      ctx.fillStyle = 'rgba(255,255,255,0.04)'
      ctx.fillRect(0, 0, w, h)
      ctx.fillStyle = 'rgba(255,255,255,0.25)'
      ctx.font = '10px ui-monospace,monospace'
      ctx.fillText(audioName ? `Loading ${audioName}…` : 'No audio (drop a file or load via Audio store)', 8, 22)
      return
    }
    ctx.fillStyle = 'rgba(34, 211, 238, 0.04)'
    ctx.fillRect(0, 0, w, h)
    ctx.strokeStyle = 'rgba(34, 211, 238, 0.7)'
    ctx.lineWidth = 1
    ctx.beginPath()
    const mid = h / 2
    for (let x = 0; x < w; x++) {
      const t = (x / w) * totalDuration
      if (t > audioDuration) break
      const peakIdx = Math.floor((t / audioDuration) * peaks.length)
      const peak = peaks[peakIdx] ?? 0
      ctx.moveTo(x + 0.5, mid - peak * (mid - 1))
      ctx.lineTo(x + 0.5, mid + peak * (mid - 1))
    }
    ctx.stroke()
  }, [peaks, audioDuration, audioName, totalPx, totalDuration])

  return (
    <div className="absolute left-0 right-0 pointer-events-none" style={{ top: 0, height: WAVEFORM_HEIGHT, opacity: 0.85 }}>
      <canvas ref={canvasRef} className="block" />
    </div>
  )
}

export function BeatMarkers({ pxPerSecond, totalDuration }: { pxPerSecond: number; totalDuration: number }) {
  const beats = useAudioStore((s) => s.beatMarkers)
  const bpm = useAudioStore((s) => s.bpm)
  const isLoaded = useAudioStore((s) => s.isAudioLoaded)
  const beatSnap = useViewStore((s) => s.beatSnap)

  // Explicit beats when audio is loaded; otherwise the BPM grid (shared math).
  const ticks = beatGridTimes(beats, bpm, totalDuration, isLoaded)

  return (
    <div className="absolute top-5 bottom-0 left-0 right-0 pointer-events-none">
      {ticks.map((t, i) => (
        <div
          key={i}
          className={`absolute top-0 bottom-0 w-px ${beatSnap ? 'bg-fuchsia-300/30' : 'bg-fuchsia-400/15'}`}
          style={{ left: t * pxPerSecond }}
        />
      ))}
    </div>
  )
}

export function LoopRegion({ pxPerSecond }: { pxPerSecond: number }) {
  const enabled = usePlayheadStore((s) => s.loopEnabled)
  const start = usePlayheadStore((s) => s.loopStart)
  const end = usePlayheadStore((s) => s.loopEnd)
  const mode = usePlayheadStore((s) => s.loopMode)
  if (!enabled) return null
  const left = start * pxPerSecond
  const width = Math.max(2, (end - start) * pxPerSecond)
  // F-01: ping-pong gets a different border style so the user can tell at a
  // glance which mode they're in without reading the tooltip.
  const borderClass = mode === 'ping-pong'
    ? 'border-l-2 border-r-2 border-dashed border-amber-300/80'
    : 'border-l border-r border-amber-300/60'
  return (
    <div
      className={`absolute top-0 bottom-0 bg-amber-400/10 pointer-events-none ${borderClass}`}
      style={{ left, width }}
      title={`Loop ${start.toFixed(1)}s — ${end.toFixed(1)}s (${mode})`}
    />
  )
}
