// ============================================================================
// Slice 2 Step 5: useDurationResize
// ============================================================================
// Shared pointer-drag hook for nodes with a right-edge resize handle (Formation,
// Idle). Extracted from the duplicated handlers in FormationNode/IdleNode so the
// timeline-ruler (Step 8) can use the same code path — ruler-drag and canvas-drag
// produce identical results.
// ============================================================================

import { useCallback, useRef } from 'react'
import { useViewStore } from '../../stores/viewStore'
import { useGraphStore } from '../../stores/graphStore'
import { useHistoryStore } from '../../stores/historyStore'

export interface DurationResizeHandlers {
  onPointerDown: (e: React.PointerEvent) => void
  onPointerMove: (e: React.PointerEvent) => void
  onPointerUp: (e: React.PointerEvent) => void
  onKeyDown: (e: React.KeyboardEvent) => void
}

export interface DurationResizeOptions {
  /** ReactFlow zoom level. Pass `() => getZoom()` from RF nodes; omit (defaults to 1) for the ruler. */
  getZoom?: () => number
  minDuration?: number
}

/**
 * Returns drag/keyboard handlers that update `data.duration` on the given node.
 * Used by FormationNode, IdleNode, and TimelineRulerPanel. Caller passes a zoom
 * getter when inside ReactFlow (so screen → graph pixels are correct); omit it
 * for the ruler (which renders at native screen pixels).
 */
export function useDurationResize(nodeId: string, currentDuration: number, opts: DurationResizeOptions = {}): DurationResizeHandlers {
  const minDuration = opts.minDuration ?? 0.5
  const pxPerSecond = useViewStore((s) => s.pxPerSecond)
  const updateNodeData = useGraphStore((s) => s.updateNodeData)
  const snapshot = useHistoryStore((s) => s.snapshot)
  const dragStartX = useRef(0)
  const dragStartDuration = useRef(0)

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    e.stopPropagation()
    e.preventDefault()
    snapshot('Resize Duration')
    dragStartX.current = e.clientX
    dragStartDuration.current = currentDuration
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  }, [currentDuration, snapshot])

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
    const zoom = opts.getZoom?.() ?? 1
    const deltaPx = e.clientX - dragStartX.current
    const deltaSec = deltaPx / (pxPerSecond * zoom)
    const next = Math.max(minDuration, dragStartDuration.current + deltaSec)
    updateNodeData(nodeId, { duration: Math.round(next * 10) / 10 })
  }, [nodeId, pxPerSecond, opts, updateNodeData, minDuration])

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    (e.target as HTMLElement).releasePointerCapture(e.pointerId)
  }, [])

  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 1 : 0.5
    if (e.key === 'ArrowRight') {
      e.preventDefault(); e.stopPropagation()
      updateNodeData(nodeId, { duration: Math.max(minDuration, currentDuration + step) })
    }
    if (e.key === 'ArrowLeft') {
      e.preventDefault(); e.stopPropagation()
      updateNodeData(nodeId, { duration: Math.max(minDuration, currentDuration - step) })
    }
  }, [nodeId, currentDuration, updateNodeData, minDuration])

  return { onPointerDown, onPointerMove, onPointerUp, onKeyDown }
}
