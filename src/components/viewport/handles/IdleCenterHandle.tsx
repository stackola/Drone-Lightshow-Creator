// L2 adoption: CenterHandle on the selected idle node's `data.center`.
// Lets the user drag the centre of the idle's motion in 3D rather than
// editing X/Y/Z fields in the inspector.

import { useSelectionStore } from '../../../stores/selectionStore'
import { useGraphStore } from '../../../stores/graphStore'
import { useHistoryStore } from '../../../stores/historyStore'
import type { IdleNodeData } from '../../../graph/types'
import { CenterHandle } from './CenterHandle'

export function IdleCenterHandle() {
  const selectedNodeIds = useSelectionStore((s) => s.selectedNodeIds)
  const nodes = useGraphStore((s) => s.nodes)
  const updateNodeData = useGraphStore((s) => s.updateNodeData)
  const snapshot = useHistoryStore((s) => s.snapshot)

  if (!selectedNodeIds || selectedNodeIds.length !== 1) return null
  if (!nodes) return null
  const node = nodes.find((n) => n.id === selectedNodeIds[0])
  if (!node || node.type !== 'idle') return null
  const data = node.data as IdleNodeData
  if (!data || !data.center) return null
  if (data.locked) return null

  return (
    <CenterHandle
      position={data.center}
      onChange={(next) => updateNodeData(node.id, { center: next } as Partial<IdleNodeData>)}
      onCommit={() => snapshot('Move Idle Center')}
    />
  )
}
