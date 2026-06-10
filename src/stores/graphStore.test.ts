import { describe, it, expect, beforeEach } from 'vitest'
import { useGraphStore } from './graphStore'
import type { LaunchNodeData, FormationNodeData, IdleNodeData, LandNodeData, GroupNodeData } from '../graph/types'

function resetStore() {
  useGraphStore.setState({ nodes: [], edges: [] })
}

describe('S1-01: graphStore — node CRUD', () => {
  beforeEach(resetStore)

  it('addNode creates a launch node and returns its ID', () => {
    const data: LaunchNodeData = { droneCount: 100, startTime: 0, staggerDelay: 0.02 }
    const id = useGraphStore.getState().addNode('launch', { x: 0, y: 0 }, data)
    expect(id).toBeTruthy()
    const node = useGraphStore.getState().getNode(id)
    expect(node).toBeDefined()
    expect(node!.type).toBe('launch')
    expect((node!.data as LaunchNodeData).droneCount).toBe(100)
  })

  it('addNode creates formation, idle, land, group nodes', () => {
    const store = useGraphStore.getState()
    const fId = store.addNode('formation', { x: 100, y: 0 }, {
      formationId: null, startTime: 3, duration: 5,
      transform: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
      keyframes: [], colorProgramId: null, idleConfigs: [],
    } as FormationNodeData)
    const iId = store.addNode('idle', { x: 300, y: 0 }, {
      behavior: 'hover', center: { x: 0, y: 0, z: 0 }, radius: 5, speed: 1, altitude: 10,
      startTime: 3, duration: 5, colorProgramId: null,
    } as IdleNodeData)
    const lId = store.addNode('land', { x: 400, y: 0 }, { staggerDelay: 0.02 } as LandNodeData)
    const gId = store.addNode('group', { x: 0, y: 0 }, {
      label: 'G', color: '#fff', collapsed: false, showInternalEdges: true,
    } as GroupNodeData)

    expect(useGraphStore.getState().nodes).toHaveLength(4)
    expect(useGraphStore.getState().getNode(fId)!.type).toBe('formation')
    expect(useGraphStore.getState().getNode(iId)!.type).toBe('idle')
    expect(useGraphStore.getState().getNode(lId)!.type).toBe('land')
    expect(useGraphStore.getState().getNode(gId)!.type).toBe('group')
  })

  it('addEdge populates default transition on flow edges', () => {
    const store = useGraphStore.getState()
    const launchId = store.addNode('launch', { x: 0, y: 0 }, { droneCount: 50, startTime: 0, staggerDelay: 0.02 } as LaunchNodeData)
    const formId = store.addNode('formation', { x: 100, y: 0 }, {
      formationId: null, startTime: 3, duration: 5,
      transform: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
      keyframes: [], colorProgramId: null, idleConfigs: [],
    } as FormationNodeData)
    const edgeId = store.addEdge(launchId, 'flow-out', formId, 'flow-in', 'flow')!
    const edge = useGraphStore.getState().edges.find((e) => e.id === edgeId)!
    expect(edge.transition).toBeDefined()
    expect(edge.transition!.strategyId).toBeTruthy()
    expect(typeof edge.transition!.preferredDuration).toBe('number')
  })

  it('updateEdgeTransition merges patch into edge.transition', () => {
    const store = useGraphStore.getState()
    const launchId = store.addNode('launch', { x: 0, y: 0 }, { droneCount: 50, startTime: 0, staggerDelay: 0.02 } as LaunchNodeData)
    const formId = store.addNode('formation', { x: 100, y: 0 }, {
      formationId: null, startTime: 3, duration: 5,
      transform: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
      keyframes: [], colorProgramId: null, idleConfigs: [],
    } as FormationNodeData)
    const edgeId = store.addEdge(launchId, 'flow-out', formId, 'flow-in', 'flow')!
    useGraphStore.getState().updateEdgeTransition(edgeId, { strategyId: 'ant-walk', preferredDuration: 4 })
    const edge = useGraphStore.getState().edges.find((e) => e.id === edgeId)!
    expect(edge.transition!.strategyId).toBe('ant-walk')
    expect(edge.transition!.preferredDuration).toBe(4)
  })

  it('updateNodeData patches node data', () => {
    const data: LaunchNodeData = { droneCount: 100, startTime: 0, staggerDelay: 0.02 }
    const id = useGraphStore.getState().addNode('launch', { x: 0, y: 0 }, data)
    useGraphStore.getState().updateNodeData(id, { droneCount: 200 } as Partial<LaunchNodeData>)
    const node = useGraphStore.getState().getNode(id)
    expect((node!.data as LaunchNodeData).droneCount).toBe(200)
  })

  it('updateNodePosition changes position without touching data', () => {
    const data: FormationNodeData = {
      formationId: null, startTime: 5, duration: 10,
      transform: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
      keyframes: [], colorProgramId: null, idleConfigs: [],
    }
    const id = useGraphStore.getState().addNode('formation', { x: 100, y: 50 }, data)
    useGraphStore.getState().updateNodePosition(id, { x: 500, y: 200 })
    const node = useGraphStore.getState().getNode(id)
    expect(node!.position).toEqual({ x: 500, y: 200 })
    // startTime must NOT change (time authority law)
    expect((node!.data as FormationNodeData).startTime).toBe(5)
  })

  it('removeNode removes node and cascades edges', () => {
    const store = useGraphStore.getState()
    const launchId = store.addNode('launch', { x: 0, y: 0 }, { droneCount: 100, startTime: 0, staggerDelay: 0.02 } as LaunchNodeData)
    const formId = store.addNode('formation', { x: 100, y: 0 }, {
      formationId: null, startTime: 3, duration: 5,
      transform: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
      keyframes: [], colorProgramId: null, idleConfigs: [],
    } as FormationNodeData)
    store.addEdge(launchId, 'flow-out', formId, 'flow-in', 'flow')

    expect(useGraphStore.getState().edges).toHaveLength(1)
    useGraphStore.getState().removeNode(formId)
    expect(useGraphStore.getState().nodes).toHaveLength(1)
    expect(useGraphStore.getState().edges).toHaveLength(0)
  })

  it('getNode returns undefined for non-existent ID', () => {
    expect(useGraphStore.getState().getNode('ghost')).toBeUndefined()
  })

  it('removeNode ungroups children when removing a group', () => {
    const store = useGraphStore.getState()
    const formId = store.addNode('formation', { x: 100, y: 0 }, {
      formationId: null, startTime: 3, duration: 5,
      transform: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
      keyframes: [], colorProgramId: null, idleConfigs: [],
    } as FormationNodeData)
    const groupId = store.addGroup('G', '#fff', [formId])
    expect(useGraphStore.getState().getNode(formId)!.parentId).toBe(groupId)
    useGraphStore.getState().removeNode(groupId)
    expect(useGraphStore.getState().getNode(formId)!.parentId).toBeNull()
  })
})

describe('S1-02: graphStore — edge CRUD', () => {
  beforeEach(resetStore)

  it('addEdge creates valid connection and returns ID', () => {
    const store = useGraphStore.getState()
    const launchId = store.addNode('launch', { x: 0, y: 0 }, { droneCount: 100, startTime: 0, staggerDelay: 0.02 } as LaunchNodeData)
    const formId = store.addNode('formation', { x: 100, y: 0 }, {
      formationId: null, startTime: 3, duration: 5,
      transform: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
      keyframes: [], colorProgramId: null, idleConfigs: [],
    } as FormationNodeData)
    const edgeId = store.addEdge(launchId, 'flow-out', formId, 'flow-in', 'flow')
    expect(edgeId).toBeTruthy()
    expect(useGraphStore.getState().edges).toHaveLength(1)
  })

  it('addEdge rejects invalid connection and returns null', () => {
    const store = useGraphStore.getState()
    const launchId = store.addNode('launch', { x: 0, y: 0 }, { droneCount: 100, startTime: 0, staggerDelay: 0.02 } as LaunchNodeData)
    // Self-loop
    const edgeId = store.addEdge(launchId, 'flow-out', launchId, 'flow-out', 'flow')
    expect(edgeId).toBeNull()
    expect(useGraphStore.getState().edges).toHaveLength(0)
  })

  it('flow recomputes after addEdge', () => {
    const store = useGraphStore.getState()
    const launchId = store.addNode('launch', { x: 0, y: 0 }, { droneCount: 100, startTime: 0, staggerDelay: 0.02 } as LaunchNodeData)
    const formId = store.addNode('formation', { x: 100, y: 0 }, {
      formationId: null, startTime: 3, duration: 5,
      transform: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
      keyframes: [], colorProgramId: null, idleConfigs: [],
    } as FormationNodeData)
    store.addEdge(launchId, 'flow-out', formId, 'flow-in', 'flow')
    const edge = useGraphStore.getState().edges[0]
    expect(edge!.droneCount).toBe(100)
  })

  it('flow recomputes after removeEdge', () => {
    const store = useGraphStore.getState()
    const launchId = store.addNode('launch', { x: 0, y: 0 }, { droneCount: 100, startTime: 0, staggerDelay: 0.02 } as LaunchNodeData)
    const f1 = store.addNode('formation', { x: 100, y: 0 }, {
      formationId: null, startTime: 3, duration: 5,
      transform: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
      keyframes: [], colorProgramId: null, idleConfigs: [],
    } as FormationNodeData)
    const f2 = store.addNode('formation', { x: 100, y: 100 }, {
      formationId: null, startTime: 3, duration: 5,
      transform: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
      keyframes: [], colorProgramId: null, idleConfigs: [],
    } as FormationNodeData)
    const e1 = store.addEdge(launchId, 'flow-out', f1, 'flow-in', 'flow')!
    store.addEdge(launchId, 'flow-out', f2, 'flow-in', 'flow')

    // Both edges get 50
    expect(useGraphStore.getState().edges.find((e) => e.id === e1)!.droneCount).toBe(50)

    // Remove one edge — remaining gets full 100
    useGraphStore.getState().removeEdge(e1)
    expect(useGraphStore.getState().edges).toHaveLength(1)
    expect(useGraphStore.getState().edges[0]!.droneCount).toBe(100)
  })

  it('updateEdgeAllocation triggers reflow', () => {
    const store = useGraphStore.getState()
    const launchId = store.addNode('launch', { x: 0, y: 0 }, { droneCount: 100, startTime: 0, staggerDelay: 0.02 } as LaunchNodeData)
    const f1 = store.addNode('formation', { x: 100, y: 0 }, {
      formationId: null, startTime: 3, duration: 5,
      transform: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
      keyframes: [], colorProgramId: null, idleConfigs: [],
    } as FormationNodeData)
    const f2 = store.addNode('formation', { x: 100, y: 100 }, {
      formationId: null, startTime: 3, duration: 5,
      transform: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
      keyframes: [], colorProgramId: null, idleConfigs: [],
    } as FormationNodeData)
    const e1 = store.addEdge(launchId, 'flow-out', f1, 'flow-in', 'flow')!
    store.addEdge(launchId, 'flow-out', f2, 'flow-in', 'flow')

    useGraphStore.getState().updateEdgeAllocation(e1, { mode: 'manual-count', count: 30 })
    const edges = useGraphStore.getState().edges
    expect(edges.find((e) => e.id === e1)!.droneCount).toBe(30)
    const other = edges.find((e) => e.id !== e1)!
    expect(other.droneCount).toBe(70)
  })

  it('getEdgesForNode with direction filter', () => {
    const store = useGraphStore.getState()
    const launchId = store.addNode('launch', { x: 0, y: 0 }, { droneCount: 100, startTime: 0, staggerDelay: 0.02 } as LaunchNodeData)
    const formId = store.addNode('formation', { x: 100, y: 0 }, {
      formationId: null, startTime: 3, duration: 5,
      transform: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
      keyframes: [], colorProgramId: null, idleConfigs: [],
    } as FormationNodeData)
    store.addEdge(launchId, 'flow-out', formId, 'flow-in', 'flow')

    expect(useGraphStore.getState().getEdgesForNode(launchId, 'out')).toHaveLength(1)
    expect(useGraphStore.getState().getEdgesForNode(launchId, 'in')).toHaveLength(0)
    expect(useGraphStore.getState().getEdgesForNode(formId, 'in')).toHaveLength(1)
    expect(useGraphStore.getState().getEdgesForNode(formId)).toHaveLength(1)
  })
})

describe('S1-03: graphStore — attached idle CRUD', () => {
  beforeEach(resetStore)

  it('addAttachedIdle adds idle config and triggers reflow', () => {
    const store = useGraphStore.getState()
    const launchId = store.addNode('launch', { x: 0, y: 0 }, { droneCount: 100, startTime: 0, staggerDelay: 0.02 } as LaunchNodeData)
    const formId = store.addNode('formation', { x: 100, y: 0 }, {
      formationId: null, startTime: 3, duration: 5,
      transform: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
      keyframes: [], colorProgramId: null, idleConfigs: [],
    } as FormationNodeData)
    const landId = store.addNode('land', { x: 200, y: 0 }, { staggerDelay: 0.02 } as LandNodeData)
    store.addEdge(launchId, 'flow-out', formId, 'flow-in', 'flow')
    store.addEdge(formId, 'flow-out', landId, 'flow-in', 'flow')

    // Before idle: outgoing = 100
    expect(useGraphStore.getState().edges.find((e) => e.target === landId)!.droneCount).toBe(100)

    // Add idle config (idle absorbs leftovers at eval time, does NOT reduce flow)
    store.addAttachedIdle(formId, {
      behavior: 'hover', radius: 5, speed: 1, altitude: 10, colorProgramId: null,
    })

    // After idle: outgoing still 100 (idle doesn't reduce flow)
    expect(useGraphStore.getState().edges.find((e) => e.target === landId)!.droneCount).toBe(100)
  })

  it('removeAttachedIdle restores flow', () => {
    const store = useGraphStore.getState()
    const launchId = store.addNode('launch', { x: 0, y: 0 }, { droneCount: 100, startTime: 0, staggerDelay: 0.02 } as LaunchNodeData)
    const formId = store.addNode('formation', { x: 100, y: 0 }, {
      formationId: null, startTime: 3, duration: 5,
      transform: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
      keyframes: [], colorProgramId: null, idleConfigs: [],
    } as FormationNodeData)
    const landId = store.addNode('land', { x: 200, y: 0 }, { staggerDelay: 0.02 } as LandNodeData)
    store.addEdge(launchId, 'flow-out', formId, 'flow-in', 'flow')
    store.addEdge(formId, 'flow-out', landId, 'flow-in', 'flow')

    const idleId = store.addAttachedIdle(formId, {
      behavior: 'hover', radius: 5, speed: 1, altitude: 10, colorProgramId: null,
    })
    // Flow unchanged (idle doesn't reduce flow)
    expect(useGraphStore.getState().edges.find((e) => e.target === landId)!.droneCount).toBe(100)

    useGraphStore.getState().removeAttachedIdle(formId, idleId)
    expect(useGraphStore.getState().edges.find((e) => e.target === landId)!.droneCount).toBe(100)
  })

  it('updateAttachedIdle changes config', () => {
    const store = useGraphStore.getState()
    const formId = store.addNode('formation', { x: 100, y: 0 }, {
      formationId: null, startTime: 3, duration: 5,
      transform: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
      keyframes: [], colorProgramId: null, idleConfigs: [],
    } as FormationNodeData)
    const idleId = store.addAttachedIdle(formId, {
      behavior: 'hover', radius: 5, speed: 1, altitude: 10, colorProgramId: null,
    })
    useGraphStore.getState().updateAttachedIdle(formId, idleId, { radius: 12 })
    const node = useGraphStore.getState().getNode(formId)!
    const data = node.data as FormationNodeData
    expect(data.idleConfigs[0]!.radius).toBe(12)
  })
})

describe('S1-04: graphStore — keyframe CRUD', () => {
  beforeEach(resetStore)

  it('addKeyframe adds and sorts', () => {
    const store = useGraphStore.getState()
    const id = store.addNode('formation', { x: 0, y: 0 }, {
      formationId: null, startTime: 0, duration: 10,
      transform: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
      keyframes: [], colorProgramId: null, idleConfigs: [],
    } as FormationNodeData)
    const tf = { position: { x: 1, y: 1, z: 1 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } }
    store.addKeyframe(id, 5, tf, 'linear')
    store.addKeyframe(id, 2, tf, 'ease-in')
    const data = useGraphStore.getState().getNode(id)!.data as FormationNodeData
    expect(data.keyframes).toHaveLength(2)
    expect(data.keyframes[0]!.time).toBe(2)
    expect(data.keyframes[1]!.time).toBe(5)
  })

  it('addKeyframe replaces at same time (within tolerance)', () => {
    const store = useGraphStore.getState()
    const id = store.addNode('formation', { x: 0, y: 0 }, {
      formationId: null, startTime: 0, duration: 10,
      transform: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
      keyframes: [], colorProgramId: null, idleConfigs: [],
    } as FormationNodeData)
    const tf1 = { position: { x: 1, y: 1, z: 1 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } }
    const tf2 = { position: { x: 2, y: 2, z: 2 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } }
    store.addKeyframe(id, 5, tf1, 'linear')
    store.addKeyframe(id, 5.005, tf2, 'ease-out') // Within 0.01 tolerance
    const data = useGraphStore.getState().getNode(id)!.data as FormationNodeData
    expect(data.keyframes).toHaveLength(1)
    expect(data.keyframes[0]!.transform.position.x).toBe(2)
  })

  it('addKeyframe clamps to duration bounds', () => {
    const store = useGraphStore.getState()
    const id = store.addNode('formation', { x: 0, y: 0 }, {
      formationId: null, startTime: 0, duration: 10,
      transform: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
      keyframes: [], colorProgramId: null, idleConfigs: [],
    } as FormationNodeData)
    const tf = { position: { x: 1, y: 1, z: 1 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } }
    store.addKeyframe(id, 15, tf, 'linear') // Exceeds duration
    const data = useGraphStore.getState().getNode(id)!.data as FormationNodeData
    expect(data.keyframes[0]!.time).toBe(10) // Clamped
  })

  it('removeKeyframe removes by index', () => {
    const store = useGraphStore.getState()
    const id = store.addNode('formation', { x: 0, y: 0 }, {
      formationId: null, startTime: 0, duration: 10,
      transform: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
      keyframes: [], colorProgramId: null, idleConfigs: [],
    } as FormationNodeData)
    const tf = { position: { x: 1, y: 1, z: 1 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } }
    store.addKeyframe(id, 2, tf, 'linear')
    store.addKeyframe(id, 5, tf, 'linear')
    useGraphStore.getState().removeKeyframe(id, 0)
    const data = useGraphStore.getState().getNode(id)!.data as FormationNodeData
    expect(data.keyframes).toHaveLength(1)
    expect(data.keyframes[0]!.time).toBe(5)
  })
})

describe('S1-05: graphStore — group operations', () => {
  beforeEach(resetStore)

  it('addGroup creates group and sets parentId on children', () => {
    const store = useGraphStore.getState()
    const f1 = store.addNode('formation', { x: 0, y: 0 }, {
      formationId: null, startTime: 3, duration: 5,
      transform: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
      keyframes: [], colorProgramId: null, idleConfigs: [],
    } as FormationNodeData)
    const f2 = store.addNode('formation', { x: 100, y: 0 }, {
      formationId: null, startTime: 8, duration: 5,
      transform: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
      keyframes: [], colorProgramId: null, idleConfigs: [],
    } as FormationNodeData)
    const gId = store.addGroup('My Group', '#3b82f6', [f1, f2])
    const state = useGraphStore.getState()
    expect(state.getNode(gId)!.type).toBe('group')
    expect(state.getNode(f1)!.parentId).toBe(gId)
    expect(state.getNode(f2)!.parentId).toBe(gId)
  })

  it('addToGroup / removeFromGroup', () => {
    const store = useGraphStore.getState()
    const f1 = store.addNode('formation', { x: 0, y: 0 }, {
      formationId: null, startTime: 3, duration: 5,
      transform: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
      keyframes: [], colorProgramId: null, idleConfigs: [],
    } as FormationNodeData)
    const gId = store.addGroup('G', '#fff')
    store.addToGroup(gId, f1)
    expect(useGraphStore.getState().getNode(f1)!.parentId).toBe(gId)
    useGraphStore.getState().removeFromGroup(f1)
    expect(useGraphStore.getState().getNode(f1)!.parentId).toBeNull()
  })

  it('collapseGroup / expandGroup toggles collapsed', () => {
    const store = useGraphStore.getState()
    const gId = store.addGroup('G', '#fff')
    expect((useGraphStore.getState().getNode(gId)!.data as GroupNodeData).collapsed).toBe(false)
    useGraphStore.getState().collapseGroup(gId)
    expect((useGraphStore.getState().getNode(gId)!.data as GroupNodeData).collapsed).toBe(true)
    useGraphStore.getState().expandGroup(gId)
    expect((useGraphStore.getState().getNode(gId)!.data as GroupNodeData).collapsed).toBe(false)
  })

  it('removeGroup without deleting children ungroups them', () => {
    const store = useGraphStore.getState()
    const f1 = store.addNode('formation', { x: 0, y: 0 }, {
      formationId: null, startTime: 3, duration: 5,
      transform: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
      keyframes: [], colorProgramId: null, idleConfigs: [],
    } as FormationNodeData)
    const gId = store.addGroup('G', '#fff', [f1])
    useGraphStore.getState().removeGroup(gId, false)
    expect(useGraphStore.getState().getNode(gId)).toBeUndefined()
    expect(useGraphStore.getState().getNode(f1)).toBeDefined()
    expect(useGraphStore.getState().getNode(f1)!.parentId).toBeNull()
  })

  it('removeGroup with deleting children removes everything', () => {
    const store = useGraphStore.getState()
    const f1 = store.addNode('formation', { x: 0, y: 0 }, {
      formationId: null, startTime: 3, duration: 5,
      transform: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
      keyframes: [], colorProgramId: null, idleConfigs: [],
    } as FormationNodeData)
    const gId = store.addGroup('G', '#fff', [f1])
    useGraphStore.getState().removeGroup(gId, true)
    expect(useGraphStore.getState().nodes).toHaveLength(0)
  })
})
