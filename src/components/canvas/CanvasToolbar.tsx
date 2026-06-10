// ============================================================================
// Slice 2 Step 6: Floating toolbar in the top-right of the canvas.
// Currently holds Auto-layout; future toolbar entries can join here.
// ============================================================================

import { useReactFlow } from '@xyflow/react'
import { LayoutGrid, Maximize2 } from 'lucide-react'
import { useGraphStore } from '../../stores/graphStore'
import { useViewStore } from '../../stores/viewStore'
import { useHistoryStore } from '../../stores/historyStore'
import { autoLayout } from './autoLayout'
import { Tooltip } from '../Tooltip'
import { toast } from '../Toast'

export function CanvasToolbar() {
  const { fitView } = useReactFlow()
  const pxPerSecond = useViewStore((s) => s.pxPerSecond)
  const setNodePositionsBatch = useGraphStore((s) => s.setNodePositionsBatch)
  const snapshot = useHistoryStore((s) => s.snapshot)

  const onAutoLayout = () => {
    const { nodes, edges } = useGraphStore.getState()
    const positions = autoLayout({ nodes, edges }, pxPerSecond)
    if (positions.length === 0) return

    // A-15 — capture the previous positions so we can offer one-click Undo
    // from the action toast. This is effectively "preview-before-apply" with
    // optimistic execution: we apply immediately (visual continuity), but the
    // user sees what changed and can revert in one click.
    const previous = nodes.map((n) => ({ id: n.id, position: { x: n.position.x, y: n.position.y } }))
    snapshot('Auto-layout')
    setNodePositionsBatch(positions)
    setTimeout(() => fitView({ duration: 400, padding: 0.15 }), 30)

    toast.info(`Auto-layout: ${positions.length} node${positions.length === 1 ? '' : 's'} repositioned.`, {
      duration: 5000,
      action: {
        label: 'Undo',
        onClick: () => {
          setNodePositionsBatch(previous)
          setTimeout(() => fitView({ duration: 300, padding: 0.15 }), 30)
        },
      },
    })
  }

  return (
    <div className="absolute top-2 right-2 z-20 flex gap-1 bg-surface-hover/90 border border-white/10 rounded-md p-1 backdrop-blur-sm shadow-lg">
      <Tooltip label="Arrange nodes by time, lane by overlap" side="bottom">
        <button
          type="button"
          onClick={onAutoLayout}
          className="px-2 py-1 rounded text-xs text-white/80 hover:bg-white/10 flex items-center gap-1"
          aria-label="Auto-layout graph"
        >
          <LayoutGrid size={12} />
          Auto-layout
        </button>
      </Tooltip>
      <Tooltip label="Fit graph to view" shortcut="F" side="bottom">
        <button
          type="button"
          onClick={() => fitView({ duration: 300, padding: 0.15 })}
          className="px-2 py-1 rounded text-xs text-white/80 hover:bg-white/10 flex items-center gap-1"
          aria-label="Fit graph to view"
        >
          <Maximize2 size={12} />
          Fit
        </button>
      </Tooltip>
    </div>
  )
}
