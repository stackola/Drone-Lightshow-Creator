import { describe, it, expect } from 'vitest'
import {
  planeSurfaceToWorld,
  worldToPlaneSurface,
  snapToSurface,
  planeLocalToWorld,
  worldToPlaneLocal,
  reconcileBoundFormations,
  DEFAULT_CURVATURE,
  type BuildPlane,
  type PlaneCurvature,
} from './buildPlane'
import type { FormationNode } from './types'

function plane(over: Partial<BuildPlane> = {}): BuildPlane {
  return {
    id: 'p1',
    name: 'Plane',
    position: { x: 0, y: 0, z: 0 },
    rotationDeg: { x: 0, y: 0, z: 0 },
    size: 20,
    cellSize: 1,
    curvature: DEFAULT_CURVATURE,
    locked: false,
    visible: true,
    ...over,
  }
}

describe('buildPlane — rigid frame', () => {
  it('round-trips through local with identity plane', () => {
    const p = { x: 1.7, y: 2.3, z: -0.9 }
    const pl = plane()
    const round = planeLocalToWorld(worldToPlaneLocal(p, pl), pl)
    expect(round.x).toBeCloseTo(p.x)
    expect(round.y).toBeCloseTo(p.y)
    expect(round.z).toBeCloseTo(p.z)
  })

  it('round-trips through a translated + rotated plane', () => {
    const p = { x: -3, y: 4.5, z: 2 }
    const pl = plane({ position: { x: 5, y: 1, z: -2 }, rotationDeg: { x: 30, y: -45, z: 90 } })
    const round = planeLocalToWorld(worldToPlaneLocal(p, pl), pl)
    expect(round.x).toBeCloseTo(p.x)
    expect(round.y).toBeCloseTo(p.y)
    expect(round.z).toBeCloseTo(p.z)
  })
})

describe('buildPlane — flat surface', () => {
  it('surface (u,v) round-trips and matches local coords', () => {
    const pl = plane()
    const w = planeSurfaceToWorld({ u: 3.2, v: -1.1 }, pl)
    expect(w).toMatchObject({ x: 3.2, y: -1.1, z: 0 })
    const back = worldToPlaneSurface(w, pl)
    expect(back.u).toBeCloseTo(3.2)
    expect(back.v).toBeCloseTo(-1.1)
    expect(back.dist).toBeCloseTo(0)
  })

  it('snapToSurface quantises to grid and lands on surface', () => {
    const pl = plane({ cellSize: 1 })
    const snapped = snapToSurface({ x: 1.3, y: -0.4, z: 5 }, pl)
    expect(snapped.x).toBeCloseTo(1)
    expect(snapped.y).toBeCloseTo(0)
    expect(snapped.z).toBeCloseTo(0)
    expect(worldToPlaneSurface(snapped, pl).dist).toBeCloseTo(0)
  })
})

describe('buildPlane — cylinder', () => {
  const cyl = (amount: number, axis: 'x' | 'z' = 'x'): PlaneCurvature => ({ type: 'cylinder', amount, axis })

  it('degenerates to flat as amount → 0', () => {
    const pl = plane({ curvature: cyl(1e-9) })
    const w = planeSurfaceToWorld({ u: 5, v: 2 }, pl)
    expect(w.x).toBeCloseTo(5)
    expect(w.y).toBeCloseTo(2)
    expect(w.z).toBeCloseTo(0)
  })

  it('u=0 maps to the local origin and bulges in +z elsewhere', () => {
    const pl = plane({ curvature: cyl(0.1) })
    expect(planeSurfaceToWorld({ u: 0, v: 3 }, pl)).toMatchObject({ z: 0 })
    expect(planeSurfaceToWorld({ u: 5, v: 0 }, pl).z).toBeGreaterThan(0)
  })

  it('preserves arc length: a point at surface distance s sits at world arc s', () => {
    const k = 0.08
    const pl = plane({ curvature: cyl(k) })
    const s = 6
    const w = planeSurfaceToWorld({ u: s, v: 0 }, pl)
    const R = 1 / k
    const arc = Math.atan2(w.x, R - w.z) * R
    expect(arc).toBeCloseTo(s)
  })

  it('round-trips (u,v) across the strip', () => {
    const pl = plane({ curvature: cyl(0.07) })
    for (const u of [-8, -3, 0, 4, 9]) {
      const back = worldToPlaneSurface(planeSurfaceToWorld({ u, v: 2.5 }, pl), pl)
      expect(back.u).toBeCloseTo(u)
      expect(back.v).toBeCloseTo(2.5)
      expect(back.dist).toBeCloseTo(0)
    }
  })

  it('z-bulge flips sign with the sign of amount', () => {
    const pos = planeSurfaceToWorld({ u: 5, v: 0 }, plane({ curvature: cyl(0.1) }))
    const neg = planeSurfaceToWorld({ u: 5, v: 0 }, plane({ curvature: cyl(-0.1) }))
    expect(Math.sign(pos.z)).toBe(-Math.sign(neg.z))
  })

  it('honours the z axis (bends along v instead of u)', () => {
    const pl = plane({ curvature: cyl(0.1, 'z') })
    expect(planeSurfaceToWorld({ u: 5, v: 0 }, pl).z).toBeCloseTo(0)
    expect(planeSurfaceToWorld({ u: 0, v: 5 }, pl).z).toBeGreaterThan(0)
  })
})

describe('buildPlane — dome', () => {
  const dome = (amount: number): PlaneCurvature => ({ type: 'dome', amount, axis: 'x' })

  it('degenerates to flat as amount → 0', () => {
    const w = planeSurfaceToWorld({ u: 4, v: -3 }, plane({ curvature: dome(1e-9) }))
    expect(w.x).toBeCloseTo(4)
    expect(w.y).toBeCloseTo(-3)
    expect(w.z).toBeCloseTo(0)
  })

  it('is radially symmetric: equal radius ⇒ equal lift', () => {
    const pl = plane({ curvature: dome(0.06) })
    const a = planeSurfaceToWorld({ u: 5, v: 0 }, pl)
    const b = planeSurfaceToWorld({ u: 0, v: 5 }, pl)
    const c = planeSurfaceToWorld({ u: 3, v: 4 }, pl)
    expect(a.z).toBeCloseTo(b.z)
    expect(a.z).toBeCloseTo(c.z)
  })

  it('apex at (0,0) maps to local origin', () => {
    expect(planeSurfaceToWorld({ u: 0, v: 0 }, plane({ curvature: dome(0.1) }))).toMatchObject({ z: 0 })
  })

  it('round-trips (u,v) over a disc of samples', () => {
    const pl = plane({ curvature: dome(0.05) })
    for (const [u, v] of [[2, 0], [0, 3], [-4, 2], [5, -5]] as const) {
      const back = worldToPlaneSurface(planeSurfaceToWorld({ u, v }, pl), pl)
      expect(back.u).toBeCloseTo(u)
      expect(back.v).toBeCloseTo(v)
      expect(back.dist).toBeCloseTo(0)
    }
  })
})

describe('buildPlane — wave', () => {
  const wave = (amount: number, wavelength = 8, axis: 'x' | 'z' = 'x'): PlaneCurvature => ({
    type: 'wave', amount, axis, wavelength,
  })

  it('degenerates to flat as amount → 0', () => {
    const w = planeSurfaceToWorld({ u: 3, v: 3 }, plane({ curvature: wave(1e-9) }))
    expect(w.z).toBeCloseTo(0)
  })

  it('z follows amount·sin(2π·s/λ); zero-crossings at s = k·λ/2', () => {
    const pl = plane({ curvature: wave(2, 8) })
    expect(planeSurfaceToWorld({ u: 0, v: 0 }, pl).z).toBeCloseTo(0)
    expect(planeSurfaceToWorld({ u: 4, v: 0 }, pl).z).toBeCloseTo(0) // λ/2
    expect(planeSurfaceToWorld({ u: 2, v: 0 }, pl).z).toBeCloseTo(2) // λ/4 ⇒ peak
  })

  it('height-field projection round-trips (u,v)', () => {
    const pl = plane({ curvature: wave(1.5, 10) })
    const back = worldToPlaneSurface(planeSurfaceToWorld({ u: 3.5, v: -2 }, pl), pl)
    expect(back.u).toBeCloseTo(3.5)
    expect(back.v).toBeCloseTo(-2)
    expect(back.dist).toBeCloseTo(0)
  })
})

describe('buildPlane — reconcileBoundFormations', () => {
  function fNode(id: string, binding?: { planeId: string; u: number; v: number }): FormationNode {
    return {
      id,
      type: 'formation',
      position: { x: 0, y: 0 },
      parentId: null,
      data: {
        formationId: null,
        startTime: 0,
        duration: 5,
        transform: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
        keyframes: [],
        colorProgramId: null,
        idleConfigs: [],
        ...(binding ? { planeBinding: binding } : {}),
      },
    }
  }

  it('recomputes bound formation positions and skips unbound', () => {
    const pl = plane({ id: 'pA', position: { x: 10, y: 0, z: 0 } })
    const bound = fNode('n1', { planeId: 'pA', u: 2, v: 3 })
    const otherPlane = fNode('n2', { planeId: 'pB', u: 1, v: 1 })
    const unbound = fNode('n3')
    const result = reconcileBoundFormations(pl, [bound, otherPlane, unbound])
    expect(result).toHaveLength(1)
    expect(result[0]!.nodeId).toBe('n1')
    expect(result[0]!.position.x).toBeCloseTo(12) // 10 + u
    expect(result[0]!.position.y).toBeCloseTo(3) // v
  })
})
