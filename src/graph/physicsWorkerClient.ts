// ============================================================================
// Physics worker client — async wrapper around physicsValidator.worker.ts
// with latest-wins semantics (a newer request silently supersedes pending
// older ones; stale responses are dropped). Falls back to synchronous
// validation where Worker is unavailable (vitest / SSR).
// ============================================================================

import { validateShowPhysics, type PhysicsViolation } from './physicsValidator'
import type { ShowGraph, Vec3 } from './types'
import type { Constraints } from '../stores/projectStore'

let worker: Worker | null = null
let seq = 0
let latestResolve: ((v: PhysicsViolation[]) => void) | null = null
let latestId = 0

function ensureWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./physicsValidator.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (e: MessageEvent<{ id: number; violations: PhysicsViolation[] }>) => {
      if (e.data.id !== latestId) return // stale — a newer request is in flight
      latestResolve?.(e.data.violations)
      latestResolve = null
    }
    worker.onerror = () => {
      // Worker died (bundling edge case) — drop it; next call falls back sync.
      worker?.terminate()
      worker = null
      latestResolve = null
    }
  }
  return worker
}

/**
 * Validate off the main thread. Only the newest call resolves; superseded
 * calls never settle (callers keyed by effect cleanup don't care).
 */
export function validateShowPhysicsAsync(
  graph: ShowGraph,
  constraints: Constraints,
  generatedPoints: Map<string, Vec3[]>,
): Promise<PhysicsViolation[]> {
  if (typeof Worker === 'undefined') {
    return Promise.resolve(validateShowPhysics(graph, constraints, generatedPoints))
  }
  try {
    const w = ensureWorker()
    latestId = ++seq
    return new Promise<PhysicsViolation[]>((resolve) => {
      latestResolve = resolve
      w.postMessage({ id: latestId, graph, constraints, generatedPoints })
    })
  } catch {
    return Promise.resolve(validateShowPhysics(graph, constraints, generatedPoints))
  }
}
