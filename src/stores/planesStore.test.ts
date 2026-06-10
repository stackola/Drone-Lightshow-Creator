import { describe, it, expect, beforeEach } from 'vitest'
import { usePlanesStore, getPlanesMutationVersion, clampCurvatureAmount } from './planesStore'
import { useGraphStore } from './graphStore'
import type { FormationNodeData } from '../graph/types'

function fData(over: Partial<FormationNodeData> = {}): FormationNodeData {
  return {
    formationId: null,
    startTime: 0,
    duration: 5,
    transform: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
    keyframes: [],
    colorProgramId: null,
    idleConfigs: [],
    ...over,
  }
}

beforeEach(() => {
  usePlanesStore.getState().loadPlanes([], null)
  useGraphStore.getState().loadGraph({ nodes: [], edges: [] })
})

describe('planesStore', () => {
  it('starts empty', () => {
    expect(usePlanesStore.getState().planes).toHaveLength(0)
    expect(usePlanesStore.getState().activePlaneId).toBeNull()
  })

  it('addPlane appends, returns id, and makes it active', () => {
    const id = usePlanesStore.getState().addPlane({ name: 'A' })
    const s = usePlanesStore.getState()
    expect(s.planes).toHaveLength(1)
    expect(s.activePlaneId).toBe(id)
    expect(s.getActivePlane()?.name).toBe('A')
  })

  it('updatePlane patches fields but ignores id', () => {
    const id = usePlanesStore.getState().addPlane()
    usePlanesStore.getState().updatePlane(id, { name: 'Renamed', size: 30, id: 'hacked' } as never)
    const plane = usePlanesStore.getState().getPlane(id)
    expect(plane?.name).toBe('Renamed')
    expect(plane?.size).toBe(30)
    expect(plane?.id).toBe(id)
    expect(usePlanesStore.getState().getPlane('hacked')).toBeUndefined()
  })

  it('clamps curvature amount to keep the surface invertible', () => {
    const id = usePlanesStore.getState().addPlane({ size: 20 })
    usePlanesStore.getState().updatePlane(id, { curvature: { type: 'cylinder', amount: 99, axis: 'x' } })
    const amount = usePlanesStore.getState().getPlane(id)!.curvature.amount
    const maxK = (Math.PI * 0.9) / 10
    expect(amount).toBeLessThanOrEqual(maxK + 1e-9)
    expect(amount).toBeGreaterThan(0)
  })

  it('reconciles bound formation positions when the plane moves', () => {
    const planeId = usePlanesStore.getState().addPlane({
      rotationDeg: { x: 0, y: 0, z: 0 }, // local XY = world XY, normal +z
      position: { x: 0, y: 0, z: 0 },
    })
    const nodeId = useGraphStore
      .getState()
      .addNode('formation', { x: 0, y: 0 }, fData({ planeBinding: { planeId, u: 2, v: 3 } }))
    // Move the plane +5 in x → bound formation slides with it.
    usePlanesStore.getState().updatePlane(planeId, { position: { x: 5, y: 0, z: 0 } })
    const node = useGraphStore.getState().getNode(nodeId)!
    const pos = (node.data as FormationNodeData).transform.position
    expect(pos.x).toBeCloseTo(7) // 5 + u
    expect(pos.y).toBeCloseTo(3) // v
  })

  it('removePlane drops it and reassigns active', () => {
    const a = usePlanesStore.getState().addPlane({ name: 'A' })
    const b = usePlanesStore.getState().addPlane({ name: 'B' })
    usePlanesStore.getState().setActivePlane(b)
    usePlanesStore.getState().removePlane(b)
    const s = usePlanesStore.getState()
    expect(s.planes).toHaveLength(1)
    expect(s.activePlaneId).toBe(a)
  })

  it('setActivePlaneByKind reuses an existing plane of that orientation', () => {
    const first = usePlanesStore.getState().setActivePlaneByKind('ground-xz')
    const second = usePlanesStore.getState().setActivePlaneByKind('ground-xz')
    expect(first).toBe(second)
    expect(usePlanesStore.getState().planes).toHaveLength(1)
  })

  it('setActivePlaneByKind creates distinct planes per orientation', () => {
    usePlanesStore.getState().setActivePlaneByKind('ground-xz')
    usePlanesStore.getState().setActivePlaneByKind('vertical-xy')
    expect(usePlanesStore.getState().planes).toHaveLength(2)
  })

  it('loadPlanes fills defaults for missing optional fields', () => {
    usePlanesStore.getState().loadPlanes(
      [{ id: 'p', name: 'X', position: { x: 0, y: 0, z: 0 }, rotationDeg: { x: 0, y: 0, z: 0 }, size: 20, cellSize: 1 } as never],
      'p',
    )
    const p = usePlanesStore.getState().getPlane('p')!
    expect(p.curvature.type).toBe('flat')
    expect(p.locked).toBe(false)
    expect(p.visible).toBe(true)
  })

  it('bumps the mutation version on edits', () => {
    const before = getPlanesMutationVersion()
    usePlanesStore.getState().addPlane()
    expect(getPlanesMutationVersion()).toBeGreaterThan(before)
  })
})

describe('clampCurvatureAmount', () => {
  it('leaves wave amplitude unclamped', () => {
    expect(clampCurvatureAmount(50, 'wave', 20)).toBe(50)
  })
  it('clamps cylinder by half-extent', () => {
    expect(clampCurvatureAmount(10, 'cylinder', 20)).toBeLessThan(10)
  })
})
