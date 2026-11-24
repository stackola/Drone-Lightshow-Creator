/// <reference lib="webworker" />
// Runs the wind simulation off the main thread (it can take a few seconds).

import type { Compiled } from '@/core/compile'
import { simulate, type WindSpec } from '@/core/simulate'

declare const self: DedicatedWorkerGlobalScope

self.onmessage = (e: MessageEvent<{ compiled: Compiled; minSpacing: number; wind: WindSpec }>) => {
  const { compiled, minSpacing, wind } = e.data
  try {
    let last = 0
    const result = simulate(compiled, minSpacing, wind, {
      record: 0.1,
      onProgress: (f) => {
        const now = performance.now()
        if (now - last > 100) { last = now; self.postMessage({ type: 'progress', fraction: f }) }
      },
    })
    self.postMessage({ type: 'done', result }, result.frames ? [result.frames.buffer] : [])
  } catch (err) {
    self.postMessage({ type: 'error', message: err instanceof Error ? err.message : String(err) })
  }
}
