// ============================================================================
// View Store — Canvas View Settings
// ============================================================================
// ARCHITECTURAL LAW: timeToCanvasX and canvasXToTime are the ONLY functions
// that convert between domain time and canvas coordinates.
// ============================================================================

import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import type { Vec3 } from '../graph/types'

export type GizmoMode = 'translate' | 'rotate' | 'scale'

export type CameraPreset = 'perspective' | 'front' | 'side' | 'top'

export type AudiencePreset = 'front-row' | 'mid-audience' | 'far-back' | 'aerial'

export type AudiencePOV = 'orbit' | 'first-person'
export type AudienceEnvId = 'night' | 'sunset' | 'dawn' | 'indoor'
export type AudienceDistanceId = 'close' | 'mid' | 'far' | 'custom'

export const AUDIENCE_DISTANCE_PRESETS: Record<Exclude<AudienceDistanceId, 'custom'>, number> = {
  close: 20,
  mid: 50,
  far: 100,
}

export interface AudienceState {
  panelOpen: boolean
  pov: AudiencePOV
  envId: AudienceEnvId
  distanceId: AudienceDistanceId
  distance: number
  yaw: number
  pitch: number
  target: [number, number, number]
  bloomEditor: boolean
  bloomAudience: boolean
  bloomIntensity: number
  emissiveIntensity: number
}

export interface SnapPlaneState {
  active: boolean
  position: Vec3
  rotationDeg: Vec3
  size: number
  cellSize: number
}

export interface TrailState {
  enabled: boolean
  windowSec: number
  samples: number
  selectedOnly: boolean
}

export interface ViewStoreState {
  pxPerSecond: number
  snapEnabled: boolean
  snapInterval: number
  gridVisible: boolean

  // 3D gizmo state
  gizmoMode: GizmoMode
  isDraggingGizmo: boolean

  // Viewport feature toggles
  showBoundingBoxes: boolean
  showAltitudeBands: boolean
  showSpeedVectors: boolean
  showStarfield: boolean
  showStats: boolean
  showGround: boolean
  postProcessingEnabled: boolean

  // Bundle 1
  audience: AudienceState

  // Bundle 2
  snapPlane: SnapPlaneState

  // Bundle 5 — beat snap toggle (works with audioStore beats)
  beatSnap: boolean

  // Bundle 6
  trails: TrailState

  setPxPerSecond: (v: number) => void
  toggleSnap: () => void
  setSnapInterval: (s: number) => void
  toggleGrid: () => void
  setGizmoMode: (mode: GizmoMode) => void
  setDraggingGizmo: (dragging: boolean) => void
  toggleBoundingBoxes: () => void
  toggleAltitudeBands: () => void
  toggleSpeedVectors: () => void
  toggleStarfield: () => void
  toggleStats: () => void
  toggleGround: () => void
  togglePostProcessing: () => void

  // Audience
  toggleAudiencePanel: () => void
  setAudiencePOV: (pov: AudiencePOV) => void
  setAudienceEnv: (envId: AudienceEnvId) => void
  setAudienceDistance: (id: AudienceDistanceId) => void
  setAudienceDistanceManual: (n: number) => void
  setAudienceYawPitch: (yaw: number, pitch: number) => void
  setAudienceTarget: (target: [number, number, number]) => void
  toggleBloom: (which: 'editor' | 'audience') => void
  setBloomIntensity: (n: number) => void
  setEmissiveIntensity: (n: number) => void

  // Snap plane
  toggleSnapPlane: () => void
  setSnapPlanePosition: (p: Vec3) => void
  setSnapPlaneRotationDeg: (r: Vec3) => void
  setSnapPlaneSize: (n: number) => void
  setSnapPlaneCellSize: (n: number) => void

  // Beat snap
  toggleBeatSnap: () => void

  // Trails
  toggleTrails: () => void
  setTrailWindow: (s: number) => void
  setTrailSamples: (n: number) => void
  toggleTrailsSelectedOnly: () => void
}

const STORAGE_KEY = 'drone-viewstore-persist-v2'
const LEGACY_STORAGE_KEY = 'drone-viewstore-persist-v1'

interface PersistShape {
  audience?: AudienceState
  snapPlane?: SnapPlaneState
  beatSnap?: boolean
  trails?: TrailState
  showStarfield?: boolean
  postProcessingEnabled?: boolean
}

function loadPersisted(): PersistShape {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return JSON.parse(raw) as PersistShape
    const legacy = localStorage.getItem(LEGACY_STORAGE_KEY)
    if (legacy) {
      // v2 turns editor bloom on by default; carry everything else over once.
      const data = JSON.parse(legacy) as PersistShape
      if (data.audience) data.audience.bloomEditor = true
      return data
    }
    return {}
  } catch {
    return {}
  }
}

function savePersisted(state: ViewStoreState) {
  try {
    const data: PersistShape = {
      audience: state.audience,
      snapPlane: state.snapPlane,
      beatSnap: state.beatSnap,
      trails: state.trails,
      showStarfield: state.showStarfield,
      postProcessingEnabled: state.postProcessingEnabled,
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
  } catch {
    /* ignore quota / privacy errors */
  }
}

const persisted = loadPersisted()

const defaultAudience: AudienceState = {
  panelOpen: false,
  pov: 'orbit',
  envId: 'night',
  distanceId: 'mid',
  distance: AUDIENCE_DISTANCE_PRESETS.mid,
  yaw: 0,
  pitch: -0.05,
  target: [0, 12, 0],
  bloomEditor: true,
  bloomAudience: true,
  bloomIntensity: 1.2,
  emissiveIntensity: 1.0,
}

const defaultSnapPlane: SnapPlaneState = {
  active: false,
  position: { x: 0, y: 0, z: 0 },
  rotationDeg: { x: 0, y: 0, z: 0 },
  size: 20,
  cellSize: 1,
}

const defaultTrails: TrailState = {
  enabled: false,
  windowSec: 4,
  samples: 32,
  selectedOnly: true,
}

export const useViewStore = create<ViewStoreState>()(
  immer((set, get) => ({
    pxPerSecond: 100,
    snapEnabled: true,
    snapInterval: 0.5,
    gridVisible: true,

    gizmoMode: 'translate' as GizmoMode,
    isDraggingGizmo: false,

    showBoundingBoxes: false,
    showAltitudeBands: false,
    showSpeedVectors: false,
    showStarfield: persisted.showStarfield ?? true,
    showStats: false,
    showGround: true,
    postProcessingEnabled: persisted.postProcessingEnabled ?? false,

    audience: { ...defaultAudience, ...persisted.audience },
    snapPlane: persisted.snapPlane ?? defaultSnapPlane,
    beatSnap: persisted.beatSnap ?? false,
    trails: persisted.trails ?? defaultTrails,

    setPxPerSecond(v) {
      set((state) => {
        state.pxPerSecond = Math.max(10, v)
      })
    },

    toggleSnap() {
      set((state) => {
        state.snapEnabled = !state.snapEnabled
      })
    },

    setSnapInterval(s) {
      set((state) => {
        state.snapInterval = Math.max(0.1, s)
      })
    },

    toggleGrid() {
      set((state) => {
        state.gridVisible = !state.gridVisible
      })
    },

    setGizmoMode(mode) {
      set((state) => {
        state.gizmoMode = mode
      })
    },

    setDraggingGizmo(dragging) {
      set((state) => {
        state.isDraggingGizmo = dragging
      })
    },

    toggleBoundingBoxes() {
      set((state) => { state.showBoundingBoxes = !state.showBoundingBoxes })
    },
    toggleAltitudeBands() {
      set((state) => { state.showAltitudeBands = !state.showAltitudeBands })
    },
    toggleSpeedVectors() {
      set((state) => { state.showSpeedVectors = !state.showSpeedVectors })
    },
    toggleStarfield() {
      set((state) => { state.showStarfield = !state.showStarfield })
      savePersisted(get())
    },
    toggleStats() {
      set((state) => { state.showStats = !state.showStats })
    },
    toggleGround() {
      set((state) => { state.showGround = !state.showGround })
    },
    togglePostProcessing() {
      set((state) => { state.postProcessingEnabled = !state.postProcessingEnabled })
      savePersisted(get())
    },

    toggleAudiencePanel() {
      set((state) => { state.audience.panelOpen = !state.audience.panelOpen })
      savePersisted(get())
    },
    setAudiencePOV(pov) {
      set((state) => { state.audience.pov = pov })
      savePersisted(get())
    },
    setAudienceEnv(envId) {
      set((state) => { state.audience.envId = envId })
      savePersisted(get())
    },
    setAudienceDistance(id) {
      set((state) => {
        state.audience.distanceId = id
        if (id !== 'custom') state.audience.distance = AUDIENCE_DISTANCE_PRESETS[id]
      })
      savePersisted(get())
    },
    setAudienceDistanceManual(n) {
      set((state) => {
        state.audience.distance = Math.max(1, n)
        state.audience.distanceId = 'custom'
      })
      savePersisted(get())
    },
    setAudienceYawPitch(yaw, pitch) {
      set((state) => {
        state.audience.yaw = yaw
        state.audience.pitch = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, pitch))
      })
    },
    setAudienceTarget(target) {
      set((state) => { state.audience.target = target })
    },
    toggleBloom(which) {
      set((state) => {
        if (which === 'editor') state.audience.bloomEditor = !state.audience.bloomEditor
        else state.audience.bloomAudience = !state.audience.bloomAudience
      })
      savePersisted(get())
    },
    setBloomIntensity(n) {
      set((state) => { state.audience.bloomIntensity = Math.max(0, Math.min(5, n)) })
      savePersisted(get())
    },
    setEmissiveIntensity(n) {
      set((state) => { state.audience.emissiveIntensity = Math.max(0, Math.min(5, n)) })
      savePersisted(get())
    },

    toggleSnapPlane() {
      set((state) => { state.snapPlane.active = !state.snapPlane.active })
      savePersisted(get())
    },
    setSnapPlanePosition(p) {
      set((state) => { state.snapPlane.position = p })
      savePersisted(get())
    },
    setSnapPlaneRotationDeg(r) {
      set((state) => { state.snapPlane.rotationDeg = r })
      savePersisted(get())
    },
    setSnapPlaneSize(n) {
      set((state) => { state.snapPlane.size = Math.max(2, n) })
      savePersisted(get())
    },
    setSnapPlaneCellSize(n) {
      set((state) => { state.snapPlane.cellSize = Math.max(0.1, n) })
      savePersisted(get())
    },

    toggleBeatSnap() {
      set((state) => { state.beatSnap = !state.beatSnap })
      savePersisted(get())
    },

    toggleTrails() {
      set((state) => { state.trails.enabled = !state.trails.enabled })
      savePersisted(get())
    },
    setTrailWindow(s) {
      set((state) => { state.trails.windowSec = Math.max(0.5, Math.min(30, s)) })
      savePersisted(get())
    },
    setTrailSamples(n) {
      set((state) => { state.trails.samples = Math.max(4, Math.min(256, Math.round(n))) })
      savePersisted(get())
    },
    toggleTrailsSelectedOnly() {
      set((state) => { state.trails.selectedOnly = !state.trails.selectedOnly })
      savePersisted(get())
    },
  })),
)

// --- Pure helpers (the ONLY time ↔ canvas converters) ---

export function timeToCanvasX(time: number, pxPerSecond: number): number {
  return time * pxPerSecond
}

export function canvasXToTime(x: number, pxPerSecond: number): number {
  return x / pxPerSecond
}
