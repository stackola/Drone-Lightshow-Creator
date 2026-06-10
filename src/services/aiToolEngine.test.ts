// ============================================================================
// S26 Tests: AI Tool Engine — tool registry, execution, read tools
// ============================================================================

import { describe, it, expect } from 'vitest'
import {
  getTool,
  getAllTools,
  getToolDefinitions,
  executeTool,
  generateShowSummary,
} from './aiToolEngine'
import { useGraphStore } from '../stores/graphStore'
import { useProjectStore } from '../stores/projectStore'
import { useFormationStore } from '../stores/formationStore'
import { initRegistries } from '../registries/init'
import type { LaunchNodeData, FormationNodeData, LandNodeData } from '../graph/types'

// Initialize registries once
initRegistries()

function resetStores() {
  useGraphStore.getState().loadGraph({ nodes: [], edges: [] })
  useProjectStore.getState().setDroneCount(50)
}

function seedBasicShow() {
  resetStores()
  const graph = useGraphStore.getState()
  const formStore = useFormationStore.getState()

  const ringId = formStore.addFormation('Test Ring', 'ring', { count: 50, radius: 10 })

  const launchId = graph.addNode('launch', { x: 0, y: 100 }, {
    droneCount: 50, startTime: 0, staggerDelay: 0.02,
  } as LaunchNodeData)

  const formId = graph.addNode('formation', { x: 200, y: 100 }, {
    formationId: ringId, startTime: 3, duration: 5,
    transform: { position: { x: 0, y: 15, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
    keyframes: [], colorProgramId: null, idleConfigs: [],
  } as FormationNodeData)

  const landId = graph.addNode('land', { x: 400, y: 100 }, {
    staggerDelay: 0.02,
  } as LandNodeData)

  graph.addEdge(launchId, 'flow-out', formId, 'flow-in', 'flow')
  graph.addEdge(formId, 'flow-out', landId, 'flow-in', 'flow')

  return { launchId, formId, landId, ringId }
}

// ── S26-01/02: Tool Definition + Registry ───────────────────────────────────

describe('Tool Registry', () => {
  it('getTool returns registered tool', () => {
    const tool = getTool('get_show_summary')
    expect(tool).toBeDefined()
    expect(tool!.name).toBe('get_show_summary')
  })

  it('getAllTools returns all registered tools', () => {
    const tools = getAllTools()
    expect(tools.length).toBeGreaterThanOrEqual(14) // 14 read tools minimum
  })

  it('getToolDefinitions returns Claude API format', () => {
    const defs = getToolDefinitions()
    expect(defs.length).toBeGreaterThanOrEqual(14)
    for (const def of defs) {
      expect(def.name).toBeTruthy()
      expect(def.description).toBeTruthy()
      expect(def.input_schema.type).toBe('object')
    }
  })
})

// ── S26-03: executeTool dispatcher ──────────────────────────────────────────

describe('executeTool', () => {
  it('returns error for unknown tool', () => {
    const result = executeTool('nonexistent_tool', {})
    expect(result.success).toBe(false)
    expect(result.error).toContain('Unknown tool')
  })

  it('validates required params', () => {
    const result = executeTool('get_node', {}) // missing nodeId
    expect(result.success).toBe(false)
    expect(result.error).toContain('Missing required parameter')
  })

  it('executes valid tool call', () => {
    seedBasicShow()
    const result = executeTool('get_show_summary', {})
    expect(result.success).toBe(true)
    expect(result.data).toBeDefined()
  })
})

// ── S26-05: generateShowSummary ─────────────────────────────────────────────

describe('generateShowSummary', () => {
  it('returns a string with key info', () => {
    seedBasicShow()
    const summary = generateShowSummary()
    expect(summary).toContain('Project:')
    expect(summary).toContain('Drones: 50')
    expect(summary).toContain('Duration:')
    expect(summary).toContain('Test Ring')
    expect(summary).toContain('launch')
    expect(summary).toContain('formation')
    expect(summary).toContain('land')
  })

  it('works with empty graph', () => {
    resetStores()
    const summary = generateShowSummary()
    expect(summary).toContain('Nodes: 0')
    expect(summary).toContain('Duration: 0')
  })
})

// ── S26-07: get_show_summary ────────────────────────────────────────────────

describe('get_show_summary tool', () => {
  it('returns correct counts', () => {
    seedBasicShow()
    const result = executeTool('get_show_summary', {})
    expect(result.success).toBe(true)
    const data = result.data as Record<string, unknown>
    expect(data.droneCount).toBe(50)
    expect(data.nodeCount).toBe(3) // launch + formation + land
    expect(data.formationCount).toBeGreaterThanOrEqual(1)
    expect(typeof data.duration).toBe('number')
  })
})

// ── S26-08: get_graph ───────────────────────────────────────────────────────

describe('get_graph tool', () => {
  it('returns nodes and edges', () => {
    seedBasicShow()
    const result = executeTool('get_graph', {})
    expect(result.success).toBe(true)
    const data = result.data as { nodes: unknown[]; edges: unknown[] }
    expect(data.nodes.length).toBe(3)
    expect(data.edges.length).toBe(2)
  })
})

// ── S26-09: get_node ────────────────────────────────────────────────────────

describe('get_node tool', () => {
  it('returns node by ID', () => {
    const { launchId } = seedBasicShow()
    const result = executeTool('get_node', { nodeId: launchId })
    expect(result.success).toBe(true)
    expect((result.data as { type: string }).type).toBe('launch')
  })

  it('returns error for missing node', () => {
    seedBasicShow()
    const result = executeTool('get_node', { nodeId: 'nonexistent' })
    expect(result.success).toBe(false)
    expect(result.error).toContain('not found')
  })
})

// ── S26-10: get_timing ──────────────────────────────────────────────────────

describe('get_timing tool', () => {
  it('returns timing for all nodes', () => {
    const { launchId, formId, landId } = seedBasicShow()
    const result = executeTool('get_timing', {})
    expect(result.success).toBe(true)
    const data = result.data as Record<string, { start: number; end: number }>
    expect(data[launchId]).toBeDefined()
    expect(data[formId]).toBeDefined()
    expect(data[landId]).toBeDefined()
    // Authored startTime 3, but launch ends at 3.0 and the default edge
    // transition (preferredDuration 2s) cascade-pushes the formation to start=5.
    expect(data[formId]!.start).toBe(5)
    expect(data[formId]!.end).toBe(10) // 5 + duration 5
  })
})

// ── S26-11: get_formations ──────────────────────────────────────────────────

describe('get_formations tool', () => {
  it('returns formation list', () => {
    seedBasicShow()
    const result = executeTool('get_formations', {})
    expect(result.success).toBe(true)
    const data = result.data as Array<{ name: string; pointCount: number }>
    const ring = data.find((f) => f.name === 'Test Ring')
    expect(ring).toBeDefined()
    expect(ring!.pointCount).toBe(50)
  })
})

// ── S26-12: get_formation_points ────────────────────────────────────────────

describe('get_formation_points tool', () => {
  it('returns Vec3 array for valid formation', () => {
    const { ringId } = seedBasicShow()
    const result = executeTool('get_formation_points', { formationId: ringId })
    expect(result.success).toBe(true)
    const points = result.data as Array<{ x: number; y: number; z: number }>
    expect(points.length).toBe(50)
    expect(typeof points[0]!.x).toBe('number')
  })

  it('returns error for unknown formation', () => {
    const result = executeTool('get_formation_points', { formationId: 'bad-id' })
    expect(result.success).toBe(false)
  })
})

// ── S26-13: get_violations ──────────────────────────────────────────────────

describe('get_violations tool', () => {
  it('returns violations array', () => {
    seedBasicShow()
    const result = executeTool('get_violations', {})
    expect(result.success).toBe(true)
    expect(Array.isArray(result.data)).toBe(true)
  })
})

// ── S26-14: get_constraints ─────────────────────────────────────────────────

describe('get_constraints tool', () => {
  it('returns constraints object', () => {
    const result = executeTool('get_constraints', {})
    expect(result.success).toBe(true)
    const data = result.data as Record<string, unknown>
    expect(data.maxVelocity).toBe(8)
    expect(data.minDroneDistance).toBe(1.5)
  })
})

// ── S26-15: get_drone_pool ──────────────────────────────────────────────────

describe('get_drone_pool tool', () => {
  it('returns drone pool config', () => {
    seedBasicShow()
    const result = executeTool('get_drone_pool', {})
    expect(result.success).toBe(true)
    const data = result.data as Record<string, unknown>
    expect(data.droneCount).toBe(50)
    expect(data.launchLayout).toBe('grid')
  })
})

// ── S26-16: evaluate_at_time ────────────────────────────────────────────────

describe('evaluate_at_time tool', () => {
  it('returns drone states at given time', () => {
    seedBasicShow()
    const result = executeTool('evaluate_at_time', { time: 5 })
    expect(result.success).toBe(true)
    const data = result.data as { droneCount: number; drones: unknown[] }
    expect(data.droneCount).toBe(50)
    expect(data.drones.length).toBeLessThanOrEqual(50)
  })

  it('rejects negative time', () => {
    const result = executeTool('evaluate_at_time', { time: -1 })
    expect(result.success).toBe(false)
  })
})

// ── S26-17: get_available_generators ────────────────────────────────────────

describe('get_available_generators tool', () => {
  it('returns generator list with params', () => {
    const result = executeTool('get_available_generators', {})
    expect(result.success).toBe(true)
    const data = result.data as Array<{ id: string; name: string; defaultParams: Record<string, number> }>
    expect(data.length).toBeGreaterThanOrEqual(7) // ring, grid, sphere, spiral, line, heart, star
    const ring = data.find((g) => g.id === 'ring')
    expect(ring).toBeDefined()
    expect(ring!.defaultParams).toHaveProperty('count')
    expect(ring!.defaultParams).toHaveProperty('radius')
  })
})

// ── S26-18: get_available_transitions ───────────────────────────────────────

describe('get_available_transitions tool', () => {
  it('returns transition list', () => {
    const result = executeTool('get_available_transitions', {})
    expect(result.success).toBe(true)
    const data = result.data as Array<{ id: string; name: string }>
    expect(data.length).toBeGreaterThanOrEqual(10) // shortest-path, ant-walk, stagger, spiral, explosion, implosion, cascade, morph, color-sweep, bounce
    expect(data.find((t) => t.id === 'shortest-path')).toBeDefined()
    expect(data.find((t) => t.id === 'explosion')).toBeDefined()
  })
})

// ── S26-19: get_available_idle_behaviors ────────────────────────────────────

describe('get_available_idle_behaviors tool', () => {
  it('returns behavior list', () => {
    const result = executeTool('get_available_idle_behaviors', {})
    expect(result.success).toBe(true)
    const data = result.data as Array<{ id: string; name: string }>
    expect(data.length).toBeGreaterThanOrEqual(10) // hover, orbit, figure8, breathe, swarm, sparkle, pulse, wave, spin, drift
    expect(data.find((b) => b.id === 'hover')).toBeDefined()
    expect(data.find((b) => b.id === 'sparkle')).toBeDefined()
  })
})

// ── S26-20: get_available_color_programs ────────────────────────────────────

describe('get_available_color_programs tool', () => {
  it('returns color program list', () => {
    const result = executeTool('get_available_color_programs', {})
    expect(result.success).toBe(true)
    const data = result.data as Array<{ id: string; name: string; type: string }>
    expect(data.length).toBeGreaterThanOrEqual(10) // 10 default programs
    expect(data.find((p) => p.id === 'rainbow')).toBeDefined()
    expect(data.find((p) => p.id === 'solid-red')).toBeDefined()
  })
})
