// ============================================================================
// S9-01/02/03: Bake Service — Manages bake worker and progress tracking
// ============================================================================
// Provides a Promise-based API for baking shows on the main thread (via
// Web Worker when available, fallback to synchronous bake).
// ============================================================================

import { useGraphStore } from '../stores/graphStore'
import { useProjectStore } from '../stores/projectStore'
import { useFormationStore } from '../stores/formationStore'
import { bakeShow, type BakeSample, type BakeMessage, type BakeRequest } from './bakeWorker'
import type { ShowGraph, Vec3 } from '../graph/types'
import type { AnimatedFormationDef } from '../graph/animatedFormation'

export interface BakeOptions {
  sampleRate: number // Hz, default 10
  onProgress?: (progress: number, eta: number) => void
}

export interface BakeOutput {
  trajectories: Map<number, BakeSample[]>
  duration: number
  sampleCount: number
  droneCount: number
}

let activeWorker: Worker | null = null

/**
 * Cancel any in-progress bake.
 */
export function cancelBake(): void {
  if (activeWorker) {
    activeWorker.terminate()
    activeWorker = null
  }
}

/**
 * Bake the current project. Tries Web Worker first, falls back to main thread.
 */
export async function bakeCurrentProject(options: BakeOptions): Promise<BakeOutput> {
  cancelBake() // Cancel any previous bake

  const { nodes, edges } = useGraphStore.getState()
  const { dronePool } = useProjectStore.getState()
  const { generatedPoints, animatedDefs } = useFormationStore.getState()

  const graph: ShowGraph = { nodes, edges }

  // Convert Maps to plain objects for serialization
  const formationsObj: Record<string, Vec3[]> = {}
  generatedPoints.forEach((pts, id) => {
    formationsObj[id] = pts
  })

  const animatedDefsObj: Record<string, AnimatedFormationDef> = {}
  animatedDefs.forEach((def, id) => {
    animatedDefsObj[id] = def
  })

  // Try Web Worker first
  try {
    return await bakeWithWorker(graph, formationsObj, animatedDefsObj, dronePool.homePositions, options)
  } catch {
    // Fall back to main thread bake
    return bakeOnMainThread(graph, generatedPoints, animatedDefs, dronePool.homePositions, options)
  }
}

function bakeWithWorker(
  graph: ShowGraph,
  formations: Record<string, Vec3[]>,
  animatedDefs: Record<string, AnimatedFormationDef>,
  homePositions: Vec3[],
  options: BakeOptions,
): Promise<BakeOutput> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./bakeWorker.ts', import.meta.url), { type: 'module' })
    activeWorker = worker
    const startTime = Date.now()

    worker.onmessage = (e: MessageEvent<BakeMessage>) => {
      const msg = e.data
      if (msg.type === 'bake-progress') {
        const elapsed = (Date.now() - startTime) / 1000
        const eta = msg.progress > 0 ? (elapsed / msg.progress) * (1 - msg.progress) : 0
        options.onProgress?.(msg.progress, eta)
      } else if (msg.type === 'bake-complete') {
        activeWorker = null
        worker.terminate()
        const trajectories = new Map<number, BakeSample[]>()
        for (const [id, samples] of Object.entries(msg.trajectories)) {
          trajectories.set(Number(id), samples)
        }
        resolve({
          trajectories,
          duration: msg.duration,
          sampleCount: msg.sampleCount,
          droneCount: homePositions.length,
        })
      } else if (msg.type === 'bake-error') {
        activeWorker = null
        worker.terminate()
        reject(new Error(msg.message))
      }
    }

    worker.onerror = (err) => {
      activeWorker = null
      worker.terminate()
      reject(new Error(err.message))
    }

    const request: BakeRequest = {
      type: 'bake',
      graph,
      formations,
      animatedDefs: Object.keys(animatedDefs).length > 0 ? animatedDefs : undefined,
      homePositions,
      sampleRate: options.sampleRate,
    }

    worker.postMessage(request)
  })
}

function bakeOnMainThread(
  graph: ShowGraph,
  formations: Map<string, Vec3[]>,
  animatedDefs: Map<string, AnimatedFormationDef>,
  homePositions: Vec3[],
  options: BakeOptions,
): Promise<BakeOutput> {
  return new Promise((resolve) => {
    const startTime = Date.now()
    const result = bakeShow(
      graph,
      formations,
      homePositions,
      options.sampleRate,
      animatedDefs,
      (progress) => {
        const elapsed = (Date.now() - startTime) / 1000
        const eta = progress > 0 ? (elapsed / progress) * (1 - progress) : 0
        options.onProgress?.(progress, eta)
      },
    )
    resolve({
      ...result,
      droneCount: homePositions.length,
    })
  })
}
