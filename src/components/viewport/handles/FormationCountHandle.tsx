// ============================================================================
// L2 adoption: CountHandle for the selected formation's drone count.
// Resolves the selected formation node → its underlying formation → its
// generator parameters → `count`. Nudges fire updateFormation + regenerate.
// ============================================================================

import { useSelectionStore } from '../../../stores/selectionStore'
import { useGraphStore } from '../../../stores/graphStore'
import { useFormationStore } from '../../../stores/formationStore'
import { useProjectStore } from '../../../stores/projectStore'
import { useHistoryStore } from '../../../stores/historyStore'
import type { FormationNodeData } from '../../../graph/types'
import { CountHandle } from './CountHandle'

export function FormationCountHandle() {
  const selectedNodeIds = useSelectionStore((s) => s.selectedNodeIds)
  const nodes = useGraphStore((s) => s.nodes)
  const formations = useFormationStore((s) => s.formations)
  const updateFormation = useFormationStore((s) => s.updateFormation)
  const regeneratePoints = useFormationStore((s) => s.regeneratePoints)
  const droneCount = useProjectStore((s) => s.dronePool.droneCount)
  const snapshot = useHistoryStore((s) => s.snapshot)

  if (!selectedNodeIds || selectedNodeIds.length !== 1) return null
  if (!nodes) return null
  const node = nodes.find((n) => n.id === selectedNodeIds[0])
  if (!node || node.type !== 'formation') return null
  const data = node.data as FormationNodeData
  if (!data || !data.formationId) return null
  if (data.locked) return null
  const formation = formations.find((f) => f.id === data.formationId)
  // Only show for generator-based formations that expose a `count` parameter.
  if (!formation || formation.type !== 'static') return null
  const count = formation.parameters?.['count']
  if (typeof count !== 'number') return null

  const handleChange = (next: number): void => {
    updateFormation(formation.id, {
      parameters: { ...formation.parameters, count: next },
    })
    regeneratePoints(formation.id)
  }

  return (
    <CountHandle
      anchor={data.transform.position}
      count={count}
      min={1}
      max={droneCount}
      onChange={handleChange}
      onCommit={() => snapshot(`Set ${formation.name} count`)}
    />
  )
}
