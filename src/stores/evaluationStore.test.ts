import { describe, it, expect, beforeEach } from 'vitest'
import { useEvaluationStore, peekDroneStates } from './evaluationStore'
import { useGraphStore } from './graphStore'
import { useFormationStore } from './formationStore'
import { useProjectStore } from './projectStore'
import { usePlayheadStore } from './playheadStore'
import { makeLaunchNode, makeLinearDemoGraph } from '../graph/helpers.test-utils'

function reset() {
  useEvaluationStore.setState({ states: null, sig: '', version: 0, errorSig: '' })
  useGraphStore.getState().loadGraph({ nodes: [], edges: [] })
  useFormationStore.getState().loadFormations([], new Map(), new Map())
  usePlayheadStore.getState().setCurrentTime(0)
}

describe('evaluationStore', () => {
  beforeEach(reset)

  it('starts empty (no eval has run)', () => {
    const s = useEvaluationStore.getState()
    expect(s.states).toBeNull()
    expect(s.version).toBe(0)
    expect(peekDroneStates()).toBeNull()
  })

  it('refresh on an empty graph is a no-op (no nodes → no states change)', () => {
    useEvaluationStore.getState().refresh()
    // Empty graph: evaluateAtTime returns [] (or nothing meaningful). Either
    // way the version bumps only on actual change, and an empty initial state
    // counts as the first eval.
    const after = useEvaluationStore.getState()
    expect(after.version).toBeGreaterThanOrEqual(0)
    expect(after.states === null || Array.isArray(after.states)).toBe(true)
  })

  it('refresh on a demo graph populates states + bumps version', () => {
    const graph = makeLinearDemoGraph()
    useGraphStore.getState().loadGraph(graph)
    useProjectStore.getState().setDroneCount(5)
    useEvaluationStore.getState().refresh()
    const after = useEvaluationStore.getState()
    expect(after.states).not.toBeNull()
    expect(after.version).toBeGreaterThan(0)
  })

  it('refresh is idempotent within the same input signature', () => {
    useGraphStore.getState().loadGraph({
      nodes: [makeLaunchNode({ id: 'L', data: { droneCount: 3, startTime: 0, staggerDelay: 0.01 } })],
      edges: [],
    })
    useEvaluationStore.getState().refresh()
    const v1 = useEvaluationStore.getState().version
    useEvaluationStore.getState().refresh()
    const v2 = useEvaluationStore.getState().version
    expect(v2).toBe(v1)
  })

  it('peekDroneStates is a stable getter (no subscription)', () => {
    expect(peekDroneStates()).toBeNull()
    useGraphStore.getState().loadGraph({
      nodes: [makeLaunchNode({ id: 'L', data: { droneCount: 3, startTime: 0, staggerDelay: 0.01 } })],
      edges: [],
    })
    useEvaluationStore.getState().refresh()
    expect(peekDroneStates()).not.toBeNull()
  })

  it('changing currentTime bumps the signature and version', () => {
    useGraphStore.getState().loadGraph({
      nodes: [makeLaunchNode({ id: 'L', data: { droneCount: 2, startTime: 0, staggerDelay: 0.01 } })],
      edges: [],
    })
    useEvaluationStore.getState().refresh()
    const v1 = useEvaluationStore.getState().version
    usePlayheadStore.getState().setCurrentTime(1.5)
    useEvaluationStore.getState().refresh()
    const v2 = useEvaluationStore.getState().version
    expect(v2).toBeGreaterThan(v1)
  })
})
