// ============================================================================
// S20: Custom Point Editor — Direct 3D drone manipulation
// S20-01: Point selection, S20-02: Point drag, S20-03: Snap
// S20-04: Transform, S20-05: Count adjustment, S20-06: Edit mode toggle
// ============================================================================

import { useState, useCallback } from 'react'
import { create } from 'zustand'
import { useFormationStore } from '../../stores/formationStore'
import { useViewStore } from '../../stores/viewStore'
import { useGraphStore } from '../../stores/graphStore'
import { useSelectionDomain } from '../../stores/selectionDomain'
import { snapToPlane as snapPointToPlane } from '../../graph/snapPlane'
import { applySymmetricEdit, addSymmetricPoint } from '../../graph/symmetry'
import type { Vec3, FormationNodeData, SymmetryConfig } from '../../graph/types'

/**
 * Look up the symmetry config + node id for a given formationId — formations are
 * referenced by one or more formation nodes; we apply the config from the first
 * formation node that uses it (point edits affect all references).
 */
function findSymmetry(formationId: string): { nodeId: string; symmetry: SymmetryConfig } | null {
  const nodes = useGraphStore.getState().nodes
  for (const n of nodes) {
    if (n.type !== 'formation') continue
    const d = n.data as FormationNodeData
    if (d.formationId === formationId && d.symmetry) {
      return { nodeId: n.id, symmetry: d.symmetry }
    }
  }
  return null
}

function applyEdits(formationId: string, original: Vec3[], edits: Map<number, Vec3>): Vec3[] {
  const sym = findSymmetry(formationId)
  if (sym) {
    return applySymmetricEdit(original, sym.symmetry, edits)
  }
  const out = original.map((p) => ({ ...p }))
  edits.forEach((pos, idx) => { if (idx >= 0 && idx < out.length) out[idx] = pos })
  return out
}

function applySnap(p: Vec3): Vec3 {
  const sp = useViewStore.getState().snapPlane
  if (!sp.active) return p
  return snapPointToPlane(p, { position: sp.position, rotationDeg: sp.rotationDeg }, sp.cellSize)
}

// S20-03: Snap a point to the nearest grid position
function snapPointToGrid(point: Vec3, gridSize: number): Vec3 {
  return {
    x: Math.round(point.x / gridSize) * gridSize,
    y: Math.round(point.y / gridSize) * gridSize,
    z: Math.round(point.z / gridSize) * gridSize,
  }
}

export { snapPointToGrid as snapToGrid }

export interface PointEditorState {
  isActive: boolean
  formationId: string | null
  selectedIndices: Set<number>
}

// Item 5 (2026-05-22): singleton store. Lets the inspector + the 3D viewport
// share point-editor state without prop-drilling. The legacy `usePointEditor`
// hook below now reads + writes through this store so both APIs stay live.
interface PointEditorStore extends PointEditorState {
  enterEditMode: (formationId: string) => void
  exitEditMode: () => void
  selectPoint: (index: number, additive: boolean) => void
  selectMany: (indices: number[], additive: boolean) => void
  clearSelection: () => void
  selectAll: () => void
  moveSelected: (delta: Vec3) => void
}

export const usePointEditorStore = create<PointEditorStore>((set, get) => ({
  isActive: false,
  formationId: null,
  selectedIndices: new Set(),

  enterEditMode(formationId) {
    set({ isActive: true, formationId, selectedIndices: new Set() })
    useSelectionDomain.getState().push('points')
  },

  exitEditMode() {
    set({ isActive: false, formationId: null, selectedIndices: new Set() })
    useSelectionDomain.getState().remove('points')
  },

  selectPoint(index, additive) {
    const next = new Set(additive ? get().selectedIndices : [])
    if (next.has(index)) next.delete(index)
    else next.add(index)
    set({ selectedIndices: next })
  },

  selectMany(indices, additive) {
    const next = new Set(additive ? get().selectedIndices : [])
    for (const i of indices) next.add(i)
    set({ selectedIndices: next })
  },

  clearSelection() {
    set({ selectedIndices: new Set() })
  },

  selectAll() {
    const fid = get().formationId
    if (!fid) return
    const points = useFormationStore.getState().getPoints(fid)
    if (!points) return
    set({ selectedIndices: new Set(points.map((_, i) => i)) })
  },

  moveSelected(delta) {
    const { formationId, selectedIndices } = get()
    if (!formationId || selectedIndices.size === 0) return
    const points = useFormationStore.getState().getPoints(formationId)
    if (!points) return
    const edits = new Map<number, Vec3>()
    selectedIndices.forEach((i) => {
      const p = points[i]
      if (!p) return
      edits.set(i, applySnap({ x: p.x + delta.x, y: p.y + delta.y, z: p.z + delta.z }))
    })
    const newPoints = applyEdits(formationId, points, edits)
    useFormationStore.setState((s) => {
      s.generatedPoints.set(formationId, newPoints)
    })
  },
}))

export function usePointEditor() {
  const [state, setState] = useState<PointEditorState>({
    isActive: false,
    formationId: null,
    selectedIndices: new Set(),
  })

  const enterEditMode = useCallback((formationId: string) => {
    setState({ isActive: true, formationId, selectedIndices: new Set() })
  }, [])

  const exitEditMode = useCallback(() => {
    setState({ isActive: false, formationId: null, selectedIndices: new Set() })
  }, [])

  const selectPoint = useCallback((index: number, additive: boolean) => {
    setState((prev) => {
      const next = new Set(additive ? prev.selectedIndices : [])
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return { ...prev, selectedIndices: next }
    })
  }, [])

  const selectAll = useCallback(() => {
    if (!state.formationId) return
    const points = useFormationStore.getState().getPoints(state.formationId)
    if (!points) return
    setState((prev) => ({
      ...prev,
      selectedIndices: new Set(points.map((_, i) => i)),
    }))
  }, [state.formationId])

  const clearSelection = useCallback(() => {
    setState((prev) => ({ ...prev, selectedIndices: new Set() }))
  }, [])

  // S20-02 (+ Bundle 2/3): Move selected points by delta with snap-plane + symmetry.
  const moveSelected = useCallback((delta: Vec3) => {
    if (!state.formationId || state.selectedIndices.size === 0) return
    const store = useFormationStore.getState()
    const points = store.getPoints(state.formationId)
    if (!points) return
    const edits = new Map<number, Vec3>()
    state.selectedIndices.forEach((i) => {
      const p = points[i]
      if (!p) return
      edits.set(i, applySnap({ x: p.x + delta.x, y: p.y + delta.y, z: p.z + delta.z }))
    })
    const newPoints = applyEdits(state.formationId, points, edits)
    useFormationStore.setState((s) => {
      s.generatedPoints.set(state.formationId!, newPoints)
    })
  }, [state.formationId, state.selectedIndices])

  // S20-04 (+ Bundle 3): scale around centroid with symmetry-aware writes.
  const scaleSelected = useCallback((factor: number) => {
    if (!state.formationId || state.selectedIndices.size === 0) return
    const store = useFormationStore.getState()
    const points = store.getPoints(state.formationId)
    if (!points) return

    const selected = Array.from(state.selectedIndices)
    const cx = selected.reduce((s, i) => s + points[i]!.x, 0) / selected.length
    const cy = selected.reduce((s, i) => s + points[i]!.y, 0) / selected.length
    const cz = selected.reduce((s, i) => s + points[i]!.z, 0) / selected.length

    const edits = new Map<number, Vec3>()
    selected.forEach((i) => {
      const p = points[i]
      if (!p) return
      edits.set(i, applySnap({
        x: cx + (p.x - cx) * factor,
        y: cy + (p.y - cy) * factor,
        z: cz + (p.z - cz) * factor,
      }))
    })
    const newPoints = applyEdits(state.formationId, points, edits)
    useFormationStore.setState((s) => {
      s.generatedPoints.set(state.formationId!, newPoints)
    })
  }, [state.formationId, state.selectedIndices])

  // S20-03 (+ Bundle 3): symmetry-aware grid snap.
  const snapToGrid = useCallback((gridSize: number) => {
    if (!state.formationId || state.selectedIndices.size === 0) return
    const store = useFormationStore.getState()
    const points = store.getPoints(state.formationId)
    if (!points) return
    const edits = new Map<number, Vec3>()
    state.selectedIndices.forEach((i) => {
      const p = points[i]
      if (!p) return
      edits.set(i, snapPointToGrid(p, gridSize))
    })
    const newPoints = applyEdits(state.formationId, points, edits)
    useFormationStore.setState((s) => {
      s.generatedPoints.set(state.formationId!, newPoints)
    })
  }, [state.formationId, state.selectedIndices])

  // S20-04 (+ Bundle 3): rotate selection around its centroid with symmetry-aware writes.
  const rotateSelected = useCallback((angleDeg: number, axis: 'x' | 'y' | 'z') => {
    if (!state.formationId || state.selectedIndices.size === 0) return
    const store = useFormationStore.getState()
    const points = store.getPoints(state.formationId)
    if (!points) return

    const selected = Array.from(state.selectedIndices)
    const cx = selected.reduce((s, i) => s + points[i]!.x, 0) / selected.length
    const cy = selected.reduce((s, i) => s + points[i]!.y, 0) / selected.length
    const cz = selected.reduce((s, i) => s + points[i]!.z, 0) / selected.length

    const rad = (angleDeg * Math.PI) / 180
    const cos = Math.cos(rad)
    const sin = Math.sin(rad)

    const edits = new Map<number, Vec3>()
    selected.forEach((i) => {
      const p = points[i]
      if (!p) return
      const dx = p.x - cx, dy = p.y - cy, dz = p.z - cz
      let np: Vec3
      switch (axis) {
        case 'y': np = { x: cx + dx * cos + dz * sin, y: p.y, z: cz - dx * sin + dz * cos }; break
        case 'x': np = { x: p.x, y: cy + dy * cos - dz * sin, z: cz + dy * sin + dz * cos }; break
        case 'z': np = { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos, z: p.z }; break
      }
      edits.set(i, np)
    })
    const newPoints = applyEdits(state.formationId, points, edits)
    useFormationStore.setState((s) => {
      s.generatedPoints.set(state.formationId!, newPoints)
    })
  }, [state.formationId, state.selectedIndices])

  // S20-05 (+ Bundle 3): add drones; if symmetry is active spawn pairs and update pair map.
  const addDrones = useCallback((count: number) => {
    if (!state.formationId) return
    const store = useFormationStore.getState()
    const points = store.getPoints(state.formationId)
    if (!points) return
    const cx = points.length ? points.reduce((s, p) => s + p.x, 0) / points.length : 0
    const cy = points.length ? points.reduce((s, p) => s + p.y, 0) / points.length : 10
    const cz = points.length ? points.reduce((s, p) => s + p.z, 0) / points.length : 0

    const sym = findSymmetry(state.formationId)
    let working = points
    let workingPairs = sym?.symmetry.pairs
    for (let i = 0; i < count; i++) {
      const newPos: Vec3 = applySnap({
        x: cx + (Math.random() - 0.5) * 4,
        y: cy + (Math.random() - 0.5) * 4,
        z: cz + (Math.random() - 0.5) * 4,
      })
      if (sym && workingPairs) {
        const r = addSymmetricPoint(working, { ...sym.symmetry, pairs: workingPairs }, newPos)
        working = r.points
        workingPairs = r.pairs
      } else {
        working = [...working, newPos]
      }
    }

    useFormationStore.setState((s) => {
      s.generatedPoints.set(state.formationId!, working)
      const f = s.formations.find((f) => f.id === state.formationId)
      if (f) f.pointCount = working.length
    })
    if (sym && workingPairs) {
      useGraphStore.getState().updateNodeData(sym.nodeId, {
        symmetry: { ...sym.symmetry, pairs: workingPairs },
      } as Partial<FormationNodeData>)
    }
  }, [state.formationId])

  const removeDrones = useCallback((count: number) => {
    if (!state.formationId) return
    const store = useFormationStore.getState()
    const points = store.getPoints(state.formationId)
    if (!points || points.length <= count) return
    // Remove furthest from centroid
    const cx = points.reduce((s, p) => s + p.x, 0) / points.length
    const cy = points.reduce((s, p) => s + p.y, 0) / points.length
    const cz = points.reduce((s, p) => s + p.z, 0) / points.length
    const indexed = points.map((p, i) => ({ p, i, d: (p.x - cx) ** 2 + (p.y - cy) ** 2 + (p.z - cz) ** 2 }))
    indexed.sort((a, b) => b.d - a.d)
    const removeSet = new Set(indexed.slice(0, count).map((e) => e.i))
    const newPoints = points.filter((_, i) => !removeSet.has(i))
    useFormationStore.setState((s) => {
      s.generatedPoints.set(state.formationId!, newPoints)
      const f = s.formations.find((f) => f.id === state.formationId)
      if (f) f.pointCount = newPoints.length
    })
  }, [state.formationId])

  return {
    ...state,
    enterEditMode,
    exitEditMode,
    selectPoint,
    selectAll,
    clearSelection,
    moveSelected,
    scaleSelected,
    snapToGrid: snapToGrid,
    rotateSelected,
    addDrones,
    removeDrones,
  }
}
