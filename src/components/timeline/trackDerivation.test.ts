import { describe, it, expect, beforeEach } from 'vitest'
import { useGraphStore } from '../../stores/graphStore'
import { deriveTracks } from './trackDerivation'
import type { LaunchNodeData, FormationNodeData, LandNodeData } from '../../graph/types'

function resetStore() {
  useGraphStore.setState({ nodes: [], edges: [] })
}

function addLaunch(startTime = 0): string {
  return useGraphStore.getState().addNode('launch', { x: 0, y: 0 }, {
    droneCount: 50, startTime, staggerDelay: 0.02,
  } as LaunchNodeData)
}

function addFormation(startTime: number): string {
  return useGraphStore.getState().addNode('formation', { x: startTime * 100, y: 0 }, {
    formationId: null, startTime, duration: 5,
    transform: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
    keyframes: [], colorProgramId: null, idleConfigs: [],
  } as FormationNodeData)
}

function addLand(startTime: number): string {
  return useGraphStore.getState().addNode('land', { x: startTime * 100, y: 0 }, {
    staggerDelay: 0.02, startTime,
  } as unknown as LandNodeData)
}

function connect(a: string, b: string) {
  const id = useGraphStore.getState().addEdge(a, 'flow-out', b, 'flow-in', 'flow')
  expect(id).toBeTruthy()
}

function graph() {
  const s = useGraphStore.getState()
  return { nodes: s.nodes, edges: s.edges }
}

describe('deriveTracks', () => {
  beforeEach(resetStore)

  it('a linear chain becomes one track in flow order', () => {
    const l = addLaunch(0)
    const f1 = addFormation(5)
    const f2 = addFormation(15)
    const land = addLand(25)
    connect(l, f1)
    connect(f1, f2)
    connect(f2, land)
    const tracks = deriveTracks(graph())
    expect(tracks).toHaveLength(1)
    expect(tracks[0]!.nodeIds).toEqual([l, f1, f2, land])
    expect(tracks[0]!.kind).toBe('flow')
  })

  it('a split spawns a second track from the extra branch', () => {
    const l = addLaunch(0)
    const a = addFormation(5)
    const b = addFormation(5)
    connect(l, a)
    connect(l, b)
    const tracks = deriveTracks(graph())
    expect(tracks).toHaveLength(2)
    expect(tracks[0]!.nodeIds).toEqual([l, a])
    expect(tracks[1]!.nodeIds).toEqual([b])
  })

  it('a merge keeps the target on the first claiming track', () => {
    const l = addLaunch(0)
    const a = addFormation(5)
    const b = addFormation(5)
    const m = addFormation(15)
    connect(l, a)
    connect(l, b)
    connect(a, m)
    connect(b, m)
    const tracks = deriveTracks(graph())
    expect(tracks).toHaveLength(2)
    expect(tracks[0]!.nodeIds).toEqual([l, a, m])
    expect(tracks[1]!.nodeIds).toEqual([b])
  })

  it('orphans collect into a trailing unwired track, time-ordered', () => {
    const l = addLaunch(0)
    const f = addFormation(5)
    connect(l, f)
    const o2 = addFormation(20)
    const o1 = addFormation(10)
    const tracks = deriveTracks(graph())
    expect(tracks).toHaveLength(2)
    expect(tracks[1]!.kind).toBe('unwired')
    expect(tracks[1]!.nodeIds).toEqual([o1, o2])
  })

  it('group nodes are excluded', () => {
    const l = addLaunch(0)
    const f = addFormation(5)
    connect(l, f)
    useGraphStore.getState().addGroup('G', '#fff', [f])
    const tracks = deriveTracks(graph())
    expect(tracks.flatMap((t) => t.nodeIds)).toHaveLength(2)
  })
})
