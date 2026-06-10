// ============================================================================
// S7-06: Serialization — Save/Load Full Project
// ============================================================================
// Round-trip: FullProject → JSON string → FullProject
// Invariant: deserialize(serialize(project)) deep-equals project
// Includes: graph, meta, dronePool, constraints, formations
// ============================================================================

import type { ShowGraph, Vec3 } from './types'
import { checkInvariants } from './invariants'
import type { ProjectMeta, DronePool, Constraints } from '../stores/projectStore'
import type { Formation } from '../stores/formationStore'
import type { AnimatedFormationDef } from './animatedFormation'
import type { BuildPlane } from './buildPlane'

export interface SerializedProject {
  version: 2
  graph: ShowGraph
  meta?: ProjectMeta
  dronePool?: DronePool
  constraints?: Constraints
  formations?: Formation[]
  formationPoints?: Record<string, Vec3[]>
  animatedDefs?: Record<string, AnimatedFormationDef>
  /** Build Planes — additive in v2; old files lack this and load as []. */
  planes?: BuildPlane[]
  activePlaneId?: string | null
}

// Legacy v1 format
interface SerializedProjectV1 {
  version: 1
  graph: ShowGraph
  meta?: Record<string, unknown>
}

export interface FullProjectData {
  graph: ShowGraph
  meta?: ProjectMeta
  dronePool?: DronePool
  constraints?: Constraints
  formations?: Formation[]
  formationPoints?: Map<string, Vec3[]>
  animatedDefs?: Map<string, AnimatedFormationDef>
  planes?: BuildPlane[]
  activePlaneId?: string | null
}

export function serializeProject(
  graph: ShowGraph,
  meta?: ProjectMeta,
  dronePool?: DronePool,
  constraints?: Constraints,
  formations?: Formation[],
  formationPoints?: Map<string, Vec3[]>,
  animatedDefs?: Map<string, AnimatedFormationDef>,
  planes?: BuildPlane[],
  activePlaneId?: string | null,
): string {
  // Convert Maps to plain objects for JSON
  const pointsObj: Record<string, Vec3[]> = {}
  if (formationPoints) {
    formationPoints.forEach((pts, id) => {
      pointsObj[id] = pts
    })
  }

  const animObj: Record<string, AnimatedFormationDef> = {}
  if (animatedDefs) {
    animatedDefs.forEach((def, id) => {
      animObj[id] = def
    })
  }

  const project: SerializedProject = {
    version: 2,
    graph,
    meta,
    dronePool,
    constraints,
    formations,
    formationPoints: Object.keys(pointsObj).length > 0 ? pointsObj : undefined,
    animatedDefs: Object.keys(animObj).length > 0 ? animObj : undefined,
    planes: planes && planes.length > 0 ? planes : undefined,
    activePlaneId: activePlaneId ?? undefined,
  }
  return JSON.stringify(project, null, 2)
}

export function deserializeProject(json: string): FullProjectData {
  const parsed = JSON.parse(json) as SerializedProject | SerializedProjectV1

  // Support v1 legacy format
  if (parsed.version === 1) {
    const v1 = parsed as SerializedProjectV1
    if (!v1.graph || !Array.isArray(v1.graph.nodes) || !Array.isArray(v1.graph.edges)) {
      throw new Error('Invalid project format: missing graph.nodes or graph.edges')
    }
    const violations = checkInvariants(v1.graph)
    if (violations.length > 0) {
      console.warn('Graph invariant violations on load:', violations)
    }
    return { graph: v1.graph, meta: v1.meta as ProjectMeta | undefined }
  }

  if (parsed.version !== 2) {
    throw new Error(`Unsupported project version: ${(parsed as { version: unknown }).version}`)
  }

  if (!parsed.graph || !Array.isArray(parsed.graph.nodes) || !Array.isArray(parsed.graph.edges)) {
    throw new Error('Invalid project format: missing graph.nodes or graph.edges')
  }

  // Validate invariants on load
  const violations = checkInvariants(parsed.graph)
  if (violations.length > 0) {
    console.warn('Graph invariant violations on load:', violations)
  }

  // Convert formation points from plain object to Map
  let formationPoints: Map<string, Vec3[]> | undefined
  if (parsed.formationPoints) {
    formationPoints = new Map()
    for (const [id, pts] of Object.entries(parsed.formationPoints)) {
      formationPoints.set(id, pts)
    }
  }

  // Convert animated defs from plain object to Map
  let animatedDefs: Map<string, AnimatedFormationDef> | undefined
  if (parsed.animatedDefs) {
    animatedDefs = new Map()
    for (const [id, def] of Object.entries(parsed.animatedDefs)) {
      animatedDefs.set(id, def)
    }
  }

  return {
    graph: parsed.graph,
    meta: parsed.meta,
    dronePool: parsed.dronePool,
    constraints: parsed.constraints,
    formations: parsed.formations,
    formationPoints,
    animatedDefs,
    planes: parsed.planes,
    activePlaneId: parsed.activePlaneId,
  }
}

/**
 * Verify round-trip: serialize → deserialize produces identical graph
 */
export function verifyRoundTrip(graph: ShowGraph): boolean {
  const json = serializeProject(graph)
  const { graph: restored } = deserializeProject(json)
  return JSON.stringify(graph) === JSON.stringify(restored)
}
