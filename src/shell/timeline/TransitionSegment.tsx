// ============================================================================
// TransitionSegment — a flow edge's transition rendered as a clickable
// fuchsia (accent-transition) segment in the gap between its source clip's
// end and target clip's start, inside the track row both clips share.
// Click routes the inspector to the edge via selectionStore.selectEdge.
// ============================================================================

import { useSelectionStore } from '../../stores/selectionStore'
import { getTransition } from '../../registries/transitions'
import type { ShowEdge } from '../../graph/types'

export interface TransitionSegmentProps {
  edge: ShowEdge
  /** Gap window in seconds (already resolved from edge/node timing). */
  gapStart: number
  gapEnd: number
  pxPerSecond: number
  selected: boolean
  /** Vertical center of the owning track row, in lane-content coordinates. */
  centerY: number
}

export function TransitionSegment({ edge, gapStart, gapEnd, pxPerSecond, selected, centerY }: TransitionSegmentProps) {
  const selectEdge = useSelectionStore((s) => s.selectEdge)
  if (!edge.transition) return null
  const stratName = getTransition(edge.transition.strategyId)?.name ?? edge.transition.strategyId
  const left = gapStart * pxPerSecond
  const width = Math.max(6, (gapEnd - gapStart) * pxPerSecond)
  const height = selected ? 8 : 6

  return (
    <div
      role="button"
      data-testid="transition-segment"
      aria-label={`transition ${stratName}`}
      title={`${stratName} · ${(gapEnd - gapStart).toFixed(1)}s · click to edit`}
      onClick={(e) => {
        e.stopPropagation()
        selectEdge(edge.id)
      }}
      onPointerDown={(e) => e.stopPropagation()}
      style={{ left, width, top: centerY - height / 2, height }}
      className={`absolute rounded-full cursor-pointer ${
        selected
          ? 'bg-accent-transition ring-2 ring-fuchsia-300'
          : 'bg-accent-transition/50 hover:bg-accent-transition/80'
      }`}
    >
      {width > 48 && (
        <span className="absolute -top-3.5 left-1 text-[8px] text-fuchsia-300/80 whitespace-nowrap pointer-events-none">
          {stratName}
        </span>
      )}
    </div>
  )
}
