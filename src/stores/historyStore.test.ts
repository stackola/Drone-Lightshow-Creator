import { describe, it, expect, beforeEach } from 'vitest'
import { useHistoryStore, getHistorySummary } from './historyStore'
import { useGraphStore } from './graphStore'
import { useFormationStore } from './formationStore'
import { makeLaunchNode } from '../graph/helpers.test-utils'

function resetHistory() {
  useHistoryStore.setState({ past: [], future: [] })
  // Reset adjacent stores so each test starts with a known small state.
  useGraphStore.getState().loadGraph({ nodes: [], edges: [] })
  useFormationStore.getState().loadFormations([], new Map(), new Map())
}

describe('historyStore', () => {
  beforeEach(resetHistory)

  it('starts with empty past + future', () => {
    expect(useHistoryStore.getState().past).toEqual([])
    expect(useHistoryStore.getState().future).toEqual([])
    expect(useHistoryStore.getState().canUndo()).toBe(false)
    expect(useHistoryStore.getState().canRedo()).toBe(false)
  })

  it('snapshot stores the supplied label', () => {
    useHistoryStore.getState().snapshot('Move Formation')
    // Add a fake graph change so the next snapshot survives dedupe.
    useGraphStore.getState().loadGraph({ nodes: [], edges: [] })
    // Force a real change before second snapshot — even one node makes the
    // dedupe consider this distinct.
    useGraphStore.setState({ nodes: [makeLaunchNode({ id: 'a' })] })
    useHistoryStore.getState().snapshot('Add Launch')
    const past = useHistoryStore.getState().past
    expect(past.length).toBe(2)
    expect(past[0]?.label).toBe('Move Formation')
    expect(past[1]?.label).toBe('Add Launch')
  })

  it('default label is "Edit"', () => {
    useHistoryStore.getState().snapshot()
    const past = useHistoryStore.getState().past
    expect(past[0]?.label).toBe('Edit')
  })

  it('labelForNextUndo returns the most recent past label', () => {
    expect(useHistoryStore.getState().labelForNextUndo()).toBeNull()
    useHistoryStore.getState().snapshot('First')
    useGraphStore.setState({ nodes: [makeLaunchNode({ id: 'a' })] })
    useHistoryStore.getState().snapshot('Second')
    expect(useHistoryStore.getState().labelForNextUndo()).toBe('Second')
  })

  it('canUndo reflects past length, canRedo reflects future', () => {
    useHistoryStore.getState().snapshot('a')
    expect(useHistoryStore.getState().canUndo()).toBe(true)
    expect(useHistoryStore.getState().canRedo()).toBe(false)
  })

  it('deduplicates back-to-back identical snapshots', () => {
    useHistoryStore.getState().snapshot('one')
    useHistoryStore.getState().snapshot('two')
    // Second snapshot is identical to first (no graph change between them),
    // so dedupe should kick in. Same applies to debounce within 300 ms.
    expect(useHistoryStore.getState().past.length).toBe(1)
  })

  it('caps past at maxSteps', () => {
    useHistoryStore.setState({ maxSteps: 3, past: [], future: [] })
    // Append a different number of nodes each time so the dedupe + 300 ms
    // debounce paths (both keyed on nodes.length + edges.length) don't merge
    // the snapshots into one entry.
    for (let i = 0; i < 6; i++) {
      const nodes = Array.from({ length: i + 1 }, (_, k) => makeLaunchNode({ id: `n-${i}-${k}` }))
      useGraphStore.setState({ nodes })
      useHistoryStore.getState().snapshot(`step-${i}`)
    }
    const past = useHistoryStore.getState().past
    expect(past.length).toBe(3)
    // Oldest entries got dropped: only step-3, step-4, step-5 remain.
    expect(past.map((p) => p.label)).toEqual(['step-3', 'step-4', 'step-5'])
  })

  it('getHistorySummary returns light label+timestamp shape', () => {
    useHistoryStore.getState().snapshot('Move Formation')
    useGraphStore.setState({ nodes: [makeLaunchNode({ id: 'b' })] })
    useHistoryStore.getState().snapshot('Add Launch')
    const summary = getHistorySummary()
    expect(summary.past.length).toBe(2)
    expect(summary.past[0]?.label).toBe('Move Formation')
    expect(summary.future.length).toBe(0)
    // Each entry has a numeric timestamp.
    expect(typeof summary.past[0]?.timestamp).toBe('number')
  })
})
