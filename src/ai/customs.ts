// Custom drawings and 3D models requested anywhere in a show plan or tool
// input: a scene's main shape, its extra shapes, and its groups' formations.
// They're generated up front (a few at a time), then looked up by the shape
// input they were made for when the scenes are built.

import type { ShapeSpec } from '@/core/types'
import type { SceneInput, ShapeInput, StepInput } from './schemas'
import type { CustomShapes } from './convert'
import { drawAndCheck } from './shapeGen'
import { createModel, modelShape } from './model3d'
import { fourViews } from './render'

/** Custom formations generated per show (or per copilot request). */
export const MAX_CUSTOM = 10

export interface CustomJob {
  shape: ShapeInput
  /** About how many drones it will have (for the look-and-fix render). */
  n: number
}

const isCustom = (s: ShapeInput) => (s.kind === 'custom' || s.kind === 'model3d') && !!s.description?.trim()

/** Every custom shape in these scenes, in show order: main shape, extra shapes, then group formations. */
export function customJobs(scenes: (SceneInput | StepInput)[], drones: number): CustomJob[] {
  const out: CustomJob[] = []
  for (const s of scenes) {
    const extras = s.extra_shapes ?? []
    const mainShare = 1 - extras.reduce((a, e) => a + (e.share ?? 1 / (extras.length + 1)), 0)
    if (isCustom(s.shape)) out.push({ shape: s.shape, n: Math.max(20, Math.round(drones * Math.max(0.2, mainShare))) })
    for (const e of extras) if (isCustom(e.shape)) out.push({ shape: e.shape, n: Math.max(20, Math.round(drones * (e.share ?? 1 / (extras.length + 1)))) })
    const split = 'split' in s ? s.split : undefined
    if (split?.groups.length) {
      const per = Math.max(20, Math.round(drones / split.groups.length))
      for (const g of split.groups) out.push(...customJobs(g.steps, per))
    }
  }
  return out
}

async function mapLimit<T, R>(items: T[], limit: number, f: (x: T) => Promise<R>): Promise<PromiseSettledResult<R>[]> {
  const out: PromiseSettledResult<R>[] = new Array(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const i = next++
      try { out[i] = { status: 'fulfilled', value: await f(items[i]!) } } catch (reason) { out[i] = { status: 'rejected', reason } }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return out
}

/**
 * Generate up to `max` custom formations, four at a time: drawings get a
 * look-at-the-drones-and-fix round, 3D models one look-and-fix round. Shapes
 * over the limit, and any that fail, fall back to a placeholder.
 */
export async function resolveCustoms(jobs: CustomJob[], signal?: AbortSignal, max = MAX_CUSTOM): Promise<{ customs: CustomShapes; failed: number; skipped: number; errors: string[] }> {
  const todo = jobs.slice(0, max)
  const customs: CustomShapes = new Map()
  const results = await mapLimit(todo, 4, async (j): Promise<ShapeSpec> => {
    const description = j.shape.description!.trim()
    if (j.shape.kind === 'custom') return (await drawAndCheck(description, j.n, signal)).shape
    const attempts = await createModel(description, { n: j.n, rounds: 1, render: fourViews, signal })
    return modelShape(attempts[attempts.length - 1]!)
  })
  const errors: string[] = []
  results.forEach((r, k) => {
    if (r.status === 'fulfilled') customs.set(todo[k]!.shape, r.value)
    else errors.push(r.reason instanceof Error ? r.reason.message : String(r.reason))
  })
  return { customs, failed: errors.length, skipped: jobs.length - todo.length, errors }
}
