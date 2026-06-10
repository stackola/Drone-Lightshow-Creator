// ============================================================================
// L2 adoption: wraps RadiusHandle so it appears in the viewport when an idle
// node is selected, exposing `data.radius` as a direct-manipulation handle.
// Plan §L2 / §J — the first real "drag instead of type a number" surface.
// ============================================================================

import { useSelectionStore } from '../../../stores/selectionStore'
import { useGraphStore } from '../../../stores/graphStore'
import { useHistoryStore } from '../../../stores/historyStore'
import type { IdleNodeData } from '../../../graph/types'
import { RadiusHandle } from './RadiusHandle'

export function IdleRadiusHandle() {
  const selectedNodeIds = useSelectionStore((s) => s.selectedNodeIds)
  const nodes = useGraphStore((s) => s.nodes)
  const updateNodeData = useGraphStore((s) => s.updateNodeData)
  const snapshot = useHistoryStore((s) => s.snapshot)

  // Only render for a single-selected idle node. Defensive against early-mount
  // state hydration races (selectedNodeIds is initialised to [] by the store,
  // but during HMR or test environments it can momentarily be undefined).
  if (!selectedNodeIds || selectedNodeIds.length !== 1) return null
  if (!nodes) return null
  const node = nodes.find((n) => n.id === selectedNodeIds[0])
  if (!node || node.type !== 'idle') return null
  const data = node.data as IdleNodeData
  if (!data || !data.center) return null
  // O-04: hide handle for locked idle nodes — edits would be silently kept out
  // by the inspector gate but the visible handle implies it's editable.
  if (data.locked) return null

  return (
    <RadiusHandle
      center={data.center}
      // X-axis ring radius — the convention orbit/spin/breathe use for their
      // base ring. Visual rotational symmetry around Y means dragging along
      // any horizontal axis reads as "change radius".
      axis={{ x: 1, y: 0, z: 0 }}
      radius={data.radius}
      onChange={(r) => updateNodeData(node.id, { radius: r } as Partial<IdleNodeData>)}
      onCommit={() => snapshot('Set Idle Radius')}
      min={0}
    />
  )
}
