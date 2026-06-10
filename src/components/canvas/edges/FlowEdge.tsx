// ============================================================================
// Flow Edge — drone allocation + transition (strategy + duration)
// ============================================================================
// A flow edge between two timed nodes carries a TransitionConfig in its data.
// The edge renders that as a midpoint pill ("morph · 2.0s"). Selecting the
// edge opens the FlowEdgeInspector where strategy + duration can be edited.
// ============================================================================

import { memo, useState, useCallback, useRef, useEffect, useMemo } from 'react'
import {
  BaseEdge,
  getBezierPath,
  type EdgeProps,
  EdgeLabelRenderer,
} from '@xyflow/react'
import { useGraphStore } from '../../../stores/graphStore'
import type { AllocationMode, TransitionConfig } from '../../../graph/types'
import { getTransition } from '../../../registries/transitions'
import { ACCENT_PRIMARY } from '../../../ui/colors'

interface FlowEdgeData {
  allocation?: AllocationMode
  transition?: TransitionConfig
  [key: string]: unknown
}

function FlowEdgeInner({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  label,
  selected,
}: EdgeProps) {
  const [isEditingCount, setIsEditingCount] = useState(false)
  const [editValue, setEditValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const updateEdgeAllocation = useGraphStore((s) => s.updateEdgeAllocation)
  const edgeTiming = useGraphStore((s) => s.getCachedEdgeTiming())

  const edgeData = (data ?? {}) as FlowEdgeData
  const allocation = edgeData.allocation ?? { mode: 'auto' as const }
  const transition = edgeData.transition
  const droneCount = typeof label === 'string' ? parseInt(label, 10) : 0

  // Adaptive routing curvature.
  const yDelta = targetY - sourceY
  const absY = Math.abs(yDelta)
  let curvature = 0.25
  if (absY < 8) curvature = 0.05
  else if (absY > 30) curvature = 0.5

  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    curvature,
  })

  const strokeWidth = Math.max(1.5, Math.min(6, 1.5 + droneCount / 15))

  // Allocation badge color
  let allocBadgeBg = '#334155'
  let allocBadgeBorder = '#475569'
  if (allocation.mode === 'manual-count') {
    allocBadgeBg = '#1e40af'
    allocBadgeBorder = '#3b82f6'
  } else if (allocation.mode === 'manual-percent') {
    allocBadgeBg = '#166534'
    allocBadgeBorder = '#22c55e'
  }

  const handleCountClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      setEditValue(String(droneCount))
      setIsEditingCount(true)
    },
    [droneCount],
  )

  const handleEditConfirm = useCallback(() => {
    const parsed = parseInt(editValue, 10)
    if (!isNaN(parsed) && parsed > 0) {
      updateEdgeAllocation(id, { mode: 'manual-count', count: parsed })
    }
    setIsEditingCount(false)
  }, [editValue, id, updateEdgeAllocation])

  const handleEditCancel = useCallback(() => {
    setIsEditingCount(false)
  }, [])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') handleEditConfirm()
      if (e.key === 'Escape') handleEditCancel()
    },
    [handleEditConfirm, handleEditCancel],
  )

  useEffect(() => {
    if (isEditingCount && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [isEditingCount])

  // Transition pill content
  const strategyName = transition ? getTransition(transition.strategyId)?.name ?? transition.strategyId : null
  const eTime = edgeTiming.get(id)
  const transitionDuration = eTime
    ? eTime.end - eTime.start
    : transition?.preferredDuration ?? 0

  // Edge IDs encode a timestamp (Date.now in base36); use it to detect newly-
  // created edges and play a brief fade-in on the transition pill. Wrong for
  // edges loaded from disk (id timestamp is in the past), which is fine —
  // they just skip the animation.
  const justCreated = useMemo(() => {
    const parts = id.split('-')
    const ts = parts.length >= 2 ? parseInt(parts[1]!, 36) : NaN
    if (isNaN(ts)) return false
    return Date.now() - ts < 400
  }, [id])

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        style={{
          stroke: selected ? ACCENT_PRIMARY : '#60a5fa',
          strokeWidth,
          strokeDasharray: '8 4',
        }}
      />
      {droneCount > 0 && (
        <circle
          r={3}
          fill={selected ? ACCENT_PRIMARY : '#a5b4fc'}
          style={{
            offsetPath: `path("${edgePath}")`,
            offsetRotate: '0deg',
            animation: 'flowEdgeParticle 2.4s linear infinite',
            filter: 'drop-shadow(0 0 4px rgba(96, 165, 250, 0.7))',
            pointerEvents: 'none',
          }}
        />
      )}
      <EdgeLabelRenderer>
        <div
          className="nodrag nopan absolute pointer-events-auto flex items-center gap-1.5"
          style={{
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
          }}
        >
          {/* Transition pill — strategy + duration */}
          {transition && strategyName && (
            <div
              className={`px-2 py-0.5 rounded-full text-micro font-medium whitespace-nowrap cursor-pointer transition-colors ${
                selected
                  ? 'bg-violet-500/30 border border-violet-300/70 text-violet-100'
                  : 'bg-violet-900/70 border border-violet-500/40 text-violet-200 hover:bg-violet-800/80'
              }${justCreated ? ' transition-pill-fade-in' : ''}`}
              title={`Transition · ${strategyName} · ${transitionDuration.toFixed(1)}s — click to edit`}
            >
              <span className="opacity-90">{strategyName}</span>
              <span className="opacity-60 ml-1">·</span>
              <span className="ml-1 tabular-nums">{transitionDuration.toFixed(1)}s</span>
            </div>
          )}

          {/* Drone count badge */}
          {droneCount > 0 && (
            isEditingCount ? (
              <input
                ref={inputRef}
                type="number"
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onKeyDown={handleKeyDown}
                onBlur={handleEditConfirm}
                onClick={(e) => e.stopPropagation()}
                className="w-14 h-5 text-center text-micro font-semibold bg-surface-hover text-white border border-cyan-400 rounded outline-none"
                min={1}
              />
            ) : (
              <div
                onClick={handleCountClick}
                className="px-2 py-0.5 rounded-full text-micro font-semibold text-white whitespace-nowrap cursor-pointer"
                style={{
                  backgroundColor: allocBadgeBg,
                  border: `1px solid ${allocBadgeBorder}`,
                }}
                title={
                  allocation.mode === 'manual-count'
                    ? `${droneCount} drones · manually set · click to edit`
                    : allocation.mode === 'manual-percent'
                      ? `${droneCount} drones · ${allocation.percent}% of upstream · click to edit`
                      : `${droneCount} drones · auto-allocated · click to override`
                }
              >
                {droneCount}
              </div>
            )
          )}
        </div>
      </EdgeLabelRenderer>
    </>
  )
}

export const FlowEdge = memo(FlowEdgeInner)
