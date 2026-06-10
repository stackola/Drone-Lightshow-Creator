// ============================================================================
// Viewport Overlays — Camera presets, stats HUD, starfield, bounding boxes
// ============================================================================

import { useRef, useState, useEffect } from 'react'
import { useThree, useFrame } from '@react-three/fiber'
import { GizmoHelper, GizmoViewport, Stars } from '@react-three/drei'
import * as THREE from 'three'
import { useViewStore } from '../../stores/viewStore'
import { useGraphStore } from '../../stores/graphStore'
import { usePlayheadStore } from '../../stores/playheadStore'
import { useProjectStore } from '../../stores/projectStore'
import { useFormationStore } from '../../stores/formationStore'
import { useSelectionStore } from '../../stores/selectionStore'
import type { CameraPreset } from '../../stores/viewStore'
import type { FormationNodeData } from '../../graph/types'
import {
  Eye, Box, Layers, BarChart3, Sparkles,
} from 'lucide-react'
import { Tooltip } from '../Tooltip'

// ============================================================================
// Camera Preset Definitions
// ============================================================================

const CAMERA_PRESETS: Record<CameraPreset, { position: [number, number, number]; target: [number, number, number]; label: string }> = {
  perspective: { position: [0, 30, 40], target: [0, 5, 0], label: 'Persp' },
  front:       { position: [0, 10, 60], target: [0, 10, 0], label: 'Front' },
  side:        { position: [60, 10, 0], target: [0, 10, 0], label: 'Side' },
  top:         { position: [0, 60, 0.01], target: [0, 0, 0], label: 'Top' },
}

// ============================================================================
// Camera Preset Buttons — Top-right overlay
// ============================================================================

export function CameraPresetButtons() {
  const audienceOpen = useViewStore((s) => s.audience.panelOpen)
  const togglePanel = useViewStore((s) => s.toggleAudiencePanel)
  const toggleBloom = useViewStore((s) => s.toggleBloom)
  const bloomEditor = useViewStore((s) => s.audience.bloomEditor)

  return (
    <div className="absolute top-2 right-2 z-10 flex flex-col items-end gap-1">
      {/* Editor camera presets */}
      <div className="flex gap-0.5 bg-surface-raised/90 backdrop-blur-sm rounded-lg p-0.5 border border-white/10">
        {(Object.keys(CAMERA_PRESETS) as CameraPreset[]).map((preset) => (
          <CameraPresetBtn key={preset} preset={preset} />
        ))}
      </div>

      {/* Audience pin + editor bloom toggle */}
      <div className="flex items-center gap-1">
        <Tooltip label={bloomEditor ? 'Disable editor bloom' : 'Enable editor bloom'} side="bottom">
          <button
            className={`flex items-center gap-1 px-2 py-1 text-micro rounded-lg border transition-colors bg-surface-raised/90 backdrop-blur-sm ${
              bloomEditor ? 'border-accent-transition/50 text-fuchsia-300' : 'border-white/10 text-white/40 hover:text-white/60'
            }`}
            onClick={() => toggleBloom('editor')}
            aria-label="Toggle editor bloom"
          >
            ✨ Bloom
          </button>
        </Tooltip>
        <Tooltip label={audienceOpen ? 'Close audience view' : 'Open audience view'} side="bottom">
          <button
            className={`flex items-center gap-1 px-2 py-1 text-micro rounded-lg border transition-colors bg-surface-raised/90 backdrop-blur-sm ${
              audienceOpen ? 'border-cyan-500/50 text-cyan-400' : 'border-white/10 text-white/40 hover:text-white/60'
            }`}
            onClick={togglePanel}
            aria-label="Toggle audience view"
          >
            <Eye size={11} />
            {audienceOpen ? 'Unpin' : 'Audience'}
          </button>
        </Tooltip>
      </div>
    </div>
  )
}

// Global event for camera preset changes (bridges HTML overlay → R3F Canvas)
type CameraTarget = { position: [number, number, number]; target: [number, number, number] }
const cameraEventTarget = new EventTarget()

export function dispatchCameraPreset(ct: CameraTarget) {
  cameraEventTarget.dispatchEvent(new CustomEvent('camera-preset', { detail: ct }))
}

// Place inside <Canvas> to listen for camera preset events
export function CameraPresetListener() {
  const { camera, controls } = useThree()

  useEffect(() => {
    const handler = (e: Event) => {
      const { position, target } = (e as CustomEvent<CameraTarget>).detail
      camera.position.set(...position)
      if (controls && 'target' in controls) {
        (controls as any).target.set(...target)
      }
      camera.lookAt(...target)
      camera.updateProjectionMatrix()
    }
    cameraEventTarget.addEventListener('camera-preset', handler)
    return () => cameraEventTarget.removeEventListener('camera-preset', handler)
  }, [camera, controls])

  return null
}

function CameraPresetBtn({ preset }: { preset: CameraPreset }) {
  const p = CAMERA_PRESETS[preset]
  return (
    <button
      className="px-2 py-1 text-micro text-white/50 hover:text-white/80 hover:bg-white/10 rounded-md transition-colors"
      onClick={() => dispatchCameraPreset({ position: p.position, target: p.target })}
      title={p.label}
    >
      {p.label}
    </button>
  )
}

// ============================================================================
// Viewport Settings Dropdown — Bottom-right toggles
// ============================================================================

export function ViewportSettingsButton() {
  const [open, setOpen] = useState(false)
  const showBoundingBoxes = useViewStore((s) => s.showBoundingBoxes)
  const showStarfield = useViewStore((s) => s.showStarfield)
  const showStats = useViewStore((s) => s.showStats)
  const trailsEnabled = useViewStore((s) => s.trails.enabled)
  const trailsWindow = useViewStore((s) => s.trails.windowSec)
  const toggleBoundingBoxes = useViewStore((s) => s.toggleBoundingBoxes)
  const toggleStarfield = useViewStore((s) => s.toggleStarfield)
  const toggleStats = useViewStore((s) => s.toggleStats)
  const toggleTrails = useViewStore((s) => s.toggleTrails)
  const setTrailWindow = useViewStore((s) => s.setTrailWindow)

  return (
    <div className="absolute bottom-14 right-2 z-10">
      <Tooltip label="Viewport settings" side="left">
        <button
          className={`p-1.5 rounded-lg border transition-colors bg-surface-raised/90 backdrop-blur-sm ${
            open ? 'border-cyan-500/50 text-cyan-400' : 'border-white/10 text-white/40 hover:text-white/60'
          }`}
          onClick={() => setOpen(!open)}
          aria-label="Viewport settings"
        >
          <Layers size={14} />
        </button>
      </Tooltip>

      {open && (
        <div className="absolute bottom-full right-0 mb-1 bg-surface-raised/95 backdrop-blur-sm rounded-lg border border-white/10 overflow-hidden min-w-[180px] p-1">
          <ToggleRow label="Starfield" icon={Sparkles} active={showStarfield} onToggle={toggleStarfield} />
          <ToggleRow label="Bounding Boxes" icon={Box} active={showBoundingBoxes} onToggle={toggleBoundingBoxes} />
          <ToggleRow label="Stats HUD" icon={BarChart3} active={showStats} onToggle={toggleStats} />
          <ToggleRow label="Drone Trails" icon={Layers} active={trailsEnabled} onToggle={toggleTrails} />
          {trailsEnabled && (
            <div className="px-2 py-1 text-micro text-white/40">
              <div className="flex justify-between">
                <span>Window</span>
                <span className="text-white/70">{trailsWindow.toFixed(1)}s</span>
              </div>
              <input
                type="range"
                min={1}
                max={20}
                step={0.5}
                value={trailsWindow}
                onChange={(e) => setTrailWindow(Number(e.target.value))}
                className="w-full accent-cyan-400"
              />
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function ToggleRow({ label, icon: Icon, active, onToggle }: { label: string; icon: typeof Box; active: boolean; onToggle: () => void }) {
  return (
    <button
      className={`w-full flex items-center gap-2 px-2 py-1.5 text-micro rounded transition-colors ${
        active ? 'text-cyan-400 bg-cyan-500/10' : 'text-white/40 hover:text-white/60 hover:bg-white/5'
      }`}
      onClick={onToggle}
    >
      <Icon size={11} />
      {label}
    </button>
  )
}

// ============================================================================
// Stats HUD — FPS, drone count, time, etc.
// ============================================================================

export function StatsHUD() {
  const show = useViewStore((s) => s.showStats)
  if (!show) return null

  return <StatsHUDInner />
}

function StatsHUDInner() {
  const droneCount = useProjectStore((s) => s.dronePool.droneCount)
  const currentTime = usePlayheadStore((s) => s.currentTime)
  const nodeCount = useGraphStore((s) => s.nodes.length)
  const formationCount = useFormationStore((s) => s.formations.length)

  return (
    <div className="absolute top-14 left-2 z-10 bg-surface-raised/80 backdrop-blur-sm rounded-lg border border-white/10 px-2 py-1.5 space-y-0.5 font-mono">
      <StatsHUDFPSCounter />
      <div className="text-micro text-white/40">Drones: <span className="text-white/70">{droneCount}</span></div>
      <div className="text-micro text-white/40">Formations: <span className="text-white/70">{formationCount}</span></div>
      <div className="text-micro text-white/40">Nodes: <span className="text-white/70">{nodeCount}</span></div>
      <div className="text-micro text-white/40">Time: <span className="text-white/70">{currentTime.toFixed(2)}s</span></div>
    </div>
  )
}

// Module-level render frame counter — incremented by RenderFrameCounter inside Canvas
let _renderFrameCount = 0
let _renderFps = 60
let _renderFpsLastTime = performance.now()

/** Place this inside a R3F Canvas to count actual render frames */
export function RenderFrameCounter() {
  useFrame(() => {
    _renderFrameCount++
    const now = performance.now()
    if (now - _renderFpsLastTime >= 500) {
      _renderFps = Math.round(_renderFrameCount / ((now - _renderFpsLastTime) / 1000))
      _renderFrameCount = 0
      _renderFpsLastTime = now
    }
  })
  return null
}

function StatsHUDFPSCounter() {
  const [fps, setFps] = useState(60)
  const historyRef = useRef<number[]>([])

  useEffect(() => {
    const interval = setInterval(() => {
      setFps(_renderFps)
      const h = historyRef.current
      h.push(_renderFps)
      if (h.length > 60) h.shift()
    }, 250)
    return () => clearInterval(interval)
  }, [])

  const color = fps >= 55 ? 'text-green-400' : fps >= 30 ? 'text-amber-400' : 'text-red-400'

  // F-02 — rolling FPS sparkline. Last 60 samples (~15 seconds at 250 ms tick)
  // rendered as a tiny SVG plot under the numeric readout. Cheap; redraws on
  // each setState above.
  const W = 80
  const H = 14
  const samples = historyRef.current
  const max = 60 // assume target FPS is 60; samples above get clamped
  const pathD = samples.length > 1
    ? samples.map((v, i) => {
        const x = (i / (samples.length - 1)) * W
        const y = H - Math.min(v, max) / max * H
        return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`
      }).join(' ')
    : ''

  return (
    <div className="text-micro text-white/40 flex items-center gap-2">
      <span>FPS: <span className={color}>{fps}</span></span>
      {samples.length > 1 && (
        <svg width={W} height={H} className="bg-black/20 rounded">
          {/* 30-fps reference line */}
          <line x1={0} y1={H * 0.5} x2={W} y2={H * 0.5} stroke="white" strokeOpacity={0.08} strokeWidth={0.5} />
          <path d={pathD} fill="none" stroke={fps >= 55 ? '#34d399' : fps >= 30 ? '#fbbf24' : '#f87171'} strokeWidth={1} strokeLinecap="round" />
        </svg>
      )}
    </div>
  )
}

// ============================================================================
// Starfield Background — 2000 stars on distant sphere
// ============================================================================

export function Starfield() {
  const show = useViewStore((s) => s.showStarfield)
  if (!show) return null
  return (
    <Stars
      radius={200}
      depth={80}
      count={2000}
      factor={4}
      saturation={0}
      fade
      speed={0.5}
    />
  )
}

// ============================================================================
// Orientation Gizmo — Bottom-right axis cube
// ============================================================================

export function OrientationGizmo() {
  return (
    <GizmoHelper alignment="bottom-right" margin={[60, 60]}>
      <GizmoViewport
        axisColors={['#ef4444', '#22c55e', '#3b82f6']}
        labelColor="white"
      />
    </GizmoHelper>
  )
}

// ============================================================================
// Formation Bounding Boxes — Wireframe AABB around active formations
// ============================================================================

export function FormationBoundingBoxes() {
  const show = useViewStore((s) => s.showBoundingBoxes)
  if (!show) return null
  return <BoundingBoxesInner />
}

// Shared material — avoids creating new materials every frame
const _sharedBBoxMaterial = new THREE.LineBasicMaterial({ color: 0x00ffff, transparent: true, opacity: 0.3 })

function BoundingBoxesInner() {
  const groupRef = useRef<THREE.Group>(null)

  useFrame(() => {
    if (!groupRef.current) return

    const { nodes } = useGraphStore.getState()
    const { currentTime } = usePlayheadStore.getState()
    const { generatedPoints } = useFormationStore.getState()

    // Collect active formation nodes
    const activeFormations: { points: THREE.Vector3[] }[] = []

    for (const node of nodes) {
      if (node.type !== 'formation') continue
      const data = node.data as FormationNodeData
      const localTime = currentTime - data.startTime
      if (localTime < 0 || localTime > data.duration) continue

      const pts = data.formationId ? generatedPoints.get(data.formationId) : null
      if (!pts || pts.length === 0) continue

      const transform = data.transform
      const worldPts = pts.map((p) => new THREE.Vector3(
        p.x * transform.scale.x + transform.position.x,
        p.y * transform.scale.y + transform.position.y,
        p.z * transform.scale.z + transform.position.z,
      ))
      activeFormations.push({ points: worldPts })
    }

    // Update children — pool and reuse helpers
    const children = groupRef.current.children
    // Remove excess and dispose
    while (children.length > activeFormations.length) {
      const child = children[children.length - 1]
      if (child) {
        groupRef.current.remove(child)
        if ((child as THREE.Box3Helper).geometry) (child as THREE.Box3Helper).geometry.dispose()
      }
    }
    // Add missing — reuse shared material
    while (children.length < activeFormations.length) {
      const box = new THREE.Box3()
      const helper = new THREE.Box3Helper(box, new THREE.Color(0x00ffff))
      helper.material = _sharedBBoxMaterial
      groupRef.current.add(helper)
    }

    // Update boxes
    for (let i = 0; i < activeFormations.length; i++) {
      const formation = activeFormations[i]!
      const helper = children[i] as THREE.Box3Helper
      if (!helper) continue
      const box = new THREE.Box3()
      for (const p of formation.points) {
        box.expandByPoint(p)
      }
      // Expand slightly for visual clarity
      box.expandByScalar(0.5)
      helper.box.copy(box)
      helper.updateMatrixWorld(true)
    }
  })

  return <group ref={groupRef} />
}

// ============================================================================
// Selection Bounding Box — always-on cyan box around the selected formation
// ============================================================================
// Differs from `FormationBoundingBoxes` (which is toggleable and covers every
// active formation in a faint cyan). This one only renders for the currently
// selected single formation, with stronger opacity + a tighter padding, so the
// user can always see exactly which swarm is being edited.

const _selectionBBoxMaterial = new THREE.LineBasicMaterial({ color: 0x22d3ee, transparent: true, opacity: 0.85 })
// B-09: error variant for the single-select bounding box — red when the
// selected formation has at least one error-severity diagnostic. The
// material instance is swapped on the helper; the helper itself doesn't
// reset.
const _selectionBBoxErrorMaterial = new THREE.LineBasicMaterial({ color: 0xf87171, transparent: true, opacity: 0.95 })
// O-06: multi-select uses a warmer amber so the user can tell at a glance
// they're looking at the combined extent of N formations, not a single one.
const _multiSelectBBoxMaterial = new THREE.LineBasicMaterial({ color: 0xfbbf24, transparent: true, opacity: 0.7 })

export function SelectionBoundingBox() {
  const selectedNodeIds = useSelectionStore((s) => s.selectedNodeIds)
  if (selectedNodeIds.length === 0) return null
  if (selectedNodeIds.length === 1) return <SelectionBoxInner nodeId={selectedNodeIds[0]!} />
  return <MultiSelectBoxInner nodeIds={selectedNodeIds} />
}

// B-09: yellow bounding box drawn around a hovered (but not yet selected)
// formation node. Renders independently of `SelectionBoundingBox` so the
// user can see "you'd be selecting this one" without losing the current
// selection's visual.
const _hoverBBoxMaterial = new THREE.LineBasicMaterial({ color: 0xfacc15, transparent: true, opacity: 0.5 })

export function HoverBoundingBox() {
  const hoveredNodeId = useSelectionStore((s) => s.hoveredNodeId)
  const selectedNodeIds = useSelectionStore((s) => s.selectedNodeIds)
  if (!hoveredNodeId || selectedNodeIds.includes(hoveredNodeId)) return null
  return <HoverBoxInner nodeId={hoveredNodeId} />
}

function HoverBoxInner({ nodeId }: { nodeId: string }) {
  const helperRef = useRef<THREE.Box3Helper | null>(null)
  const groupRef = useRef<THREE.Group>(null)
  const reuseBox = useRef(new THREE.Box3())
  const reusePoint = useRef(new THREE.Vector3())

  const clearHelper = (): void => {
    const g = groupRef.current
    if (!g) return
    if (helperRef.current) {
      g.remove(helperRef.current)
      helperRef.current.geometry.dispose()
      helperRef.current = null
    }
  }

  useFrame(() => {
    const g = groupRef.current
    if (!g) return
    const { nodes } = useGraphStore.getState()
    const { currentTime } = usePlayheadStore.getState()
    const { generatedPoints } = useFormationStore.getState()

    const node = nodes.find((n) => n.id === nodeId)
    if (!node || node.type !== 'formation') { clearHelper(); return }
    const data = node.data as FormationNodeData
    const localTime = currentTime - data.startTime
    if (localTime < 0 || localTime > data.duration) { clearHelper(); return }
    const pts = data.formationId ? generatedPoints.get(data.formationId) : null
    if (!pts || pts.length === 0) { clearHelper(); return }

    const box = reuseBox.current
    box.makeEmpty()
    const t = data.transform
    for (const p of pts) {
      reusePoint.current.set(
        p.x * t.scale.x + t.position.x,
        p.y * t.scale.y + t.position.y,
        p.z * t.scale.z + t.position.z,
      )
      box.expandByPoint(reusePoint.current)
    }
    box.expandByScalar(0.4)

    if (!helperRef.current) {
      const helper = new THREE.Box3Helper(box, new THREE.Color(0xfacc15))
      helper.material = _hoverBBoxMaterial
      g.add(helper)
      helperRef.current = helper
    } else {
      helperRef.current.box.copy(box)
      helperRef.current.updateMatrixWorld(true)
    }
  })

  return <group ref={groupRef} />
}

function SelectionBoxInner({ nodeId }: { nodeId: string }) {
  const helperRef = useRef<THREE.Box3Helper | null>(null)
  const axesRef = useRef<THREE.AxesHelper | null>(null)
  // B-09: small crosshair at the bounding box's geometric center. Helps the
  // user see where the box's centroid is even when the formation isn't
  // symmetric around its own transform.position.
  const crosshairRef = useRef<THREE.LineSegments | null>(null)
  const groupRef = useRef<THREE.Group>(null)

  // Tear down both helpers if the formation is no longer eligible
  // (not selected, outside its time window, missing points).
  const clearHelpers = (): void => {
    const g = groupRef.current
    if (!g) return
    if (helperRef.current) {
      g.remove(helperRef.current)
      helperRef.current.geometry.dispose()
      helperRef.current = null
    }
    if (axesRef.current) {
      g.remove(axesRef.current)
      axesRef.current.geometry.dispose()
      axesRef.current = null
    }
    if (crosshairRef.current) {
      g.remove(crosshairRef.current)
      crosshairRef.current.geometry.dispose()
      ;(crosshairRef.current.material as THREE.Material).dispose()
      crosshairRef.current = null
    }
  }

  useFrame(() => {
    const g = groupRef.current
    if (!g) return
    const { nodes, flowDiagnostics } = useGraphStore.getState()
    const { currentTime } = usePlayheadStore.getState()
    const { generatedPoints } = useFormationStore.getState()

    const node = nodes.find((n) => n.id === nodeId)
    if (!node || node.type !== 'formation') { clearHelpers(); return }
    const data = node.data as FormationNodeData
    const localTime = currentTime - data.startTime
    if (localTime < 0 || localTime > data.duration) { clearHelpers(); return }
    const pts = data.formationId ? generatedPoints.get(data.formationId) : null
    if (!pts || pts.length === 0) { clearHelpers(); return }

    // B-09: error state — does the selected formation have any error-severity
    // diagnostics? Swap material on the helper accordingly.
    const hasError = flowDiagnostics.some((d) => d.severity === 'error' && d.nodeIds.includes(nodeId))

    const transform = data.transform
    const box = new THREE.Box3()
    for (const p of pts) {
      box.expandByPoint(new THREE.Vector3(
        p.x * transform.scale.x + transform.position.x,
        p.y * transform.scale.y + transform.position.y,
        p.z * transform.scale.z + transform.position.z,
      ))
    }
    box.expandByScalar(0.3)

    if (!helperRef.current) {
      const helper = new THREE.Box3Helper(box, new THREE.Color(hasError ? 0xf87171 : 0x22d3ee))
      helper.material = hasError ? _selectionBBoxErrorMaterial : _selectionBBoxMaterial
      g.add(helper)
      helperRef.current = helper
    } else {
      helperRef.current.box.copy(box)
      helperRef.current.material = hasError ? _selectionBBoxErrorMaterial : _selectionBBoxMaterial
      helperRef.current.updateMatrixWorld(true)
    }

    // B-09: local-axes RGB arrows at the formation's transform.position.
    // Three.js's built-in AxesHelper renders red/green/blue lines for +X / +Y / +Z.
    // The size is the longer of the bounding box's two horizontal extents so the
    // arrows match the swarm's footprint instead of being a fixed magnitude.
    const sizeVec = new THREE.Vector3()
    box.getSize(sizeVec)
    const axesSize = Math.max(2, Math.max(sizeVec.x, sizeVec.z) * 0.4)
    if (!axesRef.current) {
      const ax = new THREE.AxesHelper(axesSize)
      ;(ax.material as THREE.LineBasicMaterial).transparent = true
      ;(ax.material as THREE.LineBasicMaterial).opacity = 0.7
      g.add(ax)
      axesRef.current = ax
    } else {
      // Recompute geometry when size changes meaningfully.
      const ax = axesRef.current
      ax.scale.setScalar(axesSize / (ax.userData.baseSize as number ?? 1))
    }
    if (axesRef.current && !axesRef.current.userData.baseSize) {
      axesRef.current.userData.baseSize = axesSize
    }
    axesRef.current.position.set(transform.position.x, transform.position.y, transform.position.z)
    axesRef.current.updateMatrixWorld(true)

    // B-09: center crosshair at the box's geometric centroid (`box.getCenter`).
    // Three short line segments along X / Y / Z, length scaled to the box size.
    const center = new THREE.Vector3()
    box.getCenter(center)
    const crossSize = Math.max(0.5, Math.max(sizeVec.x, sizeVec.y, sizeVec.z) * 0.15)
    if (!crosshairRef.current) {
      const positions = new Float32Array([
        -crossSize, 0, 0, crossSize, 0, 0,
        0, -crossSize, 0, 0, crossSize, 0,
        0, 0, -crossSize, 0, 0, crossSize,
      ])
      const geo = new THREE.BufferGeometry()
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
      const mat = new THREE.LineBasicMaterial({ color: hasError ? 0xf87171 : 0x22d3ee, transparent: true, opacity: 0.85 })
      const seg = new THREE.LineSegments(geo, mat)
      g.add(seg)
      crosshairRef.current = seg
      crosshairRef.current.userData.baseSize = crossSize
    } else {
      const cur = (crosshairRef.current.userData.baseSize as number) ?? 1
      crosshairRef.current.scale.setScalar(crossSize / cur)
      ;(crosshairRef.current.material as THREE.LineBasicMaterial).color.setHex(hasError ? 0xf87171 : 0x22d3ee)
    }
    crosshairRef.current.position.set(center.x, center.y, center.z)
    crosshairRef.current.updateMatrixWorld(true)
  })

  return <group ref={groupRef} />
}

// O-06: combined bounding box across all selected formations active at the
// current playhead. Skips non-formation selections (idle/transition cards
// don't have a 3D footprint). Renders nothing if fewer than two formations
// are eligible — the single-formation case is handled by SelectionBoxInner.
function MultiSelectBoxInner({ nodeIds }: { nodeIds: string[] }) {
  const helperRef = useRef<THREE.Box3Helper | null>(null)
  const groupRef = useRef<THREE.Group>(null)
  const reuseBox = useRef(new THREE.Box3())
  const reusePoint = useRef(new THREE.Vector3())

  const clearHelper = (): void => {
    const g = groupRef.current
    if (!g) return
    if (helperRef.current) {
      g.remove(helperRef.current)
      helperRef.current.geometry.dispose()
      helperRef.current = null
    }
  }

  useFrame(() => {
    const g = groupRef.current
    if (!g) return
    const { nodes } = useGraphStore.getState()
    const { currentTime } = usePlayheadStore.getState()
    const { generatedPoints } = useFormationStore.getState()

    const combined = reuseBox.current
    combined.makeEmpty()
    let count = 0

    for (const nid of nodeIds) {
      const node = nodes.find((n) => n.id === nid)
      if (!node || node.type !== 'formation') continue
      const data = node.data as FormationNodeData
      const localTime = currentTime - data.startTime
      if (localTime < 0 || localTime > data.duration) continue
      const pts = data.formationId ? generatedPoints.get(data.formationId) : null
      if (!pts || pts.length === 0) continue
      const t = data.transform
      for (const p of pts) {
        reusePoint.current.set(
          p.x * t.scale.x + t.position.x,
          p.y * t.scale.y + t.position.y,
          p.z * t.scale.z + t.position.z,
        )
        combined.expandByPoint(reusePoint.current)
      }
      count++
    }

    if (count < 2) { clearHelper(); return }
    combined.expandByScalar(0.5)

    if (!helperRef.current) {
      const helper = new THREE.Box3Helper(combined, new THREE.Color(0xfbbf24))
      helper.material = _multiSelectBBoxMaterial
      g.add(helper)
      helperRef.current = helper
    } else {
      helperRef.current.box.copy(combined)
      helperRef.current.updateMatrixWorld(true)
    }
  })

  return <group ref={groupRef} />
}
