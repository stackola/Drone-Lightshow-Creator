// ============================================================================
// Physics validation worker — runs the 700-line show validator off the main
// thread so big shows don't jank the inspector while typing. Pure
// request/response: { id, graph, constraints, generatedPoints } in,
// { id, violations } out. Maps survive structured clone as-is.
// ============================================================================

import { validateShowPhysics, type PhysicsViolation } from './physicsValidator'
import { initRegistries } from '../registries/init'
import type { ShowGraph, Vec3 } from './types'
import type { Constraints } from '../stores/projectStore'

// The validator resolves transition strategies / idle behaviors from the
// registries, which the app shell normally initializes — do it here too.
initRegistries()

export interface PhysicsRequest {
  id: number
  graph: ShowGraph
  constraints: Constraints
  generatedPoints: Map<string, Vec3[]>
}

export interface PhysicsResponse {
  id: number
  violations: PhysicsViolation[]
}

self.onmessage = (e: MessageEvent<PhysicsRequest>) => {
  const { id, graph, constraints, generatedPoints } = e.data
  const violations = validateShowPhysics(graph, constraints, generatedPoints)
  ;(self as unknown as Worker).postMessage({ id, violations } satisfies PhysicsResponse)
}
