// ============================================================================
// UI Mode Store — editor mode + view (camera) selection
// ============================================================================
// Separate from viewStore (which owns camera toggles / snap plane / audience).
// This owns the *mode* (which surfaces render) and the build-mode *view* (which
// camera rig + default plane). 'build' is the default landing mode; 'graph' is
// the classic node editor, one click away. Persisted under drone-uimode-v1, but
// e2e seeds {mode:'graph'} so the legacy suite lands in the graph editor.
// ============================================================================

import { create } from 'zustand'
import type { PlaneKind } from '../graph/buildPlane'

export type EditorMode = 'build' | 'graph' | 'audience'
export type ViewId = 'iso' | 'perspective' | 'top' | 'front' | 'side'
export type CameraKind = 'orthographic' | 'perspective'

export interface ViewDef {
  id: ViewId
  label: string
  cameraKind: CameraKind
  /** Azimuth around Y (radians). */
  yaw: number
  /** Elevation (radians, negative looks down). */
  pitch: number
  defaultPlaneKind: PlaneKind
  target: [number, number, number]
  /** Orbit distance (perspective dolly / ortho pivot offset). */
  distance: number
}

// True isometric looks down at atan(1/√2) ≈ 35.264°, yawed to a front corner.
const ISO_PITCH = -Math.atan(1 / Math.SQRT2)

export const VIEW_DEFS: Record<ViewId, ViewDef> = {
  iso: { id: 'iso', label: 'Isometric', cameraKind: 'orthographic', yaw: Math.PI / 4, pitch: ISO_PITCH, defaultPlaneKind: 'ground-xz', target: [0, 8, 0], distance: 80 },
  perspective: { id: 'perspective', label: 'Perspective', cameraKind: 'perspective', yaw: Math.PI / 4, pitch: -0.5, defaultPlaneKind: 'ground-xz', target: [0, 8, 0], distance: 70 },
  top: { id: 'top', label: 'Top', cameraKind: 'orthographic', yaw: 0, pitch: -Math.PI / 2 + 0.0001, defaultPlaneKind: 'ground-xz', target: [0, 0, 0], distance: 80 },
  front: { id: 'front', label: 'Front', cameraKind: 'orthographic', yaw: 0, pitch: 0, defaultPlaneKind: 'vertical-xy', target: [0, 10, 0], distance: 80 },
  side: { id: 'side', label: 'Side', cameraKind: 'orthographic', yaw: Math.PI / 2, pitch: 0, defaultPlaneKind: 'vertical-zy', target: [0, 10, 0], distance: 80 },
}

export interface UiModeState {
  mode: EditorMode
  viewId: ViewId
  graphDockOpen: boolean
  isTweening: boolean

  setMode: (m: EditorMode) => void
  setView: (v: ViewId) => void
  toggleGraphDock: () => void
  setTweening: (t: boolean) => void
}

const STORAGE_KEY = 'drone-uimode-v1'

interface PersistShape {
  mode?: EditorMode
  viewId?: ViewId
  graphDockOpen?: boolean
}

function loadPersisted(): PersistShape {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    return JSON.parse(raw) as PersistShape
  } catch {
    return {}
  }
}

function savePersisted(s: UiModeState) {
  try {
    const data: PersistShape = { mode: s.mode, viewId: s.viewId, graphDockOpen: s.graphDockOpen }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
  } catch {
    /* ignore quota / privacy errors */
  }
}

const persisted = loadPersisted()

export const useUiModeStore = create<UiModeState>()((set, get) => ({
  mode: persisted.mode ?? 'build',
  viewId: persisted.viewId ?? 'iso',
  graphDockOpen: persisted.graphDockOpen ?? false,
  isTweening: false,

  setMode(m) {
    set({ mode: m })
    savePersisted(get())
  },
  setView(v) {
    set({ viewId: v })
    savePersisted(get())
  },
  toggleGraphDock() {
    set((s) => ({ graphDockOpen: !s.graphDockOpen }))
    savePersisted(get())
  },
  setTweening(t) {
    set({ isTweening: t })
  },
}))
