// ============================================================================
// Graph Store — Single Source of Truth for Graph State
// ============================================================================
// ARCHITECTURAL LAW: This store IS the canonical graph truth.
// React Flow adapts to it. UI reads from it. No other store owns graph data.
// Every edge mutation triggers computeFlow() to recompute auto-allocated counts.
// updateNodePosition() is layout only — it NEVER touches time fields.
// ============================================================================

import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import type {
  ShowGraph,
  ShowNode,
  ShowEdge,
  ShowNodeType,
  ShowNodeData,
  AllocationMode,
  AttachedIdleConfig,
  TransformKeyframe,
  FormationNodeData,
  Diagnostic,
  TransitionConfig,
  Vec3,
} from '../graph/types'
import { isValidConnection } from '../graph/ports'
import { computeFlow } from '../graph/flow'
import { computeTimePushPatches, computeExtendFormationPatches } from '../graph/timePush'
import { computeTiming, type TimeRange } from '../graph/timing'

// --- ID Generation ---

let _idCounter = 0
export function generateId(prefix = 'node'): string {
  return `${prefix}-${Date.now().toString(36)}-${(++_idCounter).toString(36)}`
}

// Reset for tests
export function resetIdCounter(): void {
  _idCounter = 0
}

// --- Store Interface ---

export interface GraphStoreState {
  nodes: ShowNode[]
  edges: ShowEdge[]
  flowDiagnostics: Diagnostic[]
  _cachedTiming: Map<string, TimeRange> | null
  _cachedEdgeTiming: Map<string, TimeRange> | null
  _lastEdgesSnapshot: string | null

  // Node CRUD (S1-01)
  addNode: (type: ShowNodeType, position: { x: number; y: number }, data: ShowNodeData) => string
  updateNodeData: (id: string, patch: Partial<ShowNodeData>) => void
  updateNodePosition: (id: string, position: { x: number; y: number }) => void
  setNodePositionsBatch: (positions: Array<{ id: string; position: { x: number; y: number } }>) => void
  /** Build Planes: batch-write formation 3D world positions (plane reconciliation). */
  setFormationPositionsBatch: (positions: Array<{ nodeId: string; position: Vec3 }>) => void
  removeNode: (id: string) => void
  getNode: (id: string) => ShowNode | undefined

  // Edge CRUD (S1-02)
  addEdge: (
    source: string,
    sourcePort: string,
    target: string,
    targetPort: string,
    edgeType: 'flow' | 'attachment',
    allocation?: AllocationMode,
    transition?: TransitionConfig,
  ) => string | null
  updateEdgeAllocation: (id: string, allocation: AllocationMode) => void
  updateEdgeTransition: (id: string, patch: Partial<TransitionConfig>) => void
  removeEdge: (id: string) => void
  getEdgesForNode: (nodeId: string, direction?: 'in' | 'out') => ShowEdge[]

  // Attached idle CRUD (S1-03)
  addAttachedIdle: (formationNodeId: string, config: Omit<AttachedIdleConfig, 'id'>) => string
  updateAttachedIdle: (formationNodeId: string, idleId: string, patch: Partial<AttachedIdleConfig>) => void
  removeAttachedIdle: (formationNodeId: string, idleId: string) => void

  // Keyframe CRUD (S1-04)
  addKeyframe: (nodeId: string, time: number, transform: TransformKeyframe['transform'], easing: TransformKeyframe['easing']) => void
  updateKeyframe: (nodeId: string, index: number, patch: Partial<TransformKeyframe>) => void
  removeKeyframe: (nodeId: string, index: number) => void

  // Group operations (S1-05)
  addGroup: (label: string, color: string, childIds?: string[]) => string
  addToGroup: (groupId: string, nodeId: string) => void
  removeFromGroup: (nodeId: string) => void
  collapseGroup: (groupId: string) => void
  expandGroup: (groupId: string) => void
  removeGroup: (groupId: string, deleteChildren: boolean) => void

  // Time push — shift downstream nodes to accommodate transition durations
  pushDownstreamTiming: (startNodeId: string, delta: number) => void

  // Violation fixes — apply physics violation fixes (push-downstream, extend-formation, extend-transition)
  applyViolationFixes: (fixes: { type: string; nodeId: string; edgeId?: string; delta: number }[]) => void

  // Cached timing — recomputed on every mutation
  getCachedTiming: () => Map<string, TimeRange>
  getCachedEdgeTiming: () => Map<string, TimeRange>

  // Internal
  _recomputeFlow: () => void
  _invalidateTiming: () => void

  // Bulk load for deserialization
  loadGraph: (graph: ShowGraph) => void
}

export const useGraphStore = create<GraphStoreState>()(
  immer((set, get) => ({
    nodes: [],
    edges: [],
    flowDiagnostics: [],
    _cachedTiming: null,
    _cachedEdgeTiming: null,
    _lastEdgesSnapshot: null,

    // --- Node CRUD (S1-01) ---

    addNode(type, position, data) {
      const id = generateId(type)
      set((state) => {
        const node = { id, type, position, data: structuredClone(data), parentId: null } as ShowNode
        state.nodes.push(node)
      })
      get()._invalidateTiming()
      return id
    },

    updateNodeData(id, patch) {
      set((state) => {
        const node = state.nodes.find((n) => n.id === id)
        if (node) {
          node.data = { ...node.data, ...patch } as ShowNodeData
        }
      })
      // Recompute flow if data change might affect it
      get()._recomputeFlow()
    },

    updateNodePosition(id, position) {
      // ARCHITECTURAL LAW: This is layout only. NEVER touches time fields.
      set((state) => {
        const node = state.nodes.find((n) => n.id === id)
        if (node) {
          node.position = position
        }
      })
    },

    setNodePositionsBatch(positions) {
      // Slice 2 Step 6: applies an auto-layout result in one mutation (avoids triggering
      // N renders via N updateNodePosition calls).
      set((state) => {
        const lookup = new Map(positions.map((p) => [p.id, p.position]))
        for (const node of state.nodes) {
          const pos = lookup.get(node.id)
          if (pos) node.position = pos
        }
      })
    },

    setFormationPositionsBatch(positions) {
      // Build Planes: reconcile bound formations after a plane moves/curves.
      // One mutation → one render → one undo entry shared with the plane edit.
      if (positions.length === 0) return
      set((state) => {
        const lookup = new Map(positions.map((p) => [p.nodeId, p.position]))
        for (const node of state.nodes) {
          if (node.type !== 'formation') continue
          const pos = lookup.get(node.id)
          if (pos) (node.data as FormationNodeData).transform.position = { ...pos }
        }
      })
      get()._invalidateTiming()
    },

    removeNode(id) {
      set((state) => {
        // Remove all connected edges
        state.edges = state.edges.filter(
          (e) => e.source !== id && e.target !== id,
        )
        // Ungroup children if this is a group
        const node = state.nodes.find((n) => n.id === id)
        if (node?.type === 'group') {
          for (const child of state.nodes) {
            if (child.parentId === id) {
              child.parentId = null
            }
          }
        }
        // Remove the node
        state.nodes = state.nodes.filter((n) => n.id !== id)
      })
      get()._recomputeFlow()
    },

    getNode(id) {
      return get().nodes.find((n) => n.id === id)
    },

    // --- Edge CRUD (S1-02) ---

    addEdge(source, sourcePort, target, targetPort, edgeType, allocation, transition) {
      const state = get()
      const graph: ShowGraph = { nodes: state.nodes, edges: state.edges }
      const validation = isValidConnection(graph, source, sourcePort, target, targetPort)

      if (!validation.valid) {
        return null
      }

      const id = generateId('edge')
      // Flow edges get a default transition config so the timing solver
      // always has strategy data to read. Attachment edges never carry one.
      const resolvedTransition = edgeType === 'flow'
        ? transition ?? {
            strategyId: 'shortest-path',
            parameters: {},
            preferredDuration: 2,
            pushPolicy: 'auto',
            locked: false,
          }
        : undefined
      const edge: ShowEdge = {
        id,
        edgeType,
        source,
        sourcePort,
        target,
        targetPort,
        droneCount: 0,
        allocation: allocation ?? { mode: 'auto' },
        ...(resolvedTransition ? { transition: resolvedTransition } : {}),
      }

      set((state) => {
        state.edges.push(edge)
      })
      get()._recomputeFlow()
      return id
    },

    updateEdgeAllocation(id, allocation) {
      set((state) => {
        const edge = state.edges.find((e) => e.id === id)
        if (edge) {
          edge.allocation = allocation
        }
      })
      get()._recomputeFlow()
    },

    updateEdgeTransition(id, patch) {
      set((state) => {
        const edge = state.edges.find((e) => e.id === id)
        if (!edge || edge.edgeType !== 'flow') return
        const existing = edge.transition ?? {
          strategyId: 'shortest-path',
          parameters: {},
          preferredDuration: 2,
          pushPolicy: 'auto' as const,
          locked: false,
        }
        edge.transition = { ...existing, ...patch }
      })
      get()._invalidateTiming()
    },

    removeEdge(id) {
      set((state) => {
        state.edges = state.edges.filter((e) => e.id !== id)
      })
      get()._recomputeFlow()
    },

    getEdgesForNode(nodeId, direction) {
      const edges = get().edges
      if (direction === 'in') return edges.filter((e) => e.target === nodeId)
      if (direction === 'out') return edges.filter((e) => e.source === nodeId)
      return edges.filter((e) => e.source === nodeId || e.target === nodeId)
    },

    // --- Attached Idle CRUD (S1-03) ---

    addAttachedIdle(formationNodeId, config) {
      const id = generateId('idle-config')
      set((state) => {
        const node = state.nodes.find((n) => n.id === formationNodeId && n.type === 'formation')
        if (node) {
          const data = node.data as FormationNodeData
          data.idleConfigs.push({ ...config, id })
        }
      })
      get()._recomputeFlow()
      return id
    },

    updateAttachedIdle(formationNodeId, idleId, patch) {
      set((state) => {
        const node = state.nodes.find((n) => n.id === formationNodeId && n.type === 'formation')
        if (node) {
          const data = node.data as FormationNodeData
          const idle = data.idleConfigs.find((ic) => ic.id === idleId)
          if (idle) {
            Object.assign(idle, patch)
          }
        }
      })
      get()._recomputeFlow()
    },

    removeAttachedIdle(formationNodeId, idleId) {
      set((state) => {
        const node = state.nodes.find((n) => n.id === formationNodeId && n.type === 'formation')
        if (node) {
          const data = node.data as FormationNodeData
          data.idleConfigs = data.idleConfigs.filter((ic) => ic.id !== idleId)
        }
      })
      get()._recomputeFlow()
    },

    // --- Keyframe CRUD (S1-04) ---

    addKeyframe(nodeId, time, transform, easing) {
      set((state) => {
        const node = state.nodes.find((n) => n.id === nodeId && n.type === 'formation')
        if (!node) return
        const data = node.data as FormationNodeData

        // Clamp to node's time window
        const clampedTime = Math.max(0, Math.min(time, data.duration))

        // Replace at same time (0.01s tolerance)
        const existingIdx = data.keyframes.findIndex((k) => Math.abs(k.time - clampedTime) < 0.01)
        const kf: TransformKeyframe = { id: `kf-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, time: clampedTime, transform, easing }

        if (existingIdx >= 0) {
          data.keyframes[existingIdx] = kf
        } else {
          data.keyframes.push(kf)
        }

        // Keep sorted
        data.keyframes.sort((a, b) => a.time - b.time)
      })
    },

    updateKeyframe(nodeId, index, patch) {
      set((state) => {
        const node = state.nodes.find((n) => n.id === nodeId && n.type === 'formation')
        if (!node) return
        const data = node.data as FormationNodeData
        const kf = data.keyframes[index]
        if (kf) {
          Object.assign(kf, patch)
          data.keyframes.sort((a, b) => a.time - b.time)
        }
      })
    },

    removeKeyframe(nodeId, index) {
      set((state) => {
        const node = state.nodes.find((n) => n.id === nodeId && n.type === 'formation')
        if (!node) return
        const data = node.data as FormationNodeData
        data.keyframes.splice(index, 1)
      })
    },

    // --- Group Operations (S1-05) ---

    addGroup(label, color, childIds) {
      const id = generateId('group')
      set((state) => {
        const groupNode: ShowNode = {
          id,
          type: 'group',
          position: { x: 0, y: 0 },
          data: { label, color, collapsed: false, showInternalEdges: true },
          parentId: null,
        }
        state.nodes.push(groupNode)

        if (childIds) {
          for (const childId of childIds) {
            const child = state.nodes.find((n) => n.id === childId)
            if (child) {
              child.parentId = id
            }
          }
        }
      })
      return id
    },

    addToGroup(groupId, nodeId) {
      set((state) => {
        const node = state.nodes.find((n) => n.id === nodeId)
        if (node) {
          node.parentId = groupId
        }
      })
    },

    removeFromGroup(nodeId) {
      set((state) => {
        const node = state.nodes.find((n) => n.id === nodeId)
        if (node) {
          node.parentId = null
        }
      })
    },

    collapseGroup(groupId) {
      set((state) => {
        const node = state.nodes.find((n) => n.id === groupId && n.type === 'group')
        if (node) {
          (node.data as { collapsed: boolean }).collapsed = true
        }
      })
    },

    expandGroup(groupId) {
      set((state) => {
        const node = state.nodes.find((n) => n.id === groupId && n.type === 'group')
        if (node) {
          (node.data as { collapsed: boolean }).collapsed = false
        }
      })
    },

    removeGroup(groupId, deleteChildren) {
      set((state) => {
        if (deleteChildren) {
          // Remove children and their edges
          const childIds = state.nodes.filter((n) => n.parentId === groupId).map((n) => n.id)
          const idsToRemove = new Set([groupId, ...childIds])
          state.edges = state.edges.filter((e) => !idsToRemove.has(e.source) && !idsToRemove.has(e.target))
          state.nodes = state.nodes.filter((n) => !idsToRemove.has(n.id))
        } else {
          // Ungroup children
          for (const child of state.nodes) {
            if (child.parentId === groupId) {
              child.parentId = null
            }
          }
          // Remove group and its connected edges
          state.edges = state.edges.filter((e) => e.source !== groupId && e.target !== groupId)
          state.nodes = state.nodes.filter((n) => n.id !== groupId)
        }
      })
      get()._recomputeFlow()
    },

    // --- Time Push ---

    pushDownstreamTiming(startNodeId, delta) {
      set((state) => {
        const graph: ShowGraph = { nodes: state.nodes, edges: state.edges }
        const patches = computeTimePushPatches(graph, startNodeId, delta)
        for (const { nodeId, patch } of patches) {
          const node = state.nodes.find((n) => n.id === nodeId)
          if (node) {
            node.data = { ...node.data, ...patch } as ShowNodeData
          }
        }
      })
      get()._recomputeFlow()
    },

    applyViolationFixes(fixes) {
      for (const fix of fixes) {
        const currentState = get()
        const graph: ShowGraph = { nodes: currentState.nodes, edges: currentState.edges }
        let patches: { nodeId: string; patch: Record<string, unknown> }[] = []

        if (fix.type === 'push-downstream') {
          patches = computeTimePushPatches(graph, fix.nodeId, fix.delta)
        } else if (fix.type === 'extend-formation') {
          patches = computeExtendFormationPatches(graph, fix.nodeId, fix.delta)
        } else if (fix.type === 'extend-transition' && fix.edgeId) {
          set((state) => {
            const edge = state.edges.find((e) => e.id === fix.edgeId)
            if (!edge || edge.edgeType !== 'flow' || !edge.transition) return
            edge.transition = {
              ...edge.transition,
              preferredDuration: edge.transition.preferredDuration + fix.delta,
            }
          })
          continue
        }

        if (patches.length > 0) {
          set((state) => {
            for (const { nodeId, patch } of patches) {
              const node = state.nodes.find((n) => n.id === nodeId)
              if (node) {
                node.data = { ...node.data, ...patch } as ShowNodeData
              }
            }
          })
        }
      }
      get()._recomputeFlow()
    },

    getCachedTiming() {
      const state = get()
      if (state._cachedTiming) return state._cachedTiming
      const graph: ShowGraph = { nodes: state.nodes, edges: state.edges }
      const result = computeTiming(graph)
      // Cache without triggering a store update (avoids side effect in getter)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(state as any)._cachedTiming = result.ranges
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(state as any)._cachedEdgeTiming = result.edgeRanges
      return result.ranges
    },

    getCachedEdgeTiming() {
      const state = get()
      if (state._cachedEdgeTiming) return state._cachedEdgeTiming
      // Force compute (populates both caches).
      get().getCachedTiming()
      return get()._cachedEdgeTiming ?? new Map()
    },

    // --- Internal ---

    _invalidateTiming() {
      set({ _cachedTiming: null, _cachedEdgeTiming: null } as Partial<GraphStoreState>)
    },

    _recomputeFlow() {
      get()._invalidateTiming()
      const state = get()

      // S22: Dirty check — skip recompute if edges haven't changed
      const edgesSnapshot = JSON.stringify(state.edges.map((e) => `${e.id}:${e.source}:${e.target}:${e.allocation?.mode}:${e.transition?.strategyId ?? ''}`))
      if (edgesSnapshot === state._lastEdgesSnapshot) return

      const graph: ShowGraph = { nodes: state.nodes, edges: state.edges }
      const flowResult = computeFlow(graph)

      set((state) => {
        state._lastEdgesSnapshot = edgesSnapshot
        // Update edge droneCount values from flow computation
        for (const updatedEdge of flowResult.edges) {
          const existing = state.edges.find((e) => e.id === updatedEdge.id)
          if (existing) {
            existing.droneCount = updatedEdge.droneCount
          }
        }
        state.flowDiagnostics = flowResult.diagnostics
      })
    },

    loadGraph(graph) {
      set((state) => {
        state.nodes = graph.nodes
        state.edges = graph.edges
      })
      get()._recomputeFlow()
    },
  })),
)

// ─── Mutation version (S1 partial — 2026-05-21) ─────────────────────────────
// Module-level counter that ticks on every store mutation. Consumers (the live
// preview eval cache, primarily) hash by this counter + currentTime to detect
// when the graph has changed without paying the cost of deep-comparing nodes
// or edges. Bumped via subscribe() so we don't have to thread it through every
// individual action.
let _graphMutationVersion = 0
useGraphStore.subscribe(() => { _graphMutationVersion += 1 })
export function getGraphMutationVersion(): number {
  return _graphMutationVersion
}
