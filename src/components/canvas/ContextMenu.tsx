// ============================================================================
// Canvas Context Menu — Add timed nodes (launch / idle / land)
// ============================================================================
// Formations are added by dragging from the sidebar AssetPanel onto the canvas
// (single canonical path). Transitions are auto-inserted as edge metadata when
// the user connects two timed nodes.
// ============================================================================

import { useCallback } from 'react'
import { useGraphStore } from '../../stores/graphStore'
import { useHistoryStore } from '../../stores/historyStore'
import { canvasXToTime } from '../../stores/viewStore'
import { useViewStore } from '../../stores/viewStore'
import { defaultLaunchData, defaultIdleData, defaultLandData } from '../../graph/nodeDefaults'

interface ContextMenuProps {
  x: number
  y: number
  canvasX: number
  canvasY: number
  onClose: () => void
}

export function ContextMenu({ x, y, canvasX, canvasY, onClose }: ContextMenuProps) {
  const addNode = useGraphStore((s) => s.addNode)
  const snapshot = useHistoryStore((s) => s.snapshot)
  const pxPerSecond = useViewStore((s) => s.pxPerSecond)

  const handleAdd = useCallback(
    (type: string) => {
      snapshot(`Add ${type.charAt(0).toUpperCase()}${type.slice(1)}`)
      const startTime = Math.max(0, canvasXToTime(canvasX, pxPerSecond))
      const pos = { x: canvasX, y: canvasY }

      switch (type) {
        case 'launch':
          addNode('launch', pos, defaultLaunchData(startTime))
          break
        case 'idle':
          addNode('idle', pos, defaultIdleData(startTime))
          break
        case 'land':
          addNode('land', pos, defaultLandData())
          break
      }
      onClose()
    },
    [addNode, snapshot, canvasX, canvasY, pxPerSecond, onClose],
  )

  const items = [
    { label: 'Add Launch', type: 'launch', color: 'text-emerald-400' },
    { label: 'Add Idle', type: 'idle', color: 'text-amber-400' },
    { label: 'Add Land', type: 'land', color: 'text-red-400' },
  ]

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div
        className="animate-panel-in fixed z-50 bg-surface-hover border border-white/10 rounded-lg shadow-xl py-1 min-w-[160px]"
        style={{ left: Math.min(x, window.innerWidth - 200), top: Math.min(y, window.innerHeight - 250) }}
        role="menu"
        onKeyDown={(e) => { if (e.key === 'Escape') onClose() }}
      >
        <div className="px-3 py-1 text-micro uppercase tracking-wider text-white/30">
          Drag formations from the sidebar →
        </div>
        {items.map((item) => (
          <button
            key={item.type}
            className={`w-full px-3 py-1.5 text-left text-sm hover:bg-white/10 ${item.color} transition-colors`}
            onClick={() => handleAdd(item.type)}
          >
            {item.label}
          </button>
        ))}
      </div>
    </>
  )
}
