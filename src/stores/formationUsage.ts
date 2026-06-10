// ============================================================================
// formationUsage — the components/instances ownership semantics layer.
// A formation def is a MASTER; every graph node referencing it by
// formationId is an INSTANCE. The data model always worked this way — these
// helpers make it visible (usage counts) and escapable (copy-on-write
// detach), so editing a shared master is a choice instead of an accident.
// ============================================================================

import { useGraphStore } from './graphStore'
import { useFormationStore } from './formationStore'
import { useHistoryStore } from './historyStore'
import type { FormationNodeData } from '../graph/types'

/** Node ids of every formation node placing this def. */
export function formationUsage(formationDefId: string): string[] {
  return useGraphStore
    .getState()
    .nodes.filter(
      (n) => n.type === 'formation' && (n.data as FormationNodeData).formationId === formationDefId,
    )
    .map((n) => n.id)
}

/**
 * Copy-on-write detach: clone the def this node references and repoint the
 * node at the clone, so subsequent point/parameter edits only affect this
 * placement. Returns the new def id, or null if the node has no def.
 * Snapshots history with a semantic label.
 */
export function detachFormationDef(nodeId: string): string | null {
  const graph = useGraphStore.getState()
  const node = graph.getNode(nodeId)
  if (!node || node.type !== 'formation') return null
  const defId = (node.data as FormationNodeData).formationId
  if (!defId) return null

  const fStore = useFormationStore.getState()
  const def = fStore.getFormation(defId)
  if (!def) return null

  useHistoryStore.getState().snapshot(`Detach ${def.name}`)

  let newId: string
  if (def.type === 'animated') {
    const animDef = fStore.getAnimatedDef(defId)
    if (!animDef) return null
    newId = fStore.addAnimatedFormation(`${def.name} (detached)`, JSON.parse(JSON.stringify(animDef)), [...def.tags])
  } else {
    newId = fStore.addFormation(`${def.name} (detached)`, def.generatorId, { ...def.parameters })
    // Static defs may carry hand-edited points (point editor writes to the
    // cache, not the generator params) — carry the exact cloud over.
    const points = fStore.getPoints(defId)
    if (points) {
      useFormationStore.setState((s) => {
        s.generatedPoints.set(newId, points.map((p) => ({ ...p })))
        const f = s.formations.find((f) => f.id === newId)
        if (f) f.pointCount = points.length
      })
    }
  }

  graph.updateNodeData(nodeId, { formationId: newId } as Partial<FormationNodeData>)
  return newId
}
