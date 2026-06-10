// ============================================================================
// Planes Store — first-class persistent Build Planes
// ============================================================================
// Build Planes are project data (they serialize + undo), held in a sibling
// collection NOT inside the ShowGraph — mirroring how dronePool/constraints/
// formations are stored. This store is the single source of build planes; the
// view-mode system and audience layer consume it via getActivePlane() /
// setActivePlaneByKind() but never own plane data.
//
// updatePlane() reconciles every bound formation's world position through
// graphStore.setFormationPositionsBatch so one undo entry covers both.
// ============================================================================

import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import {
  type BuildPlane,
  type PlaneCurvature,
  type PlaneKind,
  DEFAULT_CURVATURE,
  PLANE_KIND_ROTATION,
  reconcileBoundFormations,
} from '../graph/buildPlane'
import { isFormationNode, type FormationNode } from '../graph/types'
import { useGraphStore } from './graphStore'

/** Keep curvature invertible: total arc across the half-extent stays ≤ ~π·0.9. */
export function clampCurvatureAmount(amount: number, type: PlaneCurvature['type'], size: number): number {
  if (type === 'cylinder' || type === 'dome') {
    const maxK = (Math.PI * 0.9) / Math.max(1, size / 2)
    return Math.max(-maxK, Math.min(maxK, amount))
  }
  return amount
}

let _planeIdCounter = 0
function genPlaneId(): string {
  return `plane-${Date.now().toString(36)}-${(++_planeIdCounter).toString(36)}`
}

function defaultPlane(over: Partial<BuildPlane> = {}): BuildPlane {
  return {
    id: genPlaneId(),
    name: 'Plane',
    position: { x: 0, y: 0, z: 0 },
    rotationDeg: { ...PLANE_KIND_ROTATION['ground-xz'] },
    size: 20,
    cellSize: 1,
    curvature: { ...DEFAULT_CURVATURE },
    locked: false,
    visible: true,
    ...over,
  }
}

export interface PlanesStoreState {
  planes: BuildPlane[]
  activePlaneId: string | null

  addPlane: (over?: Partial<BuildPlane>) => string
  updatePlane: (id: string, patch: Partial<BuildPlane>) => void
  removePlane: (id: string) => void
  setActivePlane: (id: string | null) => void
  /** View-mode seam: select (or lazily create) the active plane for a view's default kind. */
  setActivePlaneByKind: (kind: PlaneKind) => string
  getPlane: (id: string) => BuildPlane | undefined
  getActivePlane: () => BuildPlane | undefined

  loadPlanes: (planes: BuildPlane[], activePlaneId?: string | null) => void
}

/** Reconcile every formation bound to `plane` to its surface, writing through graphStore. */
function reconcile(plane: BuildPlane): void {
  const formationNodes = useGraphStore.getState().nodes.filter(isFormationNode) as FormationNode[]
  const updates = reconcileBoundFormations(plane, formationNodes)
  if (updates.length > 0) useGraphStore.getState().setFormationPositionsBatch(updates)
}

export const usePlanesStore = create<PlanesStoreState>()(
  immer((set, get) => ({
    planes: [],
    activePlaneId: null,

    addPlane(over) {
      const plane = defaultPlane(over)
      set((state) => {
        state.planes.push(plane)
        state.activePlaneId = plane.id
      })
      return plane.id
    },

    updatePlane(id, patch) {
      let updated: BuildPlane | undefined
      set((state) => {
        const plane = state.planes.find((p) => p.id === id)
        if (!plane) return
        const { id: _ignore, ...safe } = patch as Record<string, unknown>
        Object.assign(plane, safe)
        // Keep curvature amount invertible against the (possibly new) size.
        if (plane.curvature) {
          plane.curvature.amount = clampCurvatureAmount(plane.curvature.amount, plane.curvature.type, plane.size)
        }
        updated = JSON.parse(JSON.stringify(plane)) as BuildPlane
      })
      if (updated) reconcile(updated)
    },

    removePlane(id) {
      set((state) => {
        state.planes = state.planes.filter((p) => p.id !== id)
        if (state.activePlaneId === id) {
          state.activePlaneId = state.planes.length ? state.planes[0]!.id : null
        }
      })
    },

    setActivePlane(id) {
      set((state) => {
        state.activePlaneId = id
      })
    },

    setActivePlaneByKind(kind) {
      // Prefer an existing flat plane already oriented to this kind; else create one.
      const rot = PLANE_KIND_ROTATION[kind]
      const existing = get().planes.find(
        (p) =>
          p.rotationDeg.x === rot.x &&
          p.rotationDeg.y === rot.y &&
          p.rotationDeg.z === rot.z,
      )
      if (existing) {
        set((state) => {
          state.activePlaneId = existing.id
        })
        return existing.id
      }
      const name = kind === 'ground-xz' ? 'Ground' : kind === 'vertical-xy' ? 'Front' : 'Side'
      return get().addPlane({ name, rotationDeg: { ...rot } })
    },

    getPlane(id) {
      return get().planes.find((p) => p.id === id)
    },

    getActivePlane() {
      const { planes, activePlaneId } = get()
      return planes.find((p) => p.id === activePlaneId)
    },

    loadPlanes(planes, activePlaneId) {
      set((state) => {
        state.planes = planes.map((p) => ({
          ...p,
          curvature: p.curvature ?? { ...DEFAULT_CURVATURE },
          locked: p.locked ?? false,
          visible: p.visible ?? true,
        }))
        state.activePlaneId =
          activePlaneId !== undefined
            ? activePlaneId
            : planes.length
              ? planes[0]!.id
              : null
      })
    },
  })),
)

// Mutation version — mirrors graphStore/formationStore so the eval cache sees plane edits.
let _planesMutationVersion = 0
usePlanesStore.subscribe(() => {
  _planesMutationVersion += 1
})
export function getPlanesMutationVersion(): number {
  return _planesMutationVersion
}
