// ============================================================================
// Time Ruler with S18-05: Waveform display + S18-07: Beat marker overlay
// Tick/waveform/beat math lives in components/timeline/timelineMath.ts,
// shared with the viewport's TimelineRulerPanel lanes.
// ============================================================================

import { useCallback } from 'react'
import { useViewport } from '@xyflow/react'
import { useViewStore } from '../../../stores/viewStore'
import { usePlayheadStore } from '../../../stores/playheadStore'
import { useAudioStore } from '../../../stores/audioStore'
import { formatTime, getTickInterval, computeTicks, waveformBarsInWindow } from '../../timeline/timelineMath'

export function TimeRuler() {
  const viewport = useViewport()
  const pxPerSecond = useViewStore((s) => s.pxPerSecond)
  const setCurrentTime = usePlayheadStore((s) => s.setCurrentTime)
  const waveformPeaks = useAudioStore((s) => s.waveformPeaks)
  const audioDuration = useAudioStore((s) => s.duration)
  const beatMarkers = useAudioStore((s) => s.beatMarkers)
  const isAudioLoaded = useAudioStore((s) => s.isAudioLoaded)

  const zoom = viewport.zoom
  const panX = viewport.x

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      const rect = e.currentTarget.getBoundingClientRect()
      const clickX = e.clientX - rect.left
      const canvasX = (clickX - panX) / (pxPerSecond * zoom)
      setCurrentTime(Math.max(0, canvasX))
    },
    [panX, pxPerSecond, zoom, setCurrentTime],
  )

  const tickInterval = getTickInterval(pxPerSecond * zoom)
  const timeToX = (t: number) => t * pxPerSecond * zoom + panX

  const viewportWidthPx = typeof window !== 'undefined' ? window.innerWidth : 1200
  const startTime = Math.max(0, Math.floor(-panX / (pxPerSecond * zoom) / tickInterval) * tickInterval)
  const endTime = startTime + (viewportWidthPx / (pxPerSecond * zoom)) + tickInterval * 2

  const ticks = computeTicks(startTime, endTime, tickInterval).map((t) => ({
    ...t,
    screenX: timeToX(t.time),
  }))

  // S18-05: Compute waveform bar positions
  const waveformBars = (isAudioLoaded
    ? waveformBarsInWindow(waveformPeaks, audioDuration, startTime, endTime)
    : []
  ).map((b) => ({ x: timeToX(b.time), height: b.peak * 20 }))

  // S18-07: Compute visible beat marker positions
  const visibleBeats: { x: number; type: string }[] = []
  if (isAudioLoaded && beatMarkers.length > 0) {
    for (const marker of beatMarkers) {
      if (marker.time < startTime || marker.time > endTime) continue
      const x = marker.time * pxPerSecond * zoom + panX
      visibleBeats.push({ x, type: marker.type })
    }
  }

  return (
    <div className="absolute top-0 left-0 right-0 h-8 bg-surface-raised/80 border-b border-white/10 z-20 cursor-pointer overflow-hidden" onClick={handleClick} role="slider" aria-label="Timeline ruler" aria-valuemin={0} tabIndex={0}>
      {/* S18-05: Waveform display */}
      {waveformBars.map((bar, i) => (
        <div key={`w${i}`} className="absolute bottom-0 bg-blue-400/20" style={{
          left: bar.x, width: 2, height: bar.height,
        }} />
      ))}

      {/* S18-07: Beat markers */}
      {visibleBeats.map((beat, i) => (
        <div key={`b${i}`} className="absolute top-0 bottom-0 w-px" style={{
          left: beat.x,
          backgroundColor: beat.type === 'manual' ? 'rgba(250,204,21,0.4)' : 'rgba(168,85,247,0.3)',
        }} />
      ))}

      {/* Time ticks */}
      {ticks.map((tick) => (
        <div key={tick.time} className="absolute top-0" style={{ left: tick.screenX }}>
          <div className={`w-px ${tick.isMajor ? 'h-6 bg-white/40' : 'h-3 bg-white/20'}`} />
          {tick.isMajor && (
            <span className="absolute top-0 left-1 text-[9px] text-white/50 whitespace-nowrap">
              {formatTime(tick.time)}
            </span>
          )}
        </div>
      ))}
    </div>
  )
}
