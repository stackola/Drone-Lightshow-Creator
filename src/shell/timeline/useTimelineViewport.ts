// ============================================================================
// useTimelineViewport — zoom/pan state for the shell TimelineDock.
// Wraps viewStore.pxPerSecond (shared with the graph canvas, so zooming the
// dock keeps both surfaces in sync) and owns the horizontal scroll container.
// Ctrl+wheel zooms around the cursor (the time under the pointer stays put);
// plain wheel falls through to native horizontal/vertical scrolling.
// ============================================================================

import { useEffect, useRef } from 'react'
import { useViewStore } from '../../stores/viewStore'

export const MIN_PX_PER_SECOND = 20
export const MAX_PX_PER_SECOND = 400

export interface TimelineViewport {
  pxPerSecond: number
  /** Attach to the horizontally scrollable lane container. */
  scrollRef: React.MutableRefObject<HTMLDivElement | null>
}

export function useTimelineViewport(): TimelineViewport {
  const pxPerSecond = useViewStore((s) => s.pxPerSecond)
  const setPxPerSecond = useViewStore((s) => s.setPxPerSecond)
  const scrollRef = useRef<HTMLDivElement | null>(null)

  // Native (non-passive) wheel listener — React's onWheel is passive at the
  // root, so preventDefault (needed to stop browser page-zoom on ctrl+wheel)
  // must be registered manually.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return // plain wheel = native scroll
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      const cursorX = e.clientX - rect.left
      const pps = useViewStore.getState().pxPerSecond
      const timeAtCursor = (el.scrollLeft + cursorX) / pps
      const next = Math.min(
        MAX_PX_PER_SECOND,
        Math.max(MIN_PX_PER_SECOND, pps * Math.exp(-e.deltaY * 0.002)),
      )
      if (next === pps) return
      setPxPerSecond(next)
      // Re-anchor after React applies the new width so the time under the
      // cursor doesn't move.
      requestAnimationFrame(() => {
        el.scrollLeft = Math.max(0, timeAtCursor * next - cursorX)
      })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [setPxPerSecond])

  return { pxPerSecond, scrollRef }
}
