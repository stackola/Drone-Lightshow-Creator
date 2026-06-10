// ============================================================================
// Bundle 1: Audience Camera Controls
// ============================================================================
// Yaw/pitch via pointer drag in orbit mode; locked POV in first-person mode.
// Camera position derived each frame from store yaw/pitch/distance/target.
// ============================================================================

import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import { useViewStore } from '../../../stores/viewStore'
import { useAudienceEditStore } from '../../../stores/audienceEditStore'

export function AudienceCameraControls() {
  const { camera, gl } = useThree()
  const setYawPitch = useViewStore((s) => s.setAudienceYawPitch)

  const draggingRef = useRef(false)
  const lastXY = useRef<{ x: number; y: number } | null>(null)

  useEffect(() => {
    const el = gl.domElement
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return
      draggingRef.current = true
      lastXY.current = { x: e.clientX, y: e.clientY }
      ;(el as HTMLElement).setPointerCapture(e.pointerId)
    }
    const onMove = (e: PointerEvent) => {
      if (!draggingRef.current || !lastXY.current) return
      // Freeze the camera while a gizmo drag or placement is in flight, so
      // editing input doesn't fight the orbit (mirrors OrbitControls
      // enabled={!isDraggingGizmo} in the editor viewport).
      if (useViewStore.getState().isDraggingGizmo || useAudienceEditStore.getState().isPlacing) return
      const dx = e.clientX - lastXY.current.x
      const dy = e.clientY - lastXY.current.y
      lastXY.current = { x: e.clientX, y: e.clientY }
      const { yaw, pitch } = useViewStore.getState().audience
      setYawPitch(yaw - dx * 0.005, pitch - dy * 0.005)
    }
    const onUp = (e: PointerEvent) => {
      draggingRef.current = false
      lastXY.current = null
      try { (el as HTMLElement).releasePointerCapture(e.pointerId) } catch { /* noop */ }
    }
    el.addEventListener('pointerdown', onDown)
    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerup', onUp)
    el.addEventListener('pointerleave', onUp)
    return () => {
      el.removeEventListener('pointerdown', onDown)
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerup', onUp)
      el.removeEventListener('pointerleave', onUp)
    }
  }, [gl, setYawPitch])

  useFrame(() => {
    const a = useViewStore.getState().audience
    const cp = Math.cos(a.pitch)
    const dirX = Math.sin(a.yaw) * cp
    const dirY = Math.sin(a.pitch)
    const dirZ = Math.cos(a.yaw) * cp
    const tx = a.target[0], ty = a.target[1], tz = a.target[2]
    if (a.pov === 'first-person') {
      camera.position.set(tx, ty, tz)
      camera.lookAt(tx + dirX, ty + dirY, tz + dirZ)
    } else {
      camera.position.set(tx - dirX * a.distance, ty - dirY * a.distance, tz - dirZ * a.distance)
      camera.lookAt(tx, ty, tz)
    }
    camera.updateProjectionMatrix()
  })

  return null
}
