// ============================================================================
// Camera Rig — build-mode camera. Renders a true OrthographicCamera for iso /
// top / front / side views, or a PerspectiveCamera for the free view, with
// constrained OrbitControls (cursor-anchored zoom; rotation locked for the
// fixed ortho angles so the iso look stays "sacred").
//
// View changes within the same projection (iso↔top↔front↔side, all ortho)
// GLIDE: position/target/zoom are tweened over ~350ms ease-out instead of
// teleporting. Crossing projection types (iso↔perspective) remounts the camera
// and snaps — projection morphing isn't meaningful to animate.
// ============================================================================

import { useLayoutEffect, useRef } from 'react'
import { OrbitControls, OrthographicCamera, PerspectiveCamera } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useViewStore } from '../../stores/viewStore'
import { useUiModeStore, VIEW_DEFS, type ViewId, type ViewDef } from '../../stores/uiModeStore'

const TWEEN_SECONDS = 0.35

/** Minimal shape we touch on the OrbitControls instance (avoids a three-stdlib type import). */
interface OrbitLike {
  target: THREE.Vector3
  enabled: boolean
  update: () => void
}

/** Camera position = target + direction(yaw, pitch) * distance. */
function cameraPosition(view: ViewDef): THREE.Vector3 {
  const elev = -view.pitch // pitch<0 looks down ⇒ camera sits above
  const cosE = Math.cos(elev)
  return new THREE.Vector3(
    view.target[0] + cosE * Math.sin(view.yaw) * view.distance,
    view.target[1] + Math.sin(elev) * view.distance,
    view.target[2] + cosE * Math.cos(view.yaw) * view.distance,
  )
}

/** Ortho zoom so the default scene footprint fits comfortably. */
function orthoZoom(view: ViewDef): number {
  return 900 / view.distance
}

export function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3)
}

interface Tween {
  startPos: THREE.Vector3
  endPos: THREE.Vector3
  startTarget: THREE.Vector3
  endTarget: THREE.Vector3
  startZoom: number
  endZoom: number
  ortho: boolean
  t: number
}

export function CameraRig() {
  const viewId = useUiModeStore((s) => s.viewId)
  const setTweening = useUiModeStore((s) => s.setTweening)
  const isDraggingGizmo = useViewStore((s) => s.isDraggingGizmo)
  const view = VIEW_DEFS[viewId]
  const isOrtho = view.cameraKind === 'orthographic'

  const orthoRef = useRef<THREE.OrthographicCamera>(null)
  const perspRef = useRef<THREE.PerspectiveCamera>(null)
  const controlsRef = useRef<OrbitLike | null>(null)
  const tween = useRef<Tween | null>(null)
  const prevView = useRef<ViewId | null>(null)

  // On viewId change: snap on first mount / cross-projection, else start a tween.
  useLayoutEffect(() => {
    const cam = isOrtho ? orthoRef.current : perspRef.current
    const controls = controlsRef.current
    if (!cam || !controls) return
    const endPos = cameraPosition(view)
    const endTarget = new THREE.Vector3(...view.target)
    const endZoom = orthoZoom(view)
    const prev = prevView.current
    const sameKind = prev != null && VIEW_DEFS[prev].cameraKind === view.cameraKind

    if (!sameKind) {
      cam.position.copy(endPos)
      controls.target.copy(endTarget)
      if (isOrtho) {
        cam.zoom = endZoom
        cam.updateProjectionMatrix()
      }
      controls.update()
      tween.current = null
    } else {
      tween.current = {
        startPos: cam.position.clone(),
        endPos,
        startTarget: controls.target.clone(),
        endTarget,
        startZoom: cam.zoom,
        endZoom,
        ortho: isOrtho,
        t: 0,
      }
      setTweening(true)
    }
    prevView.current = viewId
  }, [viewId])

  useFrame((_, dt) => {
    const tw = tween.current
    const controls = controlsRef.current
    const cam = tw?.ortho ? orthoRef.current : perspRef.current
    // Freeze orbit input while a programmatic tween is running.
    if (controls) controls.enabled = !isDraggingGizmo && tw == null
    if (!tw || !cam || !controls) return
    tw.t = Math.min(1, tw.t + dt / TWEEN_SECONDS)
    const e = easeOutCubic(tw.t)
    cam.position.lerpVectors(tw.startPos, tw.endPos, e)
    controls.target.lerpVectors(tw.startTarget, tw.endTarget, e)
    if (tw.ortho) {
      const oc = cam as THREE.OrthographicCamera
      oc.zoom = tw.startZoom + (tw.endZoom - tw.startZoom) * e
      oc.updateProjectionMatrix()
    }
    controls.update()
    if (tw.t >= 1) {
      tween.current = null
      setTweening(false)
    }
  })

  return (
    <group key={view.cameraKind}>
      {isOrtho ? (
        <OrthographicCamera ref={orthoRef} makeDefault near={-1000} far={2000} />
      ) : (
        <PerspectiveCamera ref={perspRef} makeDefault fov={50} near={0.1} far={4000} />
      )}
      <OrbitControls
        ref={controlsRef as never}
        makeDefault
        target={view.target}
        enableRotate={!isOrtho}
        enablePan
        screenSpacePanning={isOrtho}
        maxPolarAngle={isOrtho ? undefined : Math.PI * 0.495}
        zoomToCursor
        enableDamping
        dampingFactor={0.12}
        enabled={!isDraggingGizmo}
      />
    </group>
  )
}
