// Keeps the compiled show in sync with the document. Latest edit wins: while
// one compile is running, only the newest pending document is queued.

import type { AudioMeta, ShowDoc } from '@/core/types'
import type { BeatResult } from '@/core/beats'
import { getState, useStore } from '@/state/store'

let worker: Worker | null = null
let busy = false
let pending: ShowDoc | null = null
let nextId = 1
const beatWaiters = new Map<number, (r: BeatResult) => void>()
const demoWaiters = new Map<number, { resolve: (d: ShowDoc) => void; reject: (e: Error) => void }>()
const musicWaiters = new Map<number, { resolve: (r: { pcm: Float32Array; sampleRate: number }) => void; reject: (e: Error) => void }>()

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
    } else if (m.type === 'demo') {
      demoWaiters.get(m.id)?.resolve(m.doc)
      demoWaiters.delete(m.id)
    } else if (m.type === 'music') {
      musicWaiters.get(m.id)?.resolve({ pcm: m.pcm, sampleRate: m.sampleRate })
      musicWaiters.delete(m.id)
    } else if (m.type === 'error') {
      if (musicWaiters.has(m.id)) {
        musicWaiters.get(m.id)!.reject(new Error(m.message))
        musicWaiters.delete(m.id)
      } else if (demoWaiters.has(m.id)) {
        demoWaiters.get(m.id)!.reject(new Error(m.message))
        demoWaiters.delete(m.id)
      } else if (beatWaiters.has(m.id)) {
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

/** Render generated music (from its stored recipe) in the engine worker. */
export function renderMusicAsync(meta: AudioMeta, sampleRate = 22050): Promise<{ pcm: Float32Array; sampleRate: number }> {
  const id = nextId++
  return new Promise((resolve, reject) => {
    musicWaiters.set(id, { resolve, reject })
    ensureWorker().postMessage({ type: 'render-music', id, meta, sampleRate })
  })
}

/** Build a (heavy) demo show in the engine worker. */
export function buildDemoAsync(demo: string): Promise<ShowDoc> {
  const id = nextId++
  return new Promise((resolve, reject) => {
    demoWaiters.set(id, { resolve, reject })
    ensureWorker().postMessage({ type: 'demo', id, demo })
  })
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
