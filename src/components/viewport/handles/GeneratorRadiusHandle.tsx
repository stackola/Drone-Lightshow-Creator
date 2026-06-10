// ============================================================================
// L2 adoption: RadiusHandle for the selected formation's generator radius.
// Surfaces only for generator-based formations whose parameter set includes
// `radius` (ring / sphere / spiral / heart / arc / star). Drag updates the
// generator's `radius` parameter and triggers regenerate.
// ============================================================================

import { useSelectionStore } from '../../../stores/selectionStore'
import { useGraphStore } from '../../../stores/graphStore'
import { useFormationStore } from '../../../stores/formationStore'
import { useHistoryStore } from '../../../stores/historyStore'
import type { FormationNodeData } from '../../../graph/types'
import { RadiusHandle } from './RadiusHandle'

export function GeneratorRadiusHandle() {
  const selectedNodeIds = useSelectionStore((s) => s.selectedNodeIds)
  const nodes = useGraphStore((s) => s.nodes)
  const formations = useFormationStore((s) => s.formations)
  const updateFormation = useFormationStore((s) => s.updateFormation)
  const regeneratePoints = useFormationStore((s) => s.regeneratePoints)
  const snapshot = useHistoryStore((s) => s.snapshot)

  if (!selectedNodeIds || selectedNodeIds.length !== 1) return null
  if (!nodes) return null
  const node = nodes.find((n) => n.id === selectedNodeIds[0])
  if (!node || node.type !== 'formation') return null
  const data = node.data as FormationNodeData
  if (!data || !data.formationId) return null
  if (data.locked) return null
  const formation = formations.find((f) => f.id === data.formationId)
  if (!formation || formation.type !== 'static') return null
  const radius = formation.parameters?.['radius']
  if (typeof radius !== 'number') return null

  const handleChange = (next: number): void => {
    updateFormation(formation.id, {
      parameters: { ...formation.parameters, radius: next },
    })
    regeneratePoints(formation.id)
  }

  return (
    <RadiusHandle
      center={data.transform.position}
      // X-axis convention (matches how other gizmos pick their drag axis).
      axis={{ x: 1, y: 0, z: 0 }}
      radius={radius}
      onChange={handleChange}
      onCommit={() => snapshot(`Set ${formation.name} radius`)}
      min={0.1}
      color="#3b82f6"
    />
  )
}
