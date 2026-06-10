// L2 adoption: DirectionHandle for the selected idle node's drift direction.
// Only shows up for behaviours that actually consume `params.direction`
// (currently just `drift`). Snapshot fires on commit as "Set Drift Direction".

import { useSelectionStore } from '../../../stores/selectionStore'
import { useGraphStore } from '../../../stores/graphStore'
import { useHistoryStore } from '../../../stores/historyStore'
import type { IdleNodeData } from '../../../graph/types'
import { DirectionHandle } from './DirectionHandle'

const DIRECTION_BEHAVIOURS = new Set(['drift'])

export function IdleDirectionHandle() {
  const selectedNodeIds = useSelectionStore((s) => s.selectedNodeIds)
  const nodes = useGraphStore((s) => s.nodes)
  const updateNodeData = useGraphStore((s) => s.updateNodeData)
  const snapshot = useHistoryStore((s) => s.snapshot)

  if (!selectedNodeIds || selectedNodeIds.length !== 1) return null
  if (!nodes) return null
  const node = nodes.find((n) => n.id === selectedNodeIds[0])
  if (!node || node.type !== 'idle') return null
  const data = node.data as IdleNodeData
  if (!data || !data.center || !DIRECTION_BEHAVIOURS.has(data.behavior)) return null
  if (data.locked) return null

  const direction = data.direction ?? { x: 0.94, y: 0, z: 0.31 }

  return (
    <DirectionHandle
      anchor={data.center}
      direction={direction}
      onChange={(next) => updateNodeData(node.id, { direction: next } as Partial<IdleNodeData>)}
      onCommit={() => snapshot('Set Drift Direction')}
      length={3}
    />
  )
}
