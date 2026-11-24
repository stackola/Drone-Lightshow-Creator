// Keeps the compiled show in sync with the document. Latest edit wins: while
// one compile is running, only the newest pending document is queued.

import type { ShowDoc } from '@/core/types'
import type { BeatResult } from '@/core/beats'
import { getState, useStore } from '@/state/store'

let worker: Worker | null = null
let busy = false
let pending: ShowDoc | null = null
let nextId = 1
const beatWaiters = new Map<number, (r: BeatResult) => void>()

function ensureWorker(): Worker {
  if (worker) return worker
  worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
  worker.onmessage = (e) => {
    const m = e.data
    if (m.type === 'compiled') {
      const s = getState()
      s.set({ compiled: m.compiled, validation: m.validation, engineError: null })
      // Keep the playhead inside the show.
      if (s.time > m.compiled.duration) s.set({ time: m.compiled.duration })
      done()
    } else if (m.type === 'beats') {
      beatWaiters.get(m.id)?.(m.result)
      beatWaiters.delete(m.id)
    } else if (m.type === 'error') {
      if (beatWaiters.has(m.id)) {
        beatWaiters.delete(m.id)
        getState().toast(`Beat detection failed: ${m.message}`, 'err')
      } else {
        getState().set({ engineError: m.message })
        done()
      }
    }
  }
  worker.onerror = (e) => {
    getState().set({ engineError: e.message || 'Engine crashed' })
    busy = false
  }
  return worker
}

function done() {
  busy = false
  if (pending) {
    const d = pending
    pending = null
    send(d)
  } else {
    getState().set({ computing: false })
  }
}

function send(doc: ShowDoc) {
  busy = true
  getState().set({ computing: true })
  ensureWorker().postMessage({ type: 'compile', id: nextId++, doc })
}

export function requestCompile(doc: ShowDoc) {
  if (busy) pending = doc
  else send(doc)
}

export function detectBeatsAsync(samples: Float32Array, sampleRate: number): Promise<BeatResult> {
  const id = nextId++
  return new Promise((resolve) => {
    beatWaiters.set(id, resolve)
    ensureWorker().postMessage({ type: 'beats', id, samples, sampleRate }, [samples.buffer])
  })
}

/** Start syncing: compile now and after every document change. */
export function startEngine() {
  requestCompile(getState().doc)
  useStore.subscribe((s, prev) => {
    if (s.doc !== prev.doc) requestCompile(s.doc)
  })
}
