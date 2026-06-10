// ============================================================================
// S26: AI Tool Engine — Tool definitions, registry, execution, show summary
// ============================================================================
// This is the bridge between Claude's tool-calling protocol and the app stores.
// Each tool is a validated, typed function that reads or modifies show state.
//
// Architecture:
//   ToolDefinition → registered in toolRegistry → called via executeTool()
//   Read tools: inspect state, no side effects, no history snapshot
//   Write tools: modify state, snapshot history before execution
// ============================================================================

import { useGraphStore } from '../stores/graphStore'
import { useProjectStore } from '../stores/projectStore'
import { useFormationStore } from '../stores/formationStore'
import { useHistoryStore } from '../stores/historyStore'
import { validateShowPhysics } from '../graph/physicsValidator'
import { computeAllTiming } from '../graph/timing'
import { evaluateAtTime } from '../graph/evaluate'
import { getAllGenerators } from '../registries/generators'
import { getAllTransitions } from '../registries/transitions'
import { getAllIdleBehaviors } from '../registries/idleBehaviors'
import { getAllColorPrograms } from '../graph/colorPrograms'
import type { ShowGraph } from '../graph/types'

// ── S26-01: Core Types ──────────────────────────────────────────────────────

export interface ToolResult {
  success: boolean
  data?: unknown
  error?: string
}

export interface ToolParameter {
  type: string
  description?: string
  enum?: string[]
  items?: ToolParameter
  properties?: Record<string, ToolParameter>
  required?: string[]
}

export interface ToolInputSchema {
  type: 'object'
  properties: Record<string, ToolParameter>
  required?: string[]
}

export interface ToolDefinition {
  name: string
  description: string
  inputSchema: ToolInputSchema
  isWriteTool: boolean // true = takes history snapshot before execution
  // Tools may return a ToolResult synchronously, or a Promise<ToolResult> for
  // tools that need async work (e.g. vision API calls). The chat loop awaits
  // either form; sync callers (tests) receive ToolResult directly.
  execute: (params: Record<string, unknown>) => ToolResult | Promise<ToolResult>
}

// ── S26-02: Tool Registry ───────────────────────────────────────────────────

const toolRegistry = new Map<string, ToolDefinition>()

export function registerTool(tool: ToolDefinition): void {
  toolRegistry.set(tool.name, tool)
}

export function getTool(name: string): ToolDefinition | undefined {
  return toolRegistry.get(name)
}

export function getAllTools(): ToolDefinition[] {
  return Array.from(toolRegistry.values())
}

// ── S26-04: Generate Claude API tool definitions ────────────────────────────

export interface ClaudeToolDef {
  name: string
  description: string
  input_schema: ToolInputSchema
}

export function getToolDefinitions(): ClaudeToolDef[] {
  return getAllTools().map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.inputSchema,
  }))
}

// ── S26-03: Execute tool with validation + history snapshot ─────────────────

export function executeTool(name: string, params: Record<string, unknown>): ToolResult {
  const tool = toolRegistry.get(name)
  if (!tool) {
    return { success: false, error: `Unknown tool: ${name}` }
  }

  // Validate required params
  const required = tool.inputSchema.required ?? []
  for (const key of required) {
    if (params[key] === undefined || params[key] === null) {
      return { success: false, error: `Missing required parameter: ${key}` }
    }
  }

  // S26-06: Snapshot history before write tools
  if (tool.isWriteTool) {
    useHistoryStore.getState().snapshot(`AI: ${name}`)
  }

  try {
    const result = tool.execute(params)
    if (result instanceof Promise) {
      return {
        success: false,
        error: `Tool '${name}' is async — use executeToolAsync() instead of executeTool().`,
      }
    }
    return result
  } catch (err) {
    return { success: false, error: `Tool execution error: ${(err as Error).message}` }
  }
}

// Async variant for tools that return Promise<ToolResult> (e.g. vision API calls).
// Sync tools work here too — they're trivially Promise.resolve()'d.
export async function executeToolAsync(
  name: string,
  params: Record<string, unknown>,
): Promise<ToolResult> {
  const tool = toolRegistry.get(name)
  if (!tool) {
    return { success: false, error: `Unknown tool: ${name}` }
  }

  const required = tool.inputSchema.required ?? []
  for (const key of required) {
    if (params[key] === undefined || params[key] === null) {
      return { success: false, error: `Missing required parameter: ${key}` }
    }
  }

  if (tool.isWriteTool) {
    useHistoryStore.getState().snapshot(`AI: ${name}`)
  }

  try {
    return await tool.execute(params)
  } catch (err) {
    return { success: false, error: `Tool execution error: ${(err as Error).message}` }
  }
}

// ── S26-05: Generate show summary for system prompt ─────────────────────────

export function generateShowSummary(): string {
  const { nodes, edges } = useGraphStore.getState()
  const { meta, dronePool, constraints } = useProjectStore.getState()
  const { formations } = useFormationStore.getState()

  // Count node types
  const typeCounts: Record<string, number> = {}
  for (const node of nodes) {
    typeCounts[node.type] = (typeCounts[node.type] ?? 0) + 1
  }

  // Compute duration
  const graph: ShowGraph = { nodes, edges }
  const timing = computeAllTiming(graph)
  let maxEnd = 0
  timing.forEach((range) => {
    if (range.end > maxEnd) maxEnd = range.end
  })
  const durationMin = Math.floor(maxEnd / 60)
  const durationSec = Math.round(maxEnd % 60)

  // Compute violations
  const violations = validateShowPhysics(graph, constraints, useFormationStore.getState().generatedPoints)
  const errorCount = violations.filter((v) => v.severity === 'error').length
  const warningCount = violations.filter((v) => v.severity === 'warning').length

  // S31-01: Build enriched node sequence with act numbers, names, strategies
  const sortedNodes = [...nodes].sort((a, b) => {
    const ta = timing.get(a.id)?.start ?? 0
    const tb = timing.get(b.id)?.start ?? 0
    return ta - tb
  })

  const nodeLabels: string[] = []
  // S31-02: Node label → nodeId lookup table
  const nodeLabelIndex: string[] = []
  let actNum = 0
  let prevFormName = ''

  for (const node of sortedNodes) {
    const t = timing.get(node.id)
    const timeStr = t ? `${t.start.toFixed(1)}s–${t.end.toFixed(1)}s` : '?'
    if (node.type === 'launch') {
      nodeLabels.push(`  Launch (${node.id}) [${timeStr}]`)
      nodeLabelIndex.push(`  "launch" → ${node.id}`)
    } else if (node.type === 'formation') {
      actNum++
      const fd = node.data as { formationId: string | null; duration: number; colorProgramId?: string | null }
      const form = formations.find((f) => f.id === fd.formationId)
      const name = form?.name ?? 'unnamed'
      const gen = form?.generatorId ?? '?'
      const pts = form?.pointCount ?? 0
      const colorProg = fd.colorProgramId
      const kfCount = (node.data as { keyframes: unknown[] }).keyframes?.length ?? 0
      const idleCount = (node.data as { idleConfigs: unknown[] }).idleConfigs?.length ?? 0
      const altitude = (node.data as { transform: { position: { y: number } } }).transform?.position?.y ?? 0

      nodeLabels.push(`  Act ${actNum}: "${name}" (${node.id}) [${timeStr}] gen:${gen} pts:${pts} alt:${altitude.toFixed(0)}m${colorProg ? ` color:${colorProg}` : ''}${kfCount ? ` ${kfCount}kf` : ''}${idleCount ? ` ${idleCount}idle` : ''}`)
      nodeLabelIndex.push(`  "act ${actNum}" → ${node.id}`)
      nodeLabelIndex.push(`  "${name}" → ${node.id}`)
      nodeLabelIndex.push(`  "${name.toLowerCase()}" → ${node.id}`)
      prevFormName = name
    } else if (node.type === 'land') {
      nodeLabels.push(`  Land (${node.id}) [${timeStr}]`)
      nodeLabelIndex.push(`  "land" → ${node.id}`)
    } else if (node.type === 'idle') {
      const id = node.data as { behavior: string }
      nodeLabels.push(`  Idle: ${id.behavior} (${node.id}) [${timeStr}]`)
      nodeLabelIndex.push(`  "idle ${id.behavior}" → ${node.id}`)
    }
  }

  // Formation list
  const formationLines = formations.map((f) =>
    `  - "${f.name}" (${f.id}) ${f.generatorId}, ${f.pointCount} pts`,
  )

  return [
    `Current show state:`,
    `- Project: "${meta.name}"`,
    `- Drones: ${dronePool.droneCount}, layout: ${dronePool.launchLayout}, spacing: ${dronePool.spacing}m`,
    `- Nodes: ${nodes.length} total (${typeCounts['launch'] ?? 0} launch, ${typeCounts['formation'] ?? 0} formation, ${typeCounts['idle'] ?? 0} idle, ${typeCounts['land'] ?? 0} land)`,
    `- Edges: ${edges.length}`,
    `- Duration: ${maxEnd.toFixed(1)}s (${durationMin}m ${durationSec.toString().padStart(2, '0')}s)`,
    `- Violations: ${violations.length} (${errorCount} errors, ${warningCount} warnings)`,
    `- Constraints: maxVelocity=${constraints.maxVelocity}m/s, maxAccel=${constraints.maxAcceleration}m/s², minDist=${constraints.minDroneDistance}m, altMax=${constraints.altitudeMax}m`,
    ``,
    `Show sequence (S31-01):`,
    ...nodeLabels,
    ``,
    `Node label index — use these to resolve user references (S31-02):`,
    ...nodeLabelIndex,
    ``,
    `Formations (${formations.length}):`,
    ...formationLines,
  ].join('\n')
}

// ── S26-07 to S26-20: Read Tools ────────────────────────────────────────────

// S26-07: get_show_summary
registerTool({
  name: 'get_show_summary',
  description: 'Get a high-level overview of the current show: drone count, node count, duration, violation count, formation count.',
  inputSchema: { type: 'object', properties: {}, required: [] },
  isWriteTool: false,
  execute: () => {
    const { nodes, edges } = useGraphStore.getState()
    const { meta, dronePool, constraints } = useProjectStore.getState()
    const { formations, generatedPoints } = useFormationStore.getState()
    const graph: ShowGraph = { nodes, edges }
    const timing = computeAllTiming(graph)
    let maxEnd = 0
    timing.forEach((r) => { if (r.end > maxEnd) maxEnd = r.end })
    const violations = validateShowPhysics(graph, constraints, generatedPoints)
    return {
      success: true,
      data: {
        projectName: meta.name,
        droneCount: dronePool.droneCount,
        nodeCount: nodes.length,
        edgeCount: edges.length,
        duration: Math.round(maxEnd * 10) / 10,
        violationCount: violations.length,
        errorCount: violations.filter((v) => v.severity === 'error').length,
        warningCount: violations.filter((v) => v.severity === 'warning').length,
        formationCount: formations.length,
      },
    }
  },
})

// S26-08: get_graph
registerTool({
  name: 'get_graph',
  description: 'Get the full show graph: all nodes with their data and all edges. Use this to understand the complete show structure.',
  inputSchema: { type: 'object', properties: {}, required: [] },
  isWriteTool: false,
  execute: () => {
    const { nodes, edges } = useGraphStore.getState()
    return { success: true, data: { nodes, edges } }
  },
})

// S26-09: get_node
registerTool({
  name: 'get_node',
  description: 'Get details of a single node by ID.',
  inputSchema: {
    type: 'object',
    properties: {
      nodeId: { type: 'string', description: 'The ID of the node to retrieve' },
    },
    required: ['nodeId'],
  },
  isWriteTool: false,
  execute: (params) => {
    const node = useGraphStore.getState().getNode(params.nodeId as string)
    if (!node) return { success: false, error: `Node not found: ${params.nodeId}` }
    return { success: true, data: node }
  },
})

// S26-10: get_timing
registerTool({
  name: 'get_timing',
  description: 'Get computed timing (start/end in seconds) for all nodes in the show.',
  inputSchema: { type: 'object', properties: {}, required: [] },
  isWriteTool: false,
  execute: () => {
    const { nodes, edges } = useGraphStore.getState()
    const timing = computeAllTiming({ nodes, edges })
    const result: Record<string, { start: number; end: number }> = {}
    timing.forEach((range, nodeId) => {
      result[nodeId] = { start: Math.round(range.start * 100) / 100, end: Math.round(range.end * 100) / 100 }
    })
    return { success: true, data: result }
  },
})

// S26-11: get_formations
registerTool({
  name: 'get_formations',
  description: 'List all formation definitions with their names, types, generators, and point counts.',
  inputSchema: { type: 'object', properties: {}, required: [] },
  isWriteTool: false,
  execute: () => {
    const { formations } = useFormationStore.getState()
    return {
      success: true,
      data: formations.map((f) => ({
        id: f.id,
        name: f.name,
        type: f.type,
        generatorId: f.generatorId,
        pointCount: f.pointCount,
        tags: f.tags,
      })),
    }
  },
})

// S26-12: get_formation_points
registerTool({
  name: 'get_formation_points',
  description: 'Get the 3D point positions for a specific formation. Returns array of {x, y, z} in meters.',
  inputSchema: {
    type: 'object',
    properties: {
      formationId: { type: 'string', description: 'The formation ID' },
    },
    required: ['formationId'],
  },
  isWriteTool: false,
  execute: (params) => {
    const points = useFormationStore.getState().getPoints(params.formationId as string)
    if (!points) return { success: false, error: `Formation not found: ${params.formationId}` }
    return { success: true, data: points }
  },
})

// S26-13: get_violations
registerTool({
  name: 'get_violations',
  description: 'Run physics validation on the current show and return all violations with severity, message, and fix suggestions.',
  inputSchema: { type: 'object', properties: {}, required: [] },
  isWriteTool: false,
  execute: () => {
    const { nodes, edges } = useGraphStore.getState()
    const { constraints, dronePool } = useProjectStore.getState()
    const { generatedPoints } = useFormationStore.getState()
    const violations = validateShowPhysics({ nodes, edges }, constraints, generatedPoints, dronePool.homePositions)
    return {
      success: true,
      data: violations.map((v) => ({
        id: v.id,
        type: v.type,
        severity: v.severity,
        nodeId: v.nodeId,
        message: v.message,
        detail: v.detail,
        fix: v.fix ? { type: v.fix.type, nodeId: v.fix.nodeId, delta: v.fix.delta, description: v.fix.description } : null,
      })),
    }
  },
})

// S26-14: get_constraints
registerTool({
  name: 'get_constraints',
  description: 'Get the current physics constraints (velocity limits, spacing, altitude bounds, geofence, wind, safety margins).',
  inputSchema: { type: 'object', properties: {}, required: [] },
  isWriteTool: false,
  execute: () => {
    const { constraints } = useProjectStore.getState()
    return { success: true, data: constraints }
  },
})

// S26-15: get_drone_pool
registerTool({
  name: 'get_drone_pool',
  description: 'Get drone pool configuration: total count, launch layout, spacing, home position count.',
  inputSchema: { type: 'object', properties: {}, required: [] },
  isWriteTool: false,
  execute: () => {
    const { dronePool } = useProjectStore.getState()
    return {
      success: true,
      data: {
        droneCount: dronePool.droneCount,
        launchLayout: dronePool.launchLayout,
        spacing: dronePool.spacing,
        homePositionCount: dronePool.homePositions.length,
      },
    }
  },
})

// S26-16: evaluate_at_time
registerTool({
  name: 'evaluate_at_time',
  description: 'Evaluate the show at a specific time and get drone positions + colors. Returns up to 50 drones for context efficiency. Use this to see where drones are at any moment.',
  inputSchema: {
    type: 'object',
    properties: {
      time: { type: 'number', description: 'Time in seconds to evaluate at' },
    },
    required: ['time'],
  },
  isWriteTool: false,
  execute: (params) => {
    const t = Number(params.time)
    if (isNaN(t) || t < 0) return { success: false, error: 'Invalid time: must be a non-negative number' }

    const { nodes, edges } = useGraphStore.getState()
    const { dronePool } = useProjectStore.getState()
    const { generatedPoints, animatedDefs } = useFormationStore.getState()
    const graph: ShowGraph = { nodes, edges }

    const states = evaluateAtTime(graph, generatedPoints, t, dronePool.homePositions, animatedDefs)

    // Cap at 50 drones to keep context size manageable
    const capped = states.slice(0, 50).map((s) => ({
      droneId: s.droneId,
      position: { x: Math.round(s.position.x * 100) / 100, y: Math.round(s.position.y * 100) / 100, z: Math.round(s.position.z * 100) / 100 },
      color: { r: Math.round(s.color.r * 100) / 100, g: Math.round(s.color.g * 100) / 100, b: Math.round(s.color.b * 100) / 100 },
    }))

    return {
      success: true,
      data: { time: t, droneCount: states.length, drones: capped, truncated: states.length > 50 },
    }
  },
})

// S26-17: get_available_generators
registerTool({
  name: 'get_available_generators',
  description: 'List all available formation shape generators (ring, grid, sphere, heart, star, spiral, line).',
  inputSchema: { type: 'object', properties: {}, required: [] },
  isWriteTool: false,
  execute: () => {
    const generators = getAllGenerators()
    return {
      success: true,
      data: generators.map((g) => ({ id: g.id, name: g.name, defaultParams: g.defaultParams })),
    }
  },
})

// S26-18: get_available_transitions
registerTool({
  name: 'get_available_transitions',
  description: 'List all available transition strategies (shortest-path, ant-walk, stagger, spiral, explosion, implosion, cascade, morph, color-sweep, bounce).',
  inputSchema: { type: 'object', properties: {}, required: [] },
  isWriteTool: false,
  execute: () => {
    const transitions = getAllTransitions()
    return {
      success: true,
      data: transitions.map((t) => ({ id: t.id, name: t.name })),
    }
  },
})

// S26-19: get_available_idle_behaviors
registerTool({
  name: 'get_available_idle_behaviors',
  description: 'List all available idle behaviors (hover, orbit, figure8, breathe, swarm, sparkle, pulse, wave, spin, drift).',
  inputSchema: { type: 'object', properties: {}, required: [] },
  isWriteTool: false,
  execute: () => {
    const behaviors = getAllIdleBehaviors()
    return {
      success: true,
      data: behaviors.map((b) => ({ id: b.id, name: b.name })),
    }
  },
})

// S26-20: get_available_color_programs
registerTool({
  name: 'get_available_color_programs',
  description: 'List all available color programs that can be assigned to formations and idle behaviors.',
  inputSchema: { type: 'object', properties: {}, required: [] },
  isWriteTool: false,
  execute: () => {
    const programs = getAllColorPrograms()
    return {
      success: true,
      data: programs.map((p) => ({ id: p.id, name: p.name, type: p.type })),
    }
  },
})

// ── S31-08 to S31-14: critique_show tool ────────────────────────────────────

interface CritiqueSuggestion {
  severity: 'issue' | 'improvement' | 'suggestion'
  category: string
  message: string
  suggestedAction?: string
}

registerTool({
  name: 'critique_show',
  description: 'Analyze the current show and return structured feedback on pacing, variety, altitude variation, color usage, and idle drone utilization. Use this when the user asks "how does this look?" or "any suggestions?".',
  inputSchema: { type: 'object', properties: {}, required: [] },
  isWriteTool: false,
  execute: () => {
    const { nodes, edges } = useGraphStore.getState()
    const { constraints } = useProjectStore.getState()
    const { formations, generatedPoints } = useFormationStore.getState()
    const graph = { nodes, edges }
    const timing = computeAllTiming(graph)

    const suggestions: CritiqueSuggestion[] = []
    const formationNodes = nodes.filter((n) => n.type === 'formation')
    const transitionEdges = edges.filter((e) => e.edgeType === 'flow' && e.transition)
    const edgeTiming = useGraphStore.getState().getCachedEdgeTiming()

    if (formationNodes.length === 0) {
      return { success: true, data: { suggestions: [{ severity: 'issue', category: 'structure', message: 'Show is empty — no formations found.', suggestedAction: 'Create a show using create_show_from_outline' }] } }
    }

    // Compute total duration
    let maxEnd = 0
    timing.forEach((r) => { if (r.end > maxEnd) maxEnd = r.end })

    // Flag if any single formation is >40% of total
    for (const fn of formationNodes) {
      const t = timing.get(fn.id)
      if (t && maxEnd > 0) {
        const pct = ((t.end - t.start) / maxEnd) * 100
        if (pct > 40) {
          const fd = fn.data as { formationId: string | null }
          const form = formations.find((f) => f.id === fd.formationId)
          suggestions.push({
            severity: 'improvement',
            category: 'pacing',
            message: `"${form?.name ?? 'unnamed'}" takes ${pct.toFixed(0)}% of the show (${(t.end - t.start).toFixed(1)}s). Consider splitting into two acts or reducing its duration.`,
            suggestedAction: `update_node_timing on ${fn.id} with shorter duration`,
          })
        }
      }
    }

    // Flag if any transition is >20% of total
    for (const te of transitionEdges) {
      const t = edgeTiming.get(te.id)
      if (t && maxEnd > 0) {
        const pct = ((t.end - t.start) / maxEnd) * 100
        if (pct > 20) {
          suggestions.push({
            severity: 'improvement',
            category: 'pacing',
            message: `A transition takes ${pct.toFixed(0)}% of the show (${(t.end - t.start).toFixed(1)}s). Consider reducing its duration.`,
            suggestedAction: `set_edge_transition on ${te.id}`,
          })
        }
      }
    }

    // ── Variety analysis ──────────────────────────────────────
    const uniqueGens = new Set(formationNodes.map((n) => {
      const fd = n.data as { formationId: string | null }
      return formations.find((f) => f.id === fd.formationId)?.generatorId ?? 'unknown'
    }))
    const uniqueStrategies = new Set(transitionEdges.map((e) => e.transition!.strategyId))
    const uniqueColors = new Set(formationNodes.map((n) => (n.data as { colorProgramId: string | null }).colorProgramId).filter(Boolean))

    if (uniqueGens.size < 3 && formationNodes.length >= 3) {
      suggestions.push({
        severity: 'suggestion',
        category: 'variety',
        message: `Only ${uniqueGens.size} unique formation shapes used (${[...uniqueGens].join(', ')}). Try using more diverse generators (heart, star, spiral, sphere) for visual interest.`,
        suggestedAction: 'Update some formations with different generators',
      })
    }
    if (uniqueStrategies.size < 2 && transitionEdges.length >= 2) {
      suggestions.push({
        severity: 'suggestion',
        category: 'variety',
        message: `Only ${uniqueStrategies.size} unique transition type(s) used (${[...uniqueStrategies].join(', ')}). Vary transitions for visual interest (spiral, explosion, cascade, morph).`,
        suggestedAction: 'Use set_edge_transition to diversify',
      })
    }
    if (uniqueColors.size < 2 && formationNodes.length >= 2) {
      suggestions.push({
        severity: 'suggestion',
        category: 'color',
        message: `${uniqueColors.size === 0 ? 'No' : 'Only ' + uniqueColors.size} color program(s) assigned. Add color programs (rainbow, gradient, pulse, chase) for visual impact.`,
        suggestedAction: 'Use set_color_program on formation nodes',
      })
    }

    // ── S31-11: Altitude analysis ─────────────────────────────────────
    const altitudes = formationNodes.map((n) => {
      const t = (n.data as { transform: { position: { y: number } } }).transform?.position?.y ?? 0
      return t
    })
    if (altitudes.length >= 2) {
      const minAlt = Math.min(...altitudes)
      const maxAlt = Math.max(...altitudes)
      if (maxAlt - minAlt < 3) {
        suggestions.push({
          severity: 'suggestion',
          category: 'altitude',
          message: `All formations are at similar altitude (${minAlt.toFixed(0)}–${maxAlt.toFixed(0)}m). Vary altitude between 12–25m for visual depth.`,
          suggestedAction: 'Use update_node_transform to vary Y positions',
        })
      }
    }

    // ── S31-12: Idle utilization analysis ──────────────────────────────
    for (const fn of formationNodes) {
      const fd = fn.data as { formationId: string | null; idleConfigs: unknown[] }
      const formDef = formations.find((f) => f.id === fd.formationId)
      if (!formDef) continue
      const formPts = formDef.pointCount
      const inEdges = edges.filter((e) => e.target === fn.id && e.edgeType === 'flow')
      const incomingDrones = inEdges.reduce((sum, e) => sum + e.droneCount, 0)
      const leftover = incomingDrones - formPts
      if (leftover > incomingDrones * 0.2 && (!fd.idleConfigs || fd.idleConfigs.length === 0)) {
        suggestions.push({
          severity: 'improvement',
          category: 'idle',
          message: `"${formDef.name}" has ~${leftover} leftover drones (${Math.round(leftover / incomingDrones * 100)}%) with no idle behavior. Add orbit, sparkle, or breathe idle.`,
          suggestedAction: `add_attached_idle on ${fn.id}`,
        })
      }
    }

    // Physics headroom
    const violations = validateShowPhysics(graph, constraints, generatedPoints)
    if (violations.length > 0) {
      suggestions.push({
        severity: 'issue',
        category: 'physics',
        message: `${violations.length} physics violation(s) found. Call fix_all_violations or resolve_violations_creatively.`,
        suggestedAction: 'fix_all_violations',
      })
    }

    // S31-13: Format response
    return {
      success: true,
      data: {
        totalFormations: formationNodes.length,
        totalTransitions: transitionEdges.length,
        duration: Math.round(maxEnd * 10) / 10,
        uniqueGenerators: [...uniqueGens],
        uniqueStrategies: [...uniqueStrategies],
        uniqueColors: [...uniqueColors],
        altitudeRange: altitudes.length > 0 ? { min: Math.min(...altitudes), max: Math.max(...altitudes) } : null,
        violations: violations.length,
        suggestions,
      },
    }
  },
})

// ── S31-15: resolve_violations_creatively tool ──────────────────────────────

registerTool({
  name: 'resolve_violations_creatively',
  description: 'Analyze physics violations and suggest creative fixes that preserve artistic intent. Prefers changing transition strategies over extending duration, scaling over removing formations. Returns suggestions — does NOT auto-apply.',
  inputSchema: { type: 'object', properties: {}, required: [] },
  isWriteTool: false,
  execute: () => {
    const { nodes, edges } = useGraphStore.getState()
    const { constraints, dronePool } = useProjectStore.getState()
    const { generatedPoints } = useFormationStore.getState()
    const violations = validateShowPhysics({ nodes, edges }, constraints, generatedPoints, dronePool.homePositions)

    if (violations.length === 0) {
      return { success: true, data: { message: 'No violations found!', suggestions: [] } }
    }

    const suggestions: { violation: string; nodeId: string; approach: string; toolCall: string }[] = []

    for (const v of violations) {
      if (v.type === 'transition-too-short') {
        const edge = v.edgeId ? edges.find((e) => e.id === v.edgeId) : null
        const strategy = edge?.transition?.strategyId ?? '?'
        if (strategy !== 'shortest-path' && v.edgeId) {
          suggestions.push({
            violation: v.message,
            nodeId: v.nodeId,
            approach: 'Switch to shortest-path (fastest transition strategy) before extending duration',
            toolCall: `set_edge_transition(${v.edgeId}, strategyId: "shortest-path")`,
          })
        } else {
          suggestions.push({
            violation: v.message,
            nodeId: v.nodeId,
            approach: `Extend transition by ${v.fix?.delta.toFixed(1) ?? '?'}s`,
            toolCall: v.edgeId
              ? `set_edge_transition(${v.edgeId}, preferredDuration: +${v.fix?.delta.toFixed(1) ?? '?'})`
              : `update_node_timing(${v.nodeId}, duration: +${v.fix?.delta.toFixed(1) ?? '?'})`,
          })
        }
      } else if (v.type === 'keyframe-too-fast') {
        suggestions.push({
          violation: v.message,
          nodeId: v.nodeId,
          approach: 'Add intermediate keyframes to smooth the motion curve rather than extending duration',
          toolCall: `add_keyframe on ${v.nodeId} at midpoint with interpolated position`,
        })
      } else {
        suggestions.push({
          violation: v.message,
          nodeId: v.nodeId,
          approach: v.fix?.description ?? 'Apply standard fix',
          toolCall: v.fix ? `applyFix: ${v.fix.type}(${v.nodeId}, ${v.fix.delta})` : 'manual fix needed',
        })
      }
    }

    return {
      success: true,
      data: {
        violationCount: violations.length,
        message: `Found ${violations.length} violation(s). Here are creative fix suggestions:`,
        suggestions,
      },
    }
  },
})

// ── Initialize write tools ──────────────────────────────────────────────────

