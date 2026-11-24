/// <reference lib="webworker" />
// Compiles and validates shows off the main thread, and runs beat tracking.

import { compile } from '@/core/compile'
import { validate } from '@/core/validate'
import { detectBeats } from '@/core/beats'
import type { ShowDoc } from '@/core/types'
import { demoById } from '@/app/demos'
import { setTextRasterizer } from '@/core/defaults'
import { canvasTextMask } from './textRaster'

// Real fonts in the worker too (falls back to the dot-matrix font where OffscreenCanvas is missing).
if (typeof OffscreenCanvas !== 'undefined') setTextRasterizer(canvasTextMask)

export type WorkerRequest =
  | { type: 'compile'; id: number; doc: ShowDoc }
  | { type: 'beats'; id: number; samples: Float32Array; sampleRate: number }
  | { type: 'demo'; id: number; demo: string }

declare const self: DedicatedWorkerGlobalScope

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const m = e.data
  try {
    if (m.type === 'compile') {
      const t0 = performance.now()
      const compiled = compile(m.doc)
      const validation = validate(m.doc, compiled)
      self.postMessage({ type: 'compiled', id: m.id, compiled, validation, ms: performance.now() - t0 })
    } else if (m.type === 'beats') {
      self.postMessage({ type: 'beats', id: m.id, result: detectBeats(m.samples, m.sampleRate) })
    } else if (m.type === 'demo') {
      // Building also warms this worker's planning caches, so the compile that follows is quick.
      const demo = demoById(m.demo)
      if (!demo) throw new Error(`Unknown demo ${m.demo}`)
      self.postMessage({ type: 'demo', id: m.id, doc: demo.build() })
    }
  } catch (err) {
    self.postMessage({ type: 'error', id: m.id, message: err instanceof Error ? err.message : String(err) })
  }
}
