// ============================================================================
// Clip — one timed node rendered as a draggable/resizable bar in a
// TimelineDock track row. Interaction parity with the legacy RulerBar:
// drag = startTime (beat-snapped, Alt = ripple downstream), right-edge
// resize = duration (shared useDurationResize hook, identical to canvas),
// click = select. Derived nodes (land) are click-select only.
// ============================================================================

import { useCallback, useRef } from 'react'
import { useGraphStore } from '../../stores/graphStore'
import { useViewStore } from '../../stores/viewStore'
import { useHistoryStore } from '../../stores/historyStore'
import { useAudioStore } from '../../stores/audioStore'
import { useSelectionStore } from '../../stores/selectionStore'
import { useFormationStore } from '../../stores/formationStore'
import { useDurationResize } from '../../components/canvas/useDurationResize'
import { getIdleBehavior } from '../../registries/idleBehaviors'
import { RegistryItemPreview } from '../../components/RegistryItemPreview'
import { NODE_TYPE_COLORS } from '../../ui/colors'
import type { ShowNode } from '../../graph/types'

export interface ClipProps {
  node: ShowNode
  start: number
  duration: number
  pxPerSecond: number
  selected: boolean
  /** Row-local vertical placement. */
  top: number
  height: number
}

export function Clip({ node, start, duration, pxPerSecond, selected, top, height }: ClipProps) {
  const updateNodeData = useGraphStore((s) => s.updateNodeData)
  const pushDownstreamTiming = useGraphStore((s) => s.pushDownstreamTiming)
  const snapshot = useHistoryStore((s) => s.snapshot)
  const snapToNearestBeat = useAudioStore((s) => s.snapToNearestBeat)
  const beatSnap = useViewStore((s) => s.beatSnap)
  const setSelection = useSelectionStore((s) => s.setSelection)
  const formations = useFormationStore((s) => s.formations)

  const dragStartX = useRef(0)
  const dragStartTime = useRef(0)
  const lastApplied = useRef(0)
  const rippleRef = useRef(false)
  const draggedRef = useRef(false)
  const snapshotTaken = useRef(false)

  // launch/formation/idle own their startTime; land is derived from upstream.
  const isAuthored = node.type === 'launch' || node.type === 'formation' || node.type === 'idle'
  const canResize = node.type === 'formation' || node.type === 'idle'
  const resize = useDurationResize(node.id, duration)

  // Human-readable label (formation/idle display names) + optional thumbnail.
  let displayLabel: string = node.type
  let thumb: { generatorId: string; params: Record<string, number> } | null = null
  if (node.type === 'formation') {
    const fd = node.data as { formationId: string | null }
    const f = fd.formationId ? formations.find((x) => x.id === fd.formationId) : null
    if (f) {
      displayLabel = f.name
      if (f.type === 'static' && f.generatorId !== 'animated') {
        thumb = { generatorId: f.generatorId, params: f.parameters }
      }
    }
  } else if (node.type === 'idle') {
    const id = node.data as { behavior: string }
    displayLabel = getIdleBehavior(id.behavior)?.name ?? id.behavior
  }

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    e.stopPropagation()
    dragStartX.current = e.clientX
    dragStartTime.current = start
    lastApplied.current = start
    rippleRef.current = e.altKey
    draggedRef.current = false
    snapshotTaken.current = false
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  }, [start])

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!isAuthored) return
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
    const deltaSec = (e.clientX - dragStartX.current) / pxPerSecond
    if (Math.abs(deltaSec) > 0.05) draggedRef.current = true
    if (!draggedRef.current) return
    if (!snapshotTaken.current) {
      snapshot('Move clip')
      snapshotTaken.current = true
    }
    let next = Math.max(0, dragStartTime.current + deltaSec)
    if (beatSnap) next = snapToNearestBeat(next)
    next = Math.round(next * 10) / 10
    if (next === lastApplied.current) return
    updateNodeData(node.id, { startTime: next })
    if (rippleRef.current) {
      pushDownstreamTiming(node.id, next - lastApplied.current)
    }
    lastApplied.current = next
  }, [isAuthored, node.id, pxPerSecond, beatSnap, snapToNearestBeat, snapshot, updateNodeData, pushDownstreamTiming])

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    (e.target as HTMLElement).releasePointerCapture(e.pointerId)
    if (!draggedRef.current) setSelection([node.id], [])
  }, [node.id, setSelection])

  const color = NODE_TYPE_COLORS[node.type] ?? NODE_TYPE_COLORS.group!
  const left = start * pxPerSecond
  const width = Math.max(8, duration * pxPerSecond)

  return (
    <div
      role="button"
      aria-label={`${node.type} ${displayLabel}`}
      data-testid={`timeline-clip-${node.id}`}
      data-selected={selected || undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      style={{
        left,
        width,
        top,
        height,
        background: `${color}38`,
        borderColor: `${color}70`,
        borderLeft: `3px solid ${color}`,
      }}
      className={`absolute rounded border text-micro text-white/90 px-1.5 overflow-hidden whitespace-nowrap select-none transition-[filter] ${
        selected ? 'ring-2 ring-accent-primary brightness-125' : 'hover:brightness-110'
      } ${node.type === 'land' ? 'border-dashed' : ''} ${
        isAuthored ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'
      }`}
      title={`${displayLabel} — ${start.toFixed(1)}s … ${(start + duration).toFixed(1)}s${
        isAuthored ? ' · drag to move, Alt = ripple downstream' : ''
      }`}
    >
      <span className="pointer-events-none inline-flex h-full items-center gap-1 max-w-full truncate">
        {thumb && width > 44 && (
          <RegistryItemPreview kind="generator" id={thumb.generatorId} params={thumb.params} size={12} framed={false} />
        )}
        <span className="truncate">{displayLabel}</span>
      </span>
      {canResize && (
        <div
          className="absolute top-0 right-0 w-1.5 h-full cursor-ew-resize bg-white/0 hover:bg-white/30 rounded-r"
          role="separator"
          aria-label="Resize duration"
          onPointerDown={resize.onPointerDown}
          onPointerMove={resize.onPointerMove}
          onPointerUp={resize.onPointerUp}
        />
      )}
    </div>
  )
}
