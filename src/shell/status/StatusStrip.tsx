// ============================================================================
// StatusStrip — the new shell's 24px bottom strip: gizmo tool, selection,
// counts, playhead, physics badge (Phase 3 wires the live count + drawer),
// save state, FPS. Ported from the legacy StatusBar with a physics slot.
// ============================================================================

import { useState, useEffect, useRef, type ReactNode } from 'react'
import { CircleDot, Check } from 'lucide-react'
import { useSelectionStore } from '../../stores/selectionStore'
import { useViewStore } from '../../stores/viewStore'
import { usePlayheadStore } from '../../stores/playheadStore'
import { useGraphStore } from '../../stores/graphStore'
import { useProjectStore } from '../../stores/projectStore'

export interface StatusStripProps {
  hasUnsavedChanges: boolean
  /** Right-aligned slot for the physics badge / drawer toggle (Phase 3). */
  physicsSlot?: ReactNode
}

export function StatusStrip({ hasUnsavedChanges, physicsSlot }: StatusStripProps) {
  const selectedNodeIds = useSelectionStore((s) => s.selectedNodeIds)
  const selectedEdgeIds = useSelectionStore((s) => s.selectedEdgeIds)
  const gizmoMode = useViewStore((s) => s.gizmoMode)
  const currentTime = usePlayheadStore((s) => s.currentTime)
  const isPlaying = usePlayheadStore((s) => s.isPlaying)
  const nodeCount = useGraphStore((s) => s.nodes.length)
  const droneCount = useProjectStore((s) => s.dronePool.droneCount)

  const [fps, setFps] = useState(60)
  const frameCount = useRef(0)
  const lastTime = useRef(performance.now())

  useEffect(() => {
    let raf: number
    const measure = () => {
      frameCount.current++
      const now = performance.now()
      if (now - lastTime.current >= 1000) {
        setFps(Math.round((frameCount.current * 1000) / (now - lastTime.current)))
        frameCount.current = 0
        lastTime.current = now
      }
      raf = requestAnimationFrame(measure)
    }
    raf = requestAnimationFrame(measure)
    return () => cancelAnimationFrame(raf)
  }, [])

  const selectionText =
    selectedNodeIds.length > 0 || selectedEdgeIds.length > 0
      ? `${selectedNodeIds.length} node${selectedNodeIds.length !== 1 ? 's' : ''}, ${selectedEdgeIds.length} edge${selectedEdgeIds.length !== 1 ? 's' : ''}`
      : 'No selection'

  return (
    <div className="h-6 bg-surface-raised/80 border-t border-white/10 flex items-center px-3 gap-4 text-micro text-white/40 flex-shrink-0">
      <span className="text-white/60">{gizmoMode.charAt(0).toUpperCase() + gizmoMode.slice(1)}</span>
      <span>{selectionText}</span>
      <span>{nodeCount} nodes</span>
      <span>{droneCount} drones</span>
      <span>
        {currentTime.toFixed(1)}s {isPlaying ? '▶' : '⏸'}
      </span>
      <div className="flex-1" />
      {physicsSlot}
      <span className={`inline-flex items-center gap-1 ${hasUnsavedChanges ? 'text-orange-400' : 'text-green-400/60'}`}>
        {hasUnsavedChanges ? <CircleDot size={10} aria-hidden="true" /> : <Check size={10} aria-hidden="true" />}
        {hasUnsavedChanges ? 'Unsaved' : 'Saved'}
      </span>
      <span className={fps < 30 ? 'text-red-400' : 'text-white/30'}>{fps} FPS</span>
    </div>
  )
}
