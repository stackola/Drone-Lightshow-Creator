// ============================================================================
// S4-06: Undo/Redo Foundation
// ============================================================================
// Records graphStore snapshots. Ctrl+Z = undo, Ctrl+Shift+Z = redo.
// Max 50 history steps.
// ============================================================================

import { create } from 'zustand'
import type { ShowGraph, Vec3 } from '../graph/types'
import { useGraphStore } from './graphStore'
import { useFormationStore, type Formation } from './formationStore'
import { useProjectStore, type ProjectMeta, type DronePool, type Constraints } from './projectStore'
import { usePlanesStore } from './planesStore'
import type { AnimatedFormationDef } from '../graph/animatedFormation'
import type { BuildPlane } from '../graph/buildPlane'

interface FormationSnapshot {
  formations: Formation[]
  generatedPoints: Map<string, Vec3[]>
  animatedDefs: Map<string, AnimatedFormationDef>
}

interface ProjectSnapshot {
  meta: ProjectMeta
  dronePool: DronePool
  constraints: Constraints
}

interface PlanesSnapshot {
  planes: BuildPlane[]
  activePlaneId: string | null
}

interface HistoryEntry {
  graph: ShowGraph
  formation: FormationSnapshot
  project: ProjectSnapshot
  planes: PlanesSnapshot
  timestamp: number
  /** Human-readable label describing the action that produced this state.
   *  Used by the undo/redo UI to say "Undo: Move Formation" rather than just
   *  "Undo". L5-undo-names (2026-05-21). */
  label?: string
}

interface HistoryStoreState {
  past: HistoryEntry[]
  future: HistoryEntry[]
  maxSteps: number

  /** Record a snapshot. `label` defaults to "Edit". */
  snapshot: (label?: string) => void
  undo: () => void
  redo: () => void
  canUndo: () => boolean
  canRedo: () => boolean
  /** Label of the action that the next `undo()` call would reverse. */
  labelForNextUndo: () => string | null
  /** Label of the action that the next `redo()` call would re-apply. */
  labelForNextRedo: () => string | null
}

// S22: JSON roundtrip is faster than structuredClone for large plain objects
function deepClone<T>(obj: T): T {
  try {
    return JSON.parse(JSON.stringify(obj))
  } catch {
    return structuredClone(obj)
  }
}

function cloneGraph(): ShowGraph {
  const state = useGraphStore.getState()
  return deepClone({ nodes: state.nodes, edges: state.edges })
}

function cloneFormation(): FormationSnapshot {
  const state = useFormationStore.getState()
  return {
    formations: deepClone(state.formations),
    generatedPoints: new Map(Array.from(state.generatedPoints.entries()).map(([k, v]) => [k, deepClone(v)])),
    animatedDefs: new Map(Array.from(state.animatedDefs.entries()).map(([k, v]) => [k, deepClone(v)])),
  }
}

function cloneProject(): ProjectSnapshot {
  const state = useProjectStore.getState()
  return deepClone({ meta: state.meta, dronePool: state.dronePool, constraints: state.constraints })
}

function clonePlanes(): PlanesSnapshot {
  const state = usePlanesStore.getState()
  return deepClone({ planes: state.planes, activePlaneId: state.activePlaneId })
}

export const useHistoryStore = create<HistoryStoreState>()((set, get) => ({
  past: [],
  future: [],
  maxSteps: 50,

  snapshot(label?: string) {
    const graph = cloneGraph()
    const formation = cloneFormation()
    const project = cloneProject()
    const planes = clonePlanes()
    const { past } = get()
    const now = Date.now()

    if (past.length > 0) {
      const lastEntry = past[past.length - 1]!
      // Debounce: skip if last snapshot was < 300ms ago (rapid drags/resizes).
      // L5-undo-grouping: rapid mutations of the same kind coalesce into one
      // entry, so dragging a gizmo across the room is one "Undo: Move
      // Formation" instead of 60 frame-by-frame entries.
      if (now - lastEntry.timestamp < 300) {
        const last = lastEntry.graph
        if (last.nodes.length === graph.nodes.length && last.edges.length === graph.edges.length) {
          return
        }
      }
      // Deduplicate: skip if identical to last snapshot
      const last = lastEntry.graph
      if (last.nodes.length === graph.nodes.length && last.edges.length === graph.edges.length) {
        const sameNodes = last.nodes.every((n, i) => n.id === graph.nodes[i]?.id)
        const sameData = sameNodes && JSON.stringify(last) === JSON.stringify(graph)
        if (sameData) return
      }
    }
    set((state) => {
      const past = [...state.past, { graph, formation, project, planes, timestamp: now, label: label ?? 'Edit' }]
      if (past.length > state.maxSteps) past.shift()
      return { past, future: [] }
    })
  },

  undo() {
    const { past } = get()
    if (past.length === 0) return

    const currentGraph = cloneGraph()
    const currentFormation = cloneFormation()
    const currentProject = cloneProject()
    const currentPlanes = clonePlanes()
    const previous = past[past.length - 1]!

    set((state) => ({
      past: state.past.slice(0, -1),
      future: [{ graph: currentGraph, formation: currentFormation, project: currentProject, planes: currentPlanes, timestamp: Date.now() }, ...state.future],
    }))

    useGraphStore.getState().loadGraph(previous.graph)
    useFormationStore.getState().loadFormations(previous.formation.formations, previous.formation.generatedPoints, previous.formation.animatedDefs)
    useProjectStore.getState().loadProject(previous.project.meta, previous.project.dronePool, previous.project.constraints)
    usePlanesStore.getState().loadPlanes(previous.planes.planes, previous.planes.activePlaneId)
  },

  redo() {
    const { future } = get()
    if (future.length === 0) return

    const currentGraph = cloneGraph()
    const currentFormation = cloneFormation()
    const currentProject = cloneProject()
    const currentPlanes = clonePlanes()
    const next = future[0]!

    set((state) => ({
      past: [...state.past, { graph: currentGraph, formation: currentFormation, project: currentProject, planes: currentPlanes, timestamp: Date.now() }],
      future: state.future.slice(1),
    }))

    useGraphStore.getState().loadGraph(next.graph)
    useFormationStore.getState().loadFormations(next.formation.formations, next.formation.generatedPoints, next.formation.animatedDefs)
    useProjectStore.getState().loadProject(next.project.meta, next.project.dronePool, next.project.constraints)
    usePlanesStore.getState().loadPlanes(next.planes.planes, next.planes.activePlaneId)
  },

  canUndo() {
    return get().past.length > 0
  },

  canRedo() {
    return get().future.length > 0
  },

  labelForNextUndo() {
    const { past } = get()
    if (past.length === 0) return null
    return past[past.length - 1]?.label ?? 'Edit'
  },

  labelForNextRedo() {
    const { future } = get()
    if (future.length === 0) return null
    return future[0]?.label ?? 'Edit'
  },
}))

/**
 * Read-only snapshot view of the history for UI rendering. Returns the past +
 * future entries with their labels and timestamps. Avoids cloning the heavy
 * `graph` / `formation` / `project` payloads.
 */
export function getHistorySummary(): {
  past: Array<{ label: string; timestamp: number }>
  future: Array<{ label: string; timestamp: number }>
} {
  const state = useHistoryStore.getState()
  return {
    past: state.past.map((e) => ({ label: e.label ?? 'Edit', timestamp: e.timestamp })),
    future: state.future.map((e) => ({ label: e.label ?? 'Edit', timestamp: e.timestamp })),
  }
}
