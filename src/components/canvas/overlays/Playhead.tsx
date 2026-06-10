import { useCallback, useRef, type KeyboardEvent } from 'react'
import { useViewport } from '@xyflow/react'
import { usePlayheadStore } from '../../../stores/playheadStore'
import { useViewStore } from '../../../stores/viewStore'
import { timeToCanvasX } from '../../../stores/viewStore'

export function Playhead() {
  const viewport = useViewport()
  const currentTime = usePlayheadStore((s) => s.currentTime)
  const setCurrentTime = usePlayheadStore((s) => s.setCurrentTime)
  const pxPerSecond = useViewStore((s) => s.pxPerSecond)
  const isDragging = useRef(false)

  const canvasX = timeToCanvasX(currentTime, pxPerSecond)
  const screenX = canvasX * viewport.zoom + viewport.x

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault()
      e.stopPropagation()
      isDragging.current = true
      ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    },
    [],
  )

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!isDragging.current) return
      // Find the ruler container to get proper bounds
      const container = (e.target as HTMLElement).closest('.react-flow') ?? document.body
      const rect = container.getBoundingClientRect()
      const clickX = e.clientX - rect.left
      const time = (clickX - viewport.x) / (pxPerSecond * viewport.zoom)
      setCurrentTime(Math.max(0, time))
    },
    [viewport.x, viewport.zoom, pxPerSecond, setCurrentTime],
  )

  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      isDragging.current = false
      const el = e.target as HTMLElement
      el.releasePointerCapture(e.pointerId)
    },
    [],
  )

  return (
    <div
      className="absolute top-0 bottom-0 z-30 pointer-events-none"
      style={{ left: screenX }}
    >
      {/* Triangle handle at top — larger hit area, keyboard accessible */}
      <div
        className="absolute -top-1 -translate-x-1/2 w-6 h-6 pointer-events-auto cursor-grab active:cursor-grabbing flex items-start justify-center"
        role="slider"
        aria-label="Playhead position"
        aria-valuenow={Math.round(currentTime * 10) / 10}
        aria-valuemin={0}
        tabIndex={0}
        onKeyDown={(e: KeyboardEvent<HTMLDivElement>) => {
          const step = e.shiftKey ? 1 : 0.1
          if (e.key === 'ArrowLeft') { e.preventDefault(); setCurrentTime(Math.max(0, currentTime - step)) }
          if (e.key === 'ArrowRight') { e.preventDefault(); setCurrentTime(currentTime + step) }
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      >
        <div
          className="w-0 h-0"
          style={{
            borderLeft: '6px solid transparent',
            borderRight: '6px solid transparent',
            borderTop: '8px solid rgb(34, 211, 238)',
          }}
        />
      </div>
      {/* Vertical line */}
      <div className="w-px h-full bg-cyan-400/80" />
    </div>
  )
}
