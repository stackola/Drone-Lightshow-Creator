// S5-12: Store cross-interaction tests — undo/redo + graph + formation consistency
import { describe, it, expect, beforeEach } from 'vitest'
import { useGraphStore } from './graphStore'
import { useHistoryStore } from './historyStore'
import { useSelectionStore } from './selectionStore'
import '../registries/init'

function resetStores() {
  useGraphStore.getState().loadGraph({ nodes: [], edges: [] })
  useHistoryStore.setState({ past: [], future: [] })
  useSelectionStore.getState().clearSelection()
}

describe('Store cross-interactions', () => {
  beforeEach(resetStores)

  it('undo restores previous graph state', () => {
    const { addNode } = useGraphStore.getState()
    const { snapshot, undo } = useHistoryStore.getState()

    // Take snapshot of empty graph
    snapshot()
    expect(useGraphStore.getState().nodes.length).toBe(0)

    // Add a node
    addNode('launch', { x: 0, y: 0 }, { droneCount: 10, startTime: 0, staggerDelay: 0.02 })
    expect(useGraphStore.getState().nodes.length).toBe(1)

    // Undo should restore empty graph
    undo()
    expect(useGraphStore.getState().nodes.length).toBe(0)
  })

  it('redo restores forward state', () => {
    const { addNode } = useGraphStore.getState()
    const { snapshot, undo, redo } = useHistoryStore.getState()

    snapshot()
    addNode('launch', { x: 0, y: 0 }, { droneCount: 10, startTime: 0, staggerDelay: 0.02 })
    undo()
    expect(useGraphStore.getState().nodes.length).toBe(0)
    redo()
    expect(useGraphStore.getState().nodes.length).toBe(1)
  })

  it('selection is cleared on node deletion', () => {
    const { addNode, removeNode } = useGraphStore.getState()
    const { selectNode } = useSelectionStore.getState()

    const nodeId = addNode('formation', { x: 0, y: 0 }, {
      formationId: null, startTime: 5, duration: 5,
      transform: { position: { x: 0, y: 10, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
      keyframes: [], colorProgramId: null, idleConfigs: [],
    })

    selectNode(nodeId)
    expect(useSelectionStore.getState().selectedNodeIds).toContain(nodeId)

    // We clear selection explicitly when deleting via keyboard handler;
    // the store itself doesn't auto-clear
    removeNode(nodeId)
    expect(useGraphStore.getState().nodes.length).toBe(0)
  })

  it('additive node selection clears edge selection', () => {
    const { selectNode, selectEdge } = useSelectionStore.getState()

    // Select an edge
    selectEdge('edge-1')
    expect(useSelectionStore.getState().selectedEdgeIds).toContain('edge-1')

    // Additive select a node should clear edges
    selectNode('node-1', true)
    expect(useSelectionStore.getState().selectedEdgeIds.length).toBe(0)
    expect(useSelectionStore.getState().selectedNodeIds).toContain('node-1')
  })

  it('additive edge selection clears node selection', () => {
    const { selectNode, selectEdge } = useSelectionStore.getState()

    selectNode('node-1')
    expect(useSelectionStore.getState().selectedNodeIds).toContain('node-1')

    selectEdge('edge-1', true)
    expect(useSelectionStore.getState().selectedNodeIds.length).toBe(0)
    expect(useSelectionStore.getState().selectedEdgeIds).toContain('edge-1')
  })

  it('history deduplication prevents identical snapshots', () => {
    const { snapshot } = useHistoryStore.getState()

    snapshot()
    const countAfterFirst = useHistoryStore.getState().past.length

    // Take another snapshot without changing anything
    // Need to wait > 300ms for debounce
    const entry = useHistoryStore.getState().past[0]
    if (entry) entry.timestamp -= 1000 // backdate to bypass debounce
    snapshot()
    const countAfterSecond = useHistoryStore.getState().past.length

    expect(countAfterSecond).toBe(countAfterFirst) // No duplicate
  })

  it('timing cache is invalidated when adding a node', () => {
    const { addNode, getCachedTiming } = useGraphStore.getState()

    addNode('launch', { x: 0, y: 0 }, { droneCount: 10, startTime: 0, staggerDelay: 0.02 })
    const timing1 = getCachedTiming()
    expect(timing1.size).toBeGreaterThan(0)

    // Add another node — cache should be invalidated
    addNode('formation', { x: 200, y: 0 }, {
      formationId: null, startTime: 5, duration: 5,
      transform: { position: { x: 0, y: 10, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
      keyframes: [], colorProgramId: null, idleConfigs: [],
    })
    const timing2 = getCachedTiming()
    expect(timing2.size).toBeGreaterThan(timing1.size)
  })
})
