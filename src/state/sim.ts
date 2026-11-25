// Wind test state: the latest simulation, its progress, and whether the
// viewport shows the simulated (blown-about) flight instead of the plan.

import { create } from 'zustand'
import type { Compiled } from '@/core/compile'
import type { SimResult, WindSpec } from '@/core/simulate'
import { getState } from './store'

interface SimState {
  wind: WindSpec
  running: boolean
  progress: number
  result: SimResult | null
  /** The compiled show the result belongs to (stale once the show changes). */
  forCompiled: Compiled | null
  /** Show the simulated positions in the viewport. */
  view: boolean
  error: string | null
}

export const useSim = create<SimState>()(() => ({
  wind: { speed: 5, from: 270, gust: 2.5, turbulence: 0.6, seed: 1 },
  running: false,
  progress: 0,
  result: null,
  forCompiled: null,
  view: false,
  error: null,
}))

let worker: Worker | null = null

export function cancelSim() {
  worker?.terminate()
  worker = null
  useSim.setState({ running: false, progress: 0 })
}

export function runSim(wind: WindSpec = useSim.getState().wind) {
  const { compiled, doc } = getState()
  if (!compiled) return
  cancelSim()
  const w = new Worker(new URL('../engine/simWorker.ts', import.meta.url), { type: 'module' })
  worker = w
  useSim.setState({ wind, running: true, progress: 0, error: null })
  w.onmessage = (e) => {
    const m = e.data
    if (m.type === 'progress') useSim.setState({ progress: m.fraction })
    else if (m.type === 'done') {
      useSim.setState({ running: false, progress: 1, result: m.result as SimResult, forCompiled: compiled })
      w.terminate()
      if (worker === w) worker = null
    } else if (m.type === 'error') {
      useSim.setState({ running: false, error: m.message })
      w.terminate()
      if (worker === w) worker = null
    }
  }
  w.onerror = (e) => {
    useSim.setState({ running: false, error: e.message || 'Simulation failed' })
    if (worker === w) worker = null
  }
  w.postMessage({ compiled, minSpacing: doc.limits.minSpacing, wind })
}

/** Simulated positions at show time t (linear between recorded frames), or false if there are none for this show. */
export function simPositions(compiled: Compiled, t: number, out: Float32Array): boolean {
  const { result, forCompiled, view } = useSim.getState()
  if (!view || !result?.frames || forCompiled !== compiled) return false
  const n = compiled.n, f = result.frames
  const count = f.length / (n * 3)
  const x = Math.max(0, Math.min(count - 1, t / result.frameDt))
  const a = Math.floor(x), b = Math.min(count - 1, a + 1), k = x - a
  const oa = a * n * 3, ob = b * n * 3
  for (let i = 0; i < n * 3; i++) out[i] = f[oa + i]! + (f[ob + i]! - f[oa + i]!) * k
  return true
}

/** Run the wind test and wait for the result (for the copilot). */
export function runSimAsync(wind: WindSpec): Promise<SimResult> {
  return new Promise((resolve, reject) => {
    if (!getState().compiled) { reject(new Error('The show is still being planned.')); return }
    runSim(wind)
    const unsub = useSim.subscribe((st) => {
      if (st.running) return
      unsub()
      if (st.error) reject(new Error(st.error))
      else if (st.result) resolve(st.result)
      else reject(new Error('The wind test was stopped.'))
    })
  })
}
