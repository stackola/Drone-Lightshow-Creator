import { create } from 'zustand'
import { produce, type Draft } from 'immer'
import type { ShowDoc } from '@/core/types'
import type { Compiled } from '@/core/compile'
import type { Issue, Validation } from '@/core/validate'
import { newShow } from '@/core/defaults'

export type Selection =
  | { kind: 'show' }
  | { kind: 'takeoff' }
  | { kind: 'landing' }
  | { kind: 'scene'; id: string }
  | { kind: 'flight'; id: string }
  | { kind: 'cue'; id: string }

export type CameraMode = 'audience' | 'orbit' | 'top'

/** Viewport tool for the selected formation. */
export type Tool = 'select' | 'move' | 'rotate' | 'scale'

export interface Toast {
  id: number
  text: string
  kind: 'info' | 'err'
}

export interface AudioRuntime {
  buffer: AudioBuffer
  peaks: Float32Array
  bytes: ArrayBuffer
  mime: string
}

interface State {
  doc: ShowDoc
  past: { doc: ShowDoc; label: string }[]
  future: { doc: ShowDoc; label: string }[]
  lastKey: string | null
  lastAt: number

  selection: Selection
  compiled: Compiled | null
  validation: Validation | null
  computing: boolean
  engineError: string | null

  time: number
  playing: boolean
  loop: boolean
  rate: number
  camera: CameraMode
  cameraNonce: number
  presenting: boolean
  focus: Issue | null
  snap: boolean
  audio: AudioRuntime | null
  toasts: Toast[]
  dialog: null | 'new' | 'export' | 'shortcuts' | 'ai-settings' | 'director' | 'describe' | 'pitch' | 'model3d' | 'wind' | 'site'
  /** Layer an AI dialog is improving (e.g. an existing 3D model). */
  aiTarget: { sceneId: string; layerId: string } | null
  /** Which tool the right-hand panel shows. */
  rightTab: 'inspector' | 'copilot'
  /** Viewport manipulation tool. */
  tool: Tool
  /** Auto-key: with the playhead inside the selected formation's hold, the gizmo sets keyframes. */
  autoKey: boolean
  /** Ask the camera to fly to a region (F: frame selection). */
  frameRequest: { center: [number, number, number]; radius: number; nonce: number } | null
}

interface Actions {
  /** Apply an edit. Edits sharing `key` within 1.2 s merge into one undo step (drags, typing). */
  update(recipe: (d: Draft<ShowDoc>) => void, label?: string, key?: string): void
  replaceDoc(doc: ShowDoc, label?: string): void
  loadDoc(doc: ShowDoc): void
  undo(): void
  redo(): void
  /** Collapse every history entry recorded since `fromLength` into one undo step. */
  squashHistory(fromLength: number, label: string): void
  select(sel: Selection): void
  setTime(t: number): void
  setPlaying(p: boolean): void
  setCamera(c: CameraMode): void
  toast(text: string, kind?: Toast['kind']): void
  set(partial: Partial<State>): void
}

const MERGE_MS = 1200
const HISTORY = 200
let toastId = 0

export const useStore = create<State & Actions>()((set, get) => ({
  doc: newShow(),
  past: [],
  future: [],
  lastKey: null,
  lastAt: 0,
  selection: { kind: 'show' },
  compiled: null,
  validation: null,
  computing: false,
  engineError: null,
  time: 0,
  playing: false,
  loop: false,
  rate: 1,
  camera: 'audience',
  cameraNonce: 0,
  presenting: false,
  focus: null,
  snap: true,
  audio: null,
  toasts: [],
  dialog: null,
  rightTab: 'inspector',
  aiTarget: null,
  tool: 'move',
  autoKey: false,
  frameRequest: null,

  update(recipe, label = 'Edit', key) {
    const { doc, past, lastKey, lastAt } = get()
    const next = produce(doc, recipe)
    if (next === doc) return
    const now = performance.now()
    const merge = key !== undefined && key === lastKey && now - lastAt < MERGE_MS
    set({
      doc: next,
      past: merge ? past : [...past.slice(-HISTORY + 1), { doc, label }],
      future: [],
      lastKey: key ?? null,
      lastAt: now,
    })
  },

  replaceDoc(doc, label = 'Edit') {
    const { doc: prev, past } = get()
    set({ doc, past: [...past.slice(-HISTORY + 1), { doc: prev, label }], future: [], lastKey: null })
  },

  loadDoc(doc) {
    set({ doc, past: [], future: [], lastKey: null, selection: { kind: 'show' }, time: 0, playing: false, focus: null, compiled: null, validation: null })
  },

  undo() {
    const { past, future, doc } = get()
    const prev = past[past.length - 1]
    if (!prev) return
    set({ doc: prev.doc, past: past.slice(0, -1), future: [{ doc, label: prev.label }, ...future], lastKey: null })
    get().toast(`Undo: ${prev.label}`)
  },

  redo() {
    const { past, future, doc } = get()
    const next = future[0]
    if (!next) return
    set({ doc: next.doc, future: future.slice(1), past: [...past, { doc, label: next.label }], lastKey: null })
    get().toast(`Redo: ${next.label}`)
  },

  squashHistory(fromLength, label) {
    const { past } = get()
    if (past.length <= fromLength) return
    const first = past[fromLength]!
    set({ past: [...past.slice(0, fromLength), { doc: first.doc, label }], future: [], lastKey: null })
  },

  select(selection) {
    set({ selection })
  },

  setTime(t) {
    const d = get().compiled?.duration ?? 0
    set({ time: Math.max(0, Math.min(d || t, t)) })
  },

  setPlaying(playing) {
    set({ playing })
  },

  setCamera(camera) {
    set({ camera, cameraNonce: get().cameraNonce + 1 })
  },

  toast(text, kind = 'info') {
    const id = ++toastId
    set({ toasts: [...get().toasts.slice(-3), { id, text, kind }] })
    setTimeout(() => set({ toasts: get().toasts.filter((t) => t.id !== id) }), kind === 'err' ? 5000 : 2200)
  },

  set(partial) {
    set(partial)
  },
}))

export const getState = useStore.getState
