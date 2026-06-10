import { describe, it, expect, beforeEach } from 'vitest'
import { useGraphStore } from './graphStore'
import { useFormationStore } from './formationStore'
import { formationUsage, detachFormationDef } from './formationUsage'
import type { FormationNodeData } from '../graph/types'

function resetStores() {
  useGraphStore.setState({ nodes: [], edges: [] })
  useFormationStore.setState({ formations: [], generatedPoints: new Map(), animatedDefs: new Map() })
}

function addFormationNode(formationId: string | null, startTime = 0): string {
  return useGraphStore.getState().addNode('formation', { x: startTime * 100, y: 0 }, {
    formationId, startTime, duration: 5,
    transform: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
    keyframes: [], colorProgramId: null, idleConfigs: [],
  } as FormationNodeData)
}

describe('formationUsage', () => {
  beforeEach(resetStores)

  it('counts the nodes placing a def', () => {
    const defId = useFormationStore.getState().addFormation('Ring', 'ring', { radius: 10 })
    const a = addFormationNode(defId, 0)
    const b = addFormationNode(defId, 10)
    addFormationNode(null, 20)
    expect(formationUsage(defId).sort()).toEqual([a, b].sort())
  })

  it('detach clones the def and repoints only the detached node', () => {
    const defId = useFormationStore.getState().addFormation('Ring', 'ring', { radius: 10 })
    const a = addFormationNode(defId, 0)
    const b = addFormationNode(defId, 10)

    const newId = detachFormationDef(a)
    expect(newId).toBeTruthy()
    expect(newId).not.toBe(defId)

    const aData = useGraphStore.getState().getNode(a)!.data as FormationNodeData
    const bData = useGraphStore.getState().getNode(b)!.data as FormationNodeData
    expect(aData.formationId).toBe(newId)
    expect(bData.formationId).toBe(defId)

    // The clone carries the exact point cloud.
    const orig = useFormationStore.getState().getPoints(defId)!
    const cloned = useFormationStore.getState().getPoints(newId!)!
    expect(cloned).toHaveLength(orig.length)
    expect(cloned[0]).toEqual(orig[0])
    expect(cloned[0]).not.toBe(orig[0]) // deep copy, not shared refs

    // Usage is now split.
    expect(formationUsage(defId)).toEqual([b])
    expect(formationUsage(newId!)).toEqual([a])
  })

  it('detach returns null for non-formation nodes and missing defs', () => {
    expect(detachFormationDef('nope')).toBeNull()
    const orphan = addFormationNode(null)
    expect(detachFormationDef(orphan)).toBeNull()
  })
})
