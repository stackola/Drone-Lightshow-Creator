// ============================================================================
// Slice 2 Step 6: Empty-state hint shown when the graph has 0 nodes.
// ============================================================================

import { Rocket } from 'lucide-react'
import { useGraphStore } from '../../stores/graphStore'
import { useHistoryStore } from '../../stores/historyStore'
import type { LaunchNodeData } from '../../graph/types'

export function EmptyState() {
  const addNode = useGraphStore((s) => s.addNode)
  const snapshot = useHistoryStore((s) => s.snapshot)

  const onAddLaunch = () => {
    snapshot('Add Launch')
    addNode('launch', { x: 100, y: 200 }, {
      droneCount: 50,
      startTime: 0,
      staggerDelay: 0.02,
    } as LaunchNodeData)
  }

  return (
    <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
      <div className="pointer-events-auto bg-surface-hover/80 border border-white/10 rounded-lg p-6 text-center shadow-xl backdrop-blur-sm max-w-md">
        <Rocket size={32} className="mx-auto mb-3 text-emerald-400/80" aria-hidden="true" />
        <h2 className="text-base font-semibold text-white/90">Start your show</h2>
        <p className="mt-1 text-xs text-white/50">
          A show begins with a Launch node. Drag formations from the sidebar onto the canvas to add them, then wire nodes together — transitions appear automatically on each connection.
        </p>
        <button
          type="button"
          onClick={onAddLaunch}
          className="mt-4 px-4 py-1.5 rounded-md text-xs font-medium bg-emerald-600 text-white hover:bg-emerald-500 transition-colors"
        >
          Add a Launch node
        </button>
      </div>
    </div>
  )
}
