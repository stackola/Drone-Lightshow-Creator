import { describe, it, expect } from 'vitest'
import { serializeProject, deserializeProject, verifyRoundTrip } from './serialize'
import { makeLinearDemoGraph } from './helpers.test-utils'
import type { ShowGraph } from './types'
import {
  makeLaunchNode,
  makeFormationNode,
  makeLandNode,
  makeFlowEdge,
} from './helpers.test-utils'

describe('S7-06: serialization', () => {
  it('round-trip exact for linear demo graph', () => {
    const graph = makeLinearDemoGraph()
    expect(verifyRoundTrip(graph)).toBe(true)
  })

  it('round-trip exact for split/merge graph', () => {
    const graph: ShowGraph = {
      nodes: [
        makeLaunchNode({ id: 'launch' }),
        makeFormationNode({ id: 'f1' }),
        makeFormationNode({ id: 'f2' }),
        makeFormationNode({ id: 'f3' }),
        makeLandNode({ id: 'land' }),
      ],
      edges: [
        makeFlowEdge('e1', 'launch', 'f1'),
        makeFlowEdge('e2', 'launch', 'f2'),
        makeFlowEdge('e3', 'f1', 'f3'),
        makeFlowEdge('e4', 'f2', 'f3'),
        makeFlowEdge('e5', 'f3', 'land'),
      ],
    }
    expect(verifyRoundTrip(graph)).toBe(true)
  })

  it('serialize produces valid JSON', () => {
    const graph = makeLinearDemoGraph()
    const meta = { id: 'p1', name: 'Test', createdAt: '2024-01-01', modifiedAt: '2024-01-01' }
    const json = serializeProject(graph, meta)
    const parsed = JSON.parse(json)
    expect(parsed.version).toBe(2)
    expect(parsed.graph.nodes).toHaveLength(graph.nodes.length)
    expect(parsed.graph.edges).toHaveLength(graph.edges.length)
    expect(parsed.meta?.name).toBe('Test')
  })

  it('deserialize restores identical graph', () => {
    const graph = makeLinearDemoGraph()
    const json = serializeProject(graph)
    const { graph: restored } = deserializeProject(json)
    expect(restored.nodes).toHaveLength(graph.nodes.length)
    expect(restored.edges).toHaveLength(graph.edges.length)
    expect(restored.nodes[0]!.id).toBe(graph.nodes[0]!.id)
  })

  it('deserialize rejects invalid version', () => {
    const json = JSON.stringify({ version: 99, graph: { nodes: [], edges: [] } })
    expect(() => deserializeProject(json)).toThrow('Unsupported')
  })

  it('deserialize rejects missing nodes/edges', () => {
    const json = JSON.stringify({ version: 2, graph: {} })
    expect(() => deserializeProject(json)).toThrow('Invalid')
  })

  it('deserialize supports legacy v1 format', () => {
    const graph = makeLinearDemoGraph()
    const json = JSON.stringify({ version: 1, graph, meta: { name: 'Legacy' } })
    const result = deserializeProject(json)
    expect(result.graph.nodes).toHaveLength(graph.nodes.length)
  })

  it('round-trip preserves full project data', () => {
    const graph = makeLinearDemoGraph()
    const meta = { id: 'p1', name: 'Test', createdAt: '2024-01-01', modifiedAt: '2024-01-01' }
    const dronePool = { droneCount: 50, launchLayout: 'grid' as const, spacing: 2, homePositions: [{ x: 0, y: 0, z: 0 }] }
    const constraints = { maxVelocity: 8, maxAcceleration: 4, minDroneDistance: 1.5, altitudeMin: 0, altitudeMax: 120, geofenceRadius: 200, maxFlightTime: 1200, windSpeed: 0, maxJerk: 20, maxAscentRate: 4, maxDescentRate: 3, windGustFactor: 1.5, safetyMarginVelocity: 0.1, safetyMarginSpacing: 0.5, batteryReserve: 0.15, gpsAccuracy: 1.5, geofencePolygon: [] }
    const formations = [{ id: 'f1', name: 'Ring', type: 'static' as const, generatorId: 'ring', parameters: { count: 50 }, pointCount: 50, tags: [] }]
    const formationPoints = new Map([['f1', [{ x: 1, y: 0, z: 0 }]]])
    const json = serializeProject(graph, meta, dronePool, constraints, formations, formationPoints)
    const result = deserializeProject(json)
    expect(result.meta?.name).toBe('Test')
    expect(result.dronePool?.droneCount).toBe(50)
    expect(result.constraints?.maxVelocity).toBe(8)
    expect(result.formations).toHaveLength(1)
    expect(result.formationPoints?.get('f1')).toHaveLength(1)
  })

  it('round-trip preserves manual allocation modes', () => {
    const graph: ShowGraph = {
      nodes: [
        makeLaunchNode({ id: 'a' }),
        makeFormationNode({ id: 'b' }),
        makeFormationNode({ id: 'c' }),
      ],
      edges: [
        makeFlowEdge('e1', 'a', 'b', { mode: 'manual-count', count: 30 }),
        makeFlowEdge('e2', 'a', 'c', { mode: 'manual-percent', percent: 70 }),
      ],
    }
    const json = serializeProject(graph)
    const { graph: restored } = deserializeProject(json)
    expect(restored.edges[0]!.allocation).toEqual({ mode: 'manual-count', count: 30 })
    expect(restored.edges[1]!.allocation).toEqual({ mode: 'manual-percent', percent: 70 })
  })

  it('round-trip preserves cubic-bezier keyframe configs', () => {
    const formationNode = makeFormationNode({ id: 'f1' })
    const fd = formationNode.data as { keyframes: unknown[] }
    fd.keyframes = [
      {
        id: 'kf1',
        time: 1,
        transform: {
          position: { x: 0, y: 10, z: 0 },
          rotation: { x: 0, y: 0, z: 0 },
          scale: { x: 1, y: 1, z: 1 },
        },
        easing: 'cubic-bezier',
        bezierConfig: { x1: 0.17, y1: 0.84, x2: 0.44, y2: 1 },
      },
    ]
    const graph: ShowGraph = { nodes: [formationNode], edges: [] }
    const json = serializeProject(graph)
    const { graph: restored } = deserializeProject(json)
    const restoredKfs = (restored.nodes[0]!.data as { keyframes: { easing: string; bezierConfig: { x1: number; y1: number; x2: number; y2: number } }[] }).keyframes
    expect(restoredKfs[0]!.easing).toBe('cubic-bezier')
    expect(restoredKfs[0]!.bezierConfig).toEqual({ x1: 0.17, y1: 0.84, x2: 0.44, y2: 1 })
  })

  it('round-trips build planes (each curve type) + active plane', () => {
    const graph = makeLinearDemoGraph()
    const planes = [
      { id: 'pa', name: 'Ground', position: { x: 0, y: 0, z: 0 }, rotationDeg: { x: -90, y: 0, z: 0 }, size: 20, cellSize: 1, curvature: { type: 'flat' as const, amount: 0, axis: 'x' as const }, locked: false, visible: true },
      { id: 'pb', name: 'Wrap', position: { x: 5, y: 2, z: 0 }, rotationDeg: { x: 0, y: 0, z: 0 }, size: 30, cellSize: 2, curvature: { type: 'cylinder' as const, amount: 0.05, axis: 'x' as const }, locked: true, visible: true },
      { id: 'pc', name: 'Dome', position: { x: 0, y: 0, z: 0 }, rotationDeg: { x: -90, y: 0, z: 0 }, size: 40, cellSize: 1, curvature: { type: 'dome' as const, amount: 0.03, axis: 'x' as const }, locked: false, visible: false },
      { id: 'pd', name: 'Wave', position: { x: 0, y: 0, z: 0 }, rotationDeg: { x: 0, y: 0, z: 0 }, size: 20, cellSize: 1, curvature: { type: 'wave' as const, amount: 2, axis: 'z' as const, wavelength: 8 }, locked: false, visible: true },
    ]
    const json = serializeProject(graph, undefined, undefined, undefined, undefined, undefined, undefined, planes, 'pb')
    const result = deserializeProject(json)
    expect(result.planes).toHaveLength(4)
    expect(result.planes?.[1]).toEqual(planes[1])
    expect(result.activePlaneId).toBe('pb')
  })

  it('loads v2 files without planes as undefined (back-compat)', () => {
    const graph = makeLinearDemoGraph()
    const json = serializeProject(graph)
    const result = deserializeProject(json)
    expect(result.planes).toBeUndefined()
    expect(result.activePlaneId).toBeUndefined()
  })
})
