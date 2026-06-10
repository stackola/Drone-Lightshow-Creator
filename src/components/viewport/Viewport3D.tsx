// ============================================================================
// S6-01: 3D Viewport — React Three Fiber Scene
// ============================================================================

import { useRef, useMemo, useEffect, useCallback } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Grid } from '@react-three/drei'
import * as THREE from 'three'
import { useGraphStore } from '../../stores/graphStore'
import { usePlayheadStore } from '../../stores/playheadStore'
import { useProjectStore } from '../../stores/projectStore'
import { useSelectionStore } from '../../stores/selectionStore'
import { useViewStore } from '../../stores/viewStore'
import type { GizmoMode } from '../../stores/viewStore'
import { peekDroneStates } from '../../stores/evaluationStore'
import { EvaluatorTick } from './EvaluatorTick'
import { easeOutCubic } from './CameraRig'
import { ViewportAddNodeListener } from './ViewportContextMenu'
import { usePointEditorStore } from './PointEditor'
import { FormationGizmo, MultiSelectGizmo, resolveGizmoTarget } from './FormationGizmo'
import { PointEditorGizmo } from './PointEditorGizmo'
import { IdleRadiusHandle } from './handles/IdleRadiusHandle'
import { IdleCenterHandle } from './handles/IdleCenterHandle'
import { IdleDirectionHandle } from './handles/IdleDirectionHandle'
import { FormationCountHandle } from './handles/FormationCountHandle'
import { GeneratorRadiusHandle } from './handles/GeneratorRadiusHandle'
import { DroneHoverIndicator } from './DroneHoverIndicator'
import { Tooltip } from '../Tooltip'
import {
  Starfield,
  OrientationGizmo,
  FormationBoundingBoxes,
  SelectionBoundingBox,
  HoverBoundingBox,
  RenderFrameCounter,
} from './ViewportOverlays'
import type { FormationNodeData } from '../../graph/types'
import { Move3d, RotateCcw, Maximize2, ChevronLeft, ChevronRight, Plus, Diamond } from 'lucide-react'
import { BloomLayer } from './audience/BloomLayer'
import { SnapPlaneWidget } from './SnapPlaneWidget'
import { BuildPlaneWidget } from './BuildPlaneWidget'
import { PlaneDropController } from './PlaneDropController'
import { SceneSelectionController } from './SceneSelectionController'
import { DropGhost } from './DropGhost'
import { SmartGuides } from './SmartGuides'
import { SymmetryOverlay } from './SymmetryOverlay'
import { DroneTrails } from './DroneTrails'
import { TransitionMappingLines } from './TransitionMappingLines'
import { TransitionPills3D } from './TransitionPills3D'

// --- Drone Point Cloud ---

// S1 (2026-05-22) — the live-preview eval is now a Zustand-derived signal.
// A single `<EvaluatorTick />` mounted inside the Canvas refreshes
// `evaluationStore` once per frame at priority -1; DroneCloud + every other
// live consumer reads via `peekDroneStates()` during its own default-priority
// useFrame. The module-level `_evalCache` is gone — the store owns that
// state now, and non-3D subscribers can observe it via Zustand without
// having to mount their own useFrame.

export function DroneCloud({ emissiveIntensity = 0 }: { emissiveIntensity?: number }) {
  const meshRef = useRef<THREE.InstancedMesh>(null)
  const dummy = useMemo(() => new THREE.Object3D(), [])
  const colorObj = useMemo(() => new THREE.Color(), [])
  // Patch material shader once so per-instance color drives emissive radiance.
  const onBeforeCompile = useCallback((shader: THREE.WebGLProgramParametersWithUniforms) => {
    shader.uniforms.uEmissiveIntensity = { value: emissiveIntensity }
    ;(shader as unknown as { _emissiveIntensityRef: { value: number } })._emissiveIntensityRef = shader.uniforms.uEmissiveIntensity
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform float uEmissiveIntensity;',
      )
      .replace(
        '#include <emissivemap_fragment>',
        '#include <emissivemap_fragment>\n#ifdef USE_INSTANCING_COLOR\n  totalEmissiveRadiance += vColor * uEmissiveIntensity;\n#endif',
      )
  }, [emissiveIntensity])

  // Subscribe to rarely-changing values that affect mesh setup
  const homePositions = useProjectStore((s) => s.dronePool.homePositions)
  const droneCount = useProjectStore((s) => s.dronePool.droneCount)

  // B-01 — track the hovered drone via the same window-event channel
  // `DroneHoverIndicator` listens on. Stored in a ref so the per-frame
  // colour loop can dim non-hovered instances without re-rendering React.
  const hoveredIdxRef = useRef<number>(-1)
  useEffect(() => {
    const onHover = (e: Event): void => {
      const detail = (e as CustomEvent).detail as { droneIndex?: number } | undefined
      hoveredIdxRef.current = detail?.droneIndex ?? -1
    }
    window.addEventListener('drone-hover', onHover)
    return () => window.removeEventListener('drone-hover', onHover)
  }, [])

  // Read drone states from the shared evaluationStore. <EvaluatorTick /> has
  // already refreshed the store at priority -1 by the time this default-priority
  // useFrame runs, so `peekDroneStates()` returns this frame's data.
  useFrame(() => {
    if (!meshRef.current) return
    const states = peekDroneStates()
    if (!states) return
    // Item 5: read the point-editor selection straight from the store (no
    // React subscription overhead — we're already inside useFrame). Selected
    // drones render slightly bigger + tinted cyan so the user can see what
    // the gizmo will move.
    const pe = usePointEditorStore.getState()
    const peActive = pe.isActive
    const peSel = pe.selectedIndices
    for (let i = 0; i < droneCount; i++) {
      const state = states[i]
      const peSelected = peActive && peSel.has(i)
      if (state) {
        dummy.position.set(state.position.x, state.position.y, state.position.z)
        dummy.scale.setScalar(peSelected ? 0.45 : 0.3)
      } else {
        dummy.position.set(0, -100, 0) // Off-screen
        dummy.scale.setScalar(0)
      }
      dummy.updateMatrix()
      meshRef.current.setMatrixAt(i, dummy.matrix)

      // Set color per instance. B-01: when a drone is hovered, dim every
      // *other* instance to 35% so the focus pops without losing context.
      // Item 5: when point-edit is active, tint selected drones cyan-ish
      // and dim unselected ones to 60% so the selection reads at a glance.
      if (state) {
        let dim = hoveredIdxRef.current !== -1 && hoveredIdxRef.current !== i ? 0.35 : 1
        if (peActive && !peSelected) dim = Math.min(dim, 0.6)
        if (peSelected) {
          // Blend toward cyan (0.13, 0.83, 0.93) so the selection pops even
          // on similar-coloured drones.
          meshRef.current.setColorAt(
            i,
            colorObj.setRGB(state.color.r * 0.4 + 0.4, state.color.g * 0.4 + 0.55, state.color.b * 0.4 + 0.6),
          )
        } else {
          meshRef.current.setColorAt(
            i,
            colorObj.setRGB(state.color.r * dim, state.color.g * dim, state.color.b * dim),
          )
        }
      }
    }

    meshRef.current.instanceMatrix.needsUpdate = true
    if (meshRef.current.instanceColor) {
      meshRef.current.instanceColor.needsUpdate = true
    }
  })

  // S20-01: Point selection via click on instanced mesh
  const handleClick = useCallback((e: THREE.Event & { instanceId?: number }) => {
    if (e.instanceId !== undefined) {
      // Dispatch custom event for PointEditor integration
      window.dispatchEvent(new CustomEvent('drone-click', {
        detail: { droneIndex: e.instanceId, shiftKey: (e as unknown as { nativeEvent?: { shiftKey: boolean } }).nativeEvent?.shiftKey ?? false },
      }))
    }
  }, [])

  // B-01 — hover events. We only emit on enter/leave (not move) to keep the
  // DOM cursor-changes cheap. Downstream listeners can render an overlay or
  // adjust styling using the dispatched droneIndex.
  const handleHover = useCallback((e: THREE.Event & { instanceId?: number }) => {
    if (e.instanceId !== undefined) {
      window.dispatchEvent(new CustomEvent('drone-hover', { detail: { droneIndex: e.instanceId } }))
    }
  }, [])
  const handleHoverOut = useCallback(() => {
    window.dispatchEvent(new CustomEvent('drone-hover', { detail: { droneIndex: -1 } }))
  }, [])

  return (
    <instancedMesh
      ref={meshRef}
      args={[undefined, undefined, droneCount]}
      onClick={handleClick as unknown as (e: THREE.Event) => void}
      onPointerOver={handleHover as unknown as (e: THREE.Event) => void}
      onPointerOut={handleHoverOut}
    >
      <sphereGeometry args={[1, 8, 8]} />
      <meshStandardMaterial
        toneMapped={false}
        onBeforeCompile={onBeforeCompile}
        key={`drone-mat-${emissiveIntensity > 0 ? 'glow' : 'flat'}`}
      />
    </instancedMesh>
  )
}

// --- S15-10: Geofence Visualization ---

export function GeofenceVisualization() {
  const geofenceRadius = useProjectStore((s) => s.constraints.geofenceRadius)
  const altMax = useProjectStore((s) => s.constraints.altitudeMax)
  const altMin = useProjectStore((s) => s.constraints.altitudeMin)

  // Render a translucent cylinder representing the geofence radius
  const height = altMax - altMin
  const yCenter = (altMax + altMin) / 2

  return (
    <group>
      {/* Geofence cylinder (translucent walls) */}
      <mesh position={[0, yCenter, 0]} rotation={[0, 0, 0]}>
        <cylinderGeometry args={[geofenceRadius, geofenceRadius, height, 32, 1, true]} />
        <meshBasicMaterial color="#ef4444" transparent opacity={0.04} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      {/* Altitude ceiling */}
      <mesh position={[0, altMax, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[geofenceRadius, 32]} />
        <meshBasicMaterial color="#ef4444" transparent opacity={0.03} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      {/* Altitude floor (if > 0) */}
      {altMin > 0 && (
        <mesh position={[0, altMin, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <circleGeometry args={[geofenceRadius, 32]} />
          <meshBasicMaterial color="#ef4444" transparent opacity={0.03} side={THREE.DoubleSide} depthWrite={false} />
        </mesh>
      )}
    </group>
  )
}

// --- Ground + Home Position Markers ---

function HomeMarkers() {
  const homePositions = useProjectStore((s) => s.dronePool.homePositions)

  const positions = useMemo(() => {
    const count = homePositions?.length ?? 0
    const arr = new Float32Array(count * 3)
    for (let i = 0; i < count; i++) {
      const p = homePositions[i]!
      arr[i * 3] = p.x
      arr[i * 3 + 1] = 0.01
      arr[i * 3 + 2] = p.z
    }
    return arr
  }, [homePositions])

  return (
    <points>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          args={[positions, 3]}
        />
      </bufferGeometry>
      <pointsMaterial
        size={0.3}
        color="#475569"
        transparent
        opacity={0.5}
        sizeAttenuation
      />
    </points>
  )
}

// --- Playback Tick ---

function PlaybackTick() {
  const tick = usePlayheadStore((s) => s.tick)
  const isPlaying = usePlayheadStore((s) => s.isPlaying)

  useFrame((_, delta) => {
    if (isPlaying) {
      tick(delta * 1000)
    }
  })

  return null
}

// --- Gizmo Mode Toolbar ---

const GIZMO_MODES: { mode: GizmoMode; icon: typeof Move3d; label: string; shortcut: string }[] = [
  { mode: 'translate', icon: Move3d, label: 'Translate', shortcut: 'W' },
  { mode: 'rotate', icon: RotateCcw, label: 'Rotate', shortcut: 'E' },
  { mode: 'scale', icon: Maximize2, label: 'Scale', shortcut: 'R' },
]

export function GizmoToolbar() {
  const gizmoMode = useViewStore((s) => s.gizmoMode)
  const setGizmoMode = useViewStore((s) => s.setGizmoMode)
  const currentTime = usePlayheadStore((s) => s.currentTime)
  const setCurrentTime = usePlayheadStore((s) => s.setCurrentTime)
  const addKeyframe = useGraphStore((s) => s.addKeyframe)

  const selectedNodeIds = useSelectionStore((s) => s.selectedNodeIds)
  const nodes = useGraphStore((s) => s.nodes)

  // Get selected formation data
  const nodeId = selectedNodeIds.length === 1 ? selectedNodeIds[0]! : null
  const node = nodeId ? nodes.find((n) => n.id === nodeId) : undefined
  const isFormation = node?.type === 'formation'
  const data = isFormation ? (node!.data as FormationNodeData) : null
  const keyframes = data?.keyframes ?? []

  // Resolve current gizmo edit target
  const resolved = data ? resolveGizmoTarget(data, currentTime) : null
  const editTarget = resolved?.editTarget ?? null
  const localTime = data ? currentTime - data.startTime : 0

  // Find prev/next keyframe relative to current local time
  const prevKfTime = (() => {
    // Include base (localTime=0) as a jump target
    const times = [0, ...keyframes.map((kf) => kf.time)]
    let best: number | null = null
    for (const t of times) {
      if (t < localTime - 0.05) {
        if (best === null || t > best) best = t
      }
    }
    return best
  })()

  const nextKfTime = (() => {
    const times = [0, ...keyframes.map((kf) => kf.time)]
    let best: number | null = null
    for (const t of times) {
      if (t > localTime + 0.05) {
        if (best === null || t < best) best = t
      }
    }
    return best
  })()

  const jumpToLocal = (lt: number) => {
    if (!data) return
    setCurrentTime(data.startTime + lt)
  }

  const handleInsertKeyframe = () => {
    if (!nodeId || !data || localTime <= 0) return
    const displayTransform = resolved?.displayTransform
    if (!displayTransform) return
    addKeyframe(nodeId, localTime, displayTransform, 'linear')
  }

  // Status label
  let statusLabel = ''
  let statusColor = 'text-white/30'
  if (data && keyframes.length > 0) {
    if (editTarget === 'base') {
      statusLabel = 'Base Transform'
      statusColor = 'text-cyan-400'
    } else if (editTarget === 'disabled') {
      statusLabel = 'Between keyframes (read-only)'
      statusColor = 'text-amber-400/60'
    } else if (typeof editTarget === 'number') {
      statusLabel = `Keyframe ${editTarget + 1}`
      statusColor = 'text-green-400'
    }
  }

  return (
    <div className="absolute top-2 left-2 z-10 flex flex-col gap-1">
      {/* Mode buttons */}
      <div className="flex gap-0.5 bg-surface-raised/90 backdrop-blur-sm rounded-lg p-0.5 border border-white/10">
        {GIZMO_MODES.map(({ mode, icon: Icon, label, shortcut }) => (
          <button
            key={mode}
            className={`p-1.5 rounded-md transition-colors ${
              gizmoMode === mode
                ? 'bg-cyan-600 text-white'
                : 'text-white/50 hover:text-white/80 hover:bg-white/10'
            }`}
            onClick={() => setGizmoMode(mode)}
            title={`${label} (${shortcut})`}
          >
            <Icon size={14} />
          </button>
        ))}
      </div>

      {/* Keyframe navigation — only if a formation with keyframes is selected */}
      {isFormation && keyframes.length > 0 && (
        <div className="bg-surface-raised/90 backdrop-blur-sm rounded-lg p-1 border border-white/10 space-y-1">
          {/* Status indicator */}
          <div className="flex items-center gap-1 px-0.5">
            <Diamond size={8} className={statusColor} />
            <span className={`text-[9px] ${statusColor}`}>{statusLabel}</span>
          </div>

          {/* Keyframe jump buttons */}
          <div className="flex items-center gap-0.5">
            <Tooltip label="Previous keyframe" side="top">
              <button
                className="p-1 rounded text-white/40 hover:text-white/80 hover:bg-white/10 disabled:opacity-20 disabled:cursor-default"
                disabled={prevKfTime === null}
                onClick={() => prevKfTime !== null && jumpToLocal(prevKfTime)}
                aria-label="Previous keyframe"
              >
                <ChevronLeft size={12} />
              </button>
            </Tooltip>

            <div className="flex-1 text-center text-[9px] text-white/40 tabular-nums">
              t={localTime.toFixed(2)}s
            </div>

            <Tooltip label="Next keyframe" side="top">
              <button
                className="p-1 rounded text-white/40 hover:text-white/80 hover:bg-white/10 disabled:opacity-20 disabled:cursor-default"
                disabled={nextKfTime === null}
                onClick={() => nextKfTime !== null && jumpToLocal(nextKfTime)}
                aria-label="Next keyframe"
              >
                <ChevronRight size={12} />
              </button>
            </Tooltip>
          </div>

          {/* Insert keyframe at current time (only between keyframes) */}
          {editTarget === 'disabled' && localTime > 0 && (
            <Tooltip label="Insert keyframe at current time" side="top">
              <button
                className="w-full flex items-center justify-center gap-1 px-1.5 py-0.5 rounded text-[9px] text-amber-300 bg-amber-500/10 hover:bg-amber-500/20 transition-colors"
                onClick={handleInsertKeyframe}
                aria-label="Insert keyframe"
              >
                <Plus size={10} />
                Insert KF at t={localTime.toFixed(2)}s
              </button>
            </Tooltip>
          )}
        </div>
      )}
    </div>
  )
}

// --- Keyboard Shortcuts for Gizmo Mode ---

/**
 * Frame-selection shortcut. Press `F` to focus the camera on the currently
 * selected formation node: target the controls at the formation's world
 * position; nudge the camera back along its current direction so the
 * formation fills the view. Works only when exactly one formation is
 * selected. Lives inside the Canvas so we can read `useThree().controls`.
 */
function FrameSelectionShortcut() {
  const { camera, controls } = useThree() as unknown as { camera: THREE.PerspectiveCamera; controls: { target: THREE.Vector3; enabled: boolean; update?: () => void } | null }
  const tweenRef = useRef<{ startPos: THREE.Vector3; endPos: THREE.Vector3; startTarget: THREE.Vector3; endTarget: THREE.Vector3; t: number } | null>(null)

  useEffect(() => {
    // Triggered by the F binding in the shortcut registry (editorBindings) —
    // the camera/controls live here inside the Canvas, so the registry
    // dispatches an event rather than touching three.js directly.
    const onFrame = (): void => {
      const sel = useSelectionStore.getState().selectedNodeIds
      if (sel.length !== 1) return
      const node = useGraphStore.getState().getNode(sel[0]!)
      if (!node || node.type !== 'formation') return
      const data = node.data as { transform: { position: { x: number; y: number; z: number } } }
      const target = new THREE.Vector3(data.transform.position.x, data.transform.position.y, data.transform.position.z)

      if (controls) {
        // Preserve the user's existing view direction; glide instead of snapping.
        const dir = new THREE.Vector3().subVectors(camera.position, controls.target).normalize()
        const distance = 25
        tweenRef.current = {
          startPos: camera.position.clone(),
          endPos: target.clone().addScaledVector(dir, distance),
          startTarget: controls.target.clone(),
          endTarget: target.clone(),
          t: 0,
        }
      } else {
        camera.position.set(target.x, target.y + 20, target.z + 25)
        camera.lookAt(target)
      }
    }
    window.addEventListener('frame-selection', onFrame)
    return () => window.removeEventListener('frame-selection', onFrame)
  }, [camera, controls])

  useFrame((_, dt) => {
    const tw = tweenRef.current
    if (!tw || !controls) return
    // Freeze orbit input while the glide runs (same pattern as CameraRig).
    controls.enabled = false
    tw.t = Math.min(1, tw.t + dt / 0.35)
    const e = easeOutCubic(tw.t)
    camera.position.lerpVectors(tw.startPos, tw.endPos, e)
    controls.target.lerpVectors(tw.startTarget, tw.endTarget, e)
    controls.update?.()
    if (tw.t >= 1) {
      tweenRef.current = null
      controls.enabled = !useViewStore.getState().isDraggingGizmo
    }
  })

  return null
}

// Gizmo / camera / ground keyboard shortcuts moved to the central registry
// (src/input/editorBindings.ts, 'Gizmo & Camera' category).

// --- Shared scene contents ---
// Everything inside the <Canvas> that is camera-agnostic and identical between
// the editor (perspective) viewport and the build (iso/ortho) viewport. Each
// host supplies its own camera + controls and (for the editor) the legacy
// CameraPresetListener. Reads its few inputs straight from viewStore so it
// needs no props.
export function SceneContents() {
  const emissiveIntensity = useViewStore((s) => s.audience.emissiveIntensity)
  const bloomEditor = useViewStore((s) => s.audience.bloomEditor)
  const showGround = useViewStore((s) => s.showGround)
  return (
    <>
      <FrameSelectionShortcut />
      {/* Click/hover a drone in 3D → select/hover its owning formation. */}
      <SceneSelectionController />
      {/* S1 — single useFrame writer for the eval store (renderPriority -1). */}
      <EvaluatorTick />

      {/* Lighting */}
      <ambientLight intensity={0.4} />
      <directionalLight position={[20, 30, 10]} intensity={0.8} castShadow />
      <hemisphereLight args={['#b1e1ff', '#b97a20', 0.3]} />

      {/* Ground — togglable via GG (B-04). */}
      {showGround && (
        <Grid
          args={[200, 200]}
          cellSize={2}
          cellThickness={0.5}
          cellColor="#1e293b"
          sectionSize={10}
          sectionThickness={1}
          sectionColor="#334155"
          fadeDistance={100}
          infiniteGrid
        />
      )}

      {/* Gizmos + handles */}
      <FormationGizmo />
      <MultiSelectGizmo />
      <PointEditorGizmo />
      <IdleRadiusHandle />
      <IdleCenterHandle />
      <IdleDirectionHandle />
      <FormationCountHandle />
      <GeneratorRadiusHandle />
      <DroneHoverIndicator />

      {/* Planes + overlays */}
      <SnapPlaneWidget />
      <BuildPlaneWidget />
      <PlaneDropController />
      <ViewportAddNodeListener />
      <DropGhost />
      <SmartGuides />
      <SymmetryOverlay />
      <DroneTrails />
      <TransitionMappingLines />
      <TransitionPills3D />

      <RenderFrameCounter />
      <Starfield />
      <OrientationGizmo />
      <FormationBoundingBoxes />
      <SelectionBoundingBox />
      <HoverBoundingBox />
      <GeofenceVisualization />

      {/* Drones */}
      <DroneCloud emissiveIntensity={bloomEditor ? Math.max(1, emissiveIntensity) : 0} />
      <HomeMarkers />
      <PlaybackTick />
      <BloomLayer kind="editor" />
    </>
  )
}

// --- Main Viewport ---

// The legacy `Viewport3D` shell component was deleted at cutover — the new
// shell composes the stage itself (src/shell/stage/Stage.tsx) from the
// exports above (SceneContents, GizmoToolbar, …).
