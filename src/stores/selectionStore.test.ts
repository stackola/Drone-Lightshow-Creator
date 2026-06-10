import { describe, it, expect, beforeEach } from 'vitest'
import { useSelectionStore } from './selectionStore'

function resetStore() {
  useSelectionStore.setState({
    selectedNodeIds: [],
    selectedEdgeIds: [],
    selectionType: 'none',
    hoveredNodeId: null,
  })
}

describe('selectionStore', () => {
  beforeEach(resetStore)

  it('starts empty', () => {
    const s = useSelectionStore.getState()
    expect(s.selectedNodeIds).toEqual([])
    expect(s.selectedEdgeIds).toEqual([])
    expect(s.selectionType).toBe('none')
    expect(s.hoveredNodeId).toBeNull()
  })

  it('selectNode replaces selection by default', () => {
    const s = useSelectionStore.getState()
    s.selectNode('a')
    s.selectNode('b')
    expect(useSelectionStore.getState().selectedNodeIds).toEqual(['b'])
    expect(useSelectionStore.getState().selectionType).toBe('node')
  })

  it('selectNode additive toggles', () => {
    const s = useSelectionStore.getState()
    s.selectNode('a')
    s.selectNode('b', true)
    expect(useSelectionStore.getState().selectedNodeIds).toEqual(['a', 'b'])
    // Re-toggle: should remove a.
    useSelectionStore.getState().selectNode('a', true)
    expect(useSelectionStore.getState().selectedNodeIds).toEqual(['b'])
  })

  it('selectEdge clears nodes (replace mode)', () => {
    const s = useSelectionStore.getState()
    s.selectNode('a')
    s.selectEdge('e1')
    expect(useSelectionStore.getState().selectedNodeIds).toEqual([])
    expect(useSelectionStore.getState().selectedEdgeIds).toEqual(['e1'])
    expect(useSelectionStore.getState().selectionType).toBe('edge')
  })

  it('selectNodes replaces both nodes + edges', () => {
    const s = useSelectionStore.getState()
    s.selectEdge('e1')
    s.selectNodes(['a', 'b', 'c'])
    expect(useSelectionStore.getState().selectedNodeIds).toEqual(['a', 'b', 'c'])
    expect(useSelectionStore.getState().selectedEdgeIds).toEqual([])
  })

  it('clearSelection resets type to none', () => {
    const s = useSelectionStore.getState()
    s.selectNode('a')
    s.clearSelection()
    const after = useSelectionStore.getState()
    expect(after.selectedNodeIds).toEqual([])
    expect(after.selectedEdgeIds).toEqual([])
    expect(after.selectionType).toBe('none')
  })

  it('setSelection sets both halves + derives type=mixed when both populated', () => {
    const s = useSelectionStore.getState()
    s.setSelection(['a'], ['e1'])
    expect(useSelectionStore.getState().selectionType).toBe('mixed')
  })

  it('B-09: setHoveredNode is independent of selectedNodeIds', () => {
    const s = useSelectionStore.getState()
    s.selectNode('a')
    s.setHoveredNode('b')
    const after = useSelectionStore.getState()
    expect(after.selectedNodeIds).toEqual(['a'])
    expect(after.hoveredNodeId).toBe('b')
    // Clearing the hover doesn't touch selection.
    useSelectionStore.getState().setHoveredNode(null)
    expect(useSelectionStore.getState().hoveredNodeId).toBeNull()
    expect(useSelectionStore.getState().selectedNodeIds).toEqual(['a'])
  })
})
