// Direct manipulation of the selected formation in the 3D view: a move /
// rotate / scale gizmo with snapping (Alt for free), a ghost of the formation
// that follows the gizmo instantly, and floor, ceiling and fence guides that
// light up while dragging. The edit is committed once, on release, as one
// undo step — the flight planner then re-plans the show.

import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import { Html, TransformControls } from '@react-three/drei'
import * as THREE from 'three'
import { getState, useStore } from '@/state/store'
import { findCompiledScene, findSceneTime, sceneGeometry } from '@/core/compile'
import { findScene, sceneDroneCount } from '@/core/groups'
import { comfortableSpacing } from '@/core/validate'
import { transformScene } from '@/state/actions'
import { DEG } from '@/core/math'

let dotTexture: THREE.Texture | null = null
function dot(): THREE.Texture {
  if (dotTexture) return dotTexture
  const c = document.createElement('canvas')
  c.width = c.height = 32
  const g = c.getContext('2d')!
  const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16)
  grad.addColorStop(0, 'rgba(255,255,255,1)')
  grad.addColorStop(0.45, 'rgba(255,255,255,0.9)')
  grad.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = grad
  g.fillRect(0, 0, 32, 32)
  dotTexture = new THREE.CanvasTexture(c)
  return dotTexture
}

/**
 * Gizmo state shared with the camera and picking: when it was last grabbed
 * (clicks right after are not selection clicks), and the live controls, whose
 * `axis` is set while the pointer is over a handle.
 */
export const gizmo: { lastUsed: number; ctl: { axis: string | null } | null } = { lastUsed: 0, ctl: null }
export const gizmoJustUsed = () => performance.now() - gizmo.lastUsed < 350
/** The pointer is on a gizmo handle (a press there is a gizmo drag, not an orbit). */
export const gizmoHovered = () => !!gizmo.ctl?.axis

const GHOST = new THREE.Color('#f5b544')
const BAD = new THREE.Color('#ff5d5d')

interface DragInfo {
  text: string
  bad: string | null
}

export function Manipulator() {
  const sel = useStore((s) => s.selection)
  const tool = useStore((s) => s.tool)
  const id = sel.kind === 'scene' || sel.kind === 'flight' ? sel.id : null
  const scene = useStore((s) => (id ? findScene(s.doc, id)?.scene : undefined))
  const n = useStore((s) => (id ? sceneDroneCount(s.doc, id) : s.doc.droneCount))
  const limits = useStore((s) => s.doc.limits)
  const spacing = useStore((s) => (id && s.compiled ? findCompiledScene(s.compiled, id)?.spacing : undefined))
  const group = useRef<THREE.Group>(null)
  const ghost = useRef<THREE.Points>(null)
  const [dragging, setDragging] = useState(false)
  const [info, setInfo] = useState<DragInfo | null>(null)
  const [alt, setAlt] = useState(false)
  const start = useRef<{ pos: THREE.Vector3; rot: THREE.Euler } | null>(null)

  // Formation in its own frame (centre at the origin, unrotated): the group supplies the transform.
  const layersKey = scene ? JSON.stringify(scene.layers) : ''
  const local = useMemo(() => {
    if (!scene) return null
    return sceneGeometry({ ...scene, position: [0, 0, 0], rotation: [0, 0, 0] }, n).points
  }, [layersKey, n]) // eslint-disable-line react-hooks/exhaustive-deps
  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry()
    if (local) g.setAttribute('position', new THREE.BufferAttribute(local, 3))
    return g
  }, [local])
  const material = useMemo(() => new THREE.PointsMaterial({ size: 1.6, map: dot(), color: GHOST, transparent: true, opacity: 0.5, depthWrite: false, sizeAttenuation: true, alphaTest: 0.01 }), [])

  // Keep the gizmo on the scene's transform while not dragging.
  useEffect(() => {
    const g = group.current
    if (!g || !scene || dragging) return
    g.position.set(...scene.position)
    g.rotation.order = 'ZYX'
    g.rotation.set(scene.rotation[0] * DEG, scene.rotation[1] * DEG, scene.rotation[2] * DEG)
    g.scale.setScalar(1)
  }, [scene, dragging])

  // Alt toggles snapping off while held.
  useEffect(() => {
    const on = (e: KeyboardEvent) => setAlt(e.altKey)
    window.addEventListener('keydown', on)
    window.addEventListener('keyup', on)
    return () => { window.removeEventListener('keydown', on); window.removeEventListener('keyup', on) }
  }, [])

  // The ghost shows while dragging, or when the formation isn't on screen at the playhead.
  useFrame(() => {
    const p = ghost.current
    if (!p || !id) return
    const s = getState()
    const t = s.compiled ? findSceneTime(s.compiled, id) : undefined
    const onShow = !!t && s.time >= t.holdStart && s.time <= t.holdEnd
    p.visible = dragging || !onShow
    material.opacity = dragging ? 0.75 : 0.32
  })

  if (!scene || !local) return null
  const minScale = spacing && spacing > 0 ? Math.min(1, comfortableSpacing(limits.minSpacing) / spacing) : 0.2

  /** Check the dragged formation against the airspace and describe the change. */
  const inspect = () => {
    const g = group.current
    const st = start.current
    if (!g || !st) return
    if (tool === 'scale') {
      // Uniform scale: follow whichever axis moved most, never below the safe spacing.
      const s = g.scale
      const k = [s.x, s.y, s.z].reduce((a, b) => (Math.abs(b - 1) > Math.abs(a - 1) ? b : a), 1)
      g.scale.setScalar(Math.max(minScale, k))
    }
    g.updateMatrixWorld()
    const m = g.matrixWorld
    const v = new THREE.Vector3()
    let lo = Infinity, hi = -Infinity, far = 0
    for (let i = 0; i < local.length; i += 3) {
      v.set(local[i]!, local[i + 1]!, local[i + 2]!).applyMatrix4(m)
      lo = Math.min(lo, v.y); hi = Math.max(hi, v.y); far = Math.max(far, Math.hypot(v.x, v.z))
    }
    const bad = lo < limits.minAltitude ? `Below the ${limits.minAltitude} m floor` : hi > limits.maxAltitude ? `Above the ${limits.maxAltitude} m ceiling` : far > limits.maxRadius ? `Outside the ${limits.maxRadius} m flight area` : null
    material.color.copy(bad ? BAD : GHOST)
    let text = ''
    if (tool === 'move') text = `x ${g.position.x.toFixed(1)} · alt ${g.position.y.toFixed(1)} · z ${g.position.z.toFixed(1)} m`
    else if (tool === 'rotate') {
      const e = new THREE.Euler().setFromQuaternion(g.quaternion, 'ZYX')
      text = `tilt ${(e.x / DEG).toFixed(0)}° · turn ${(e.y / DEG).toFixed(0)}° · roll ${(e.z / DEG).toFixed(0)}°`
    } else if (tool === 'scale') {
      const k = g.scale.x
      text = `×${k.toFixed(2)}${spacing ? ` · drones ${(spacing * k).toFixed(1)} m apart` : ''}${k <= minScale + 1e-6 && minScale < 1 ? ' (smallest safe size)' : ''}`
    }
    setInfo({ text, bad })
  }

  const commit = () => {
    const g = group.current
    if (!g || !id) return
    const e = new THREE.Euler().setFromQuaternion(g.quaternion, 'ZYX')
    if (tool === 'move') transformScene(id, { position: [g.position.x, g.position.y, g.position.z] }, 'Move scene')
    else if (tool === 'rotate') transformScene(id, { rotation: [e.x / DEG, e.y / DEG, e.z / DEG] }, 'Rotate scene')
    else if (tool === 'scale') transformScene(id, { scale: g.scale.x }, 'Resize scene')
  }

  return (
    <>
      <group ref={group}>
        <points ref={ghost} geometry={geometry} material={material} frustumCulled={false} renderOrder={5} />
        {dragging && info && (
          <Html center position={[0, 0, 0]} zIndexRange={[20, 10]} style={{ pointerEvents: 'none' }}>
            <div className={`gizmo-label${info.bad ? ' bad' : ''}`}>{info.text}{info.bad && <div>{info.bad}</div>}</div>
          </Html>
        )}
      </group>
      {tool !== 'select' && (
        <TransformControls
          ref={(c) => { gizmo.ctl = c as unknown as { axis: string | null } | null }}
          object={group as React.MutableRefObject<THREE.Object3D>}
          mode={tool === 'move' ? 'translate' : tool === 'rotate' ? 'rotate' : 'scale'}
          space={tool === 'rotate' ? 'local' : 'world'}
          translationSnap={alt ? null : 1}
          rotationSnap={alt ? null : 5 * DEG}
          scaleSnap={alt ? null : 0.05}
          showX={tool !== 'scale'}
          showY={tool !== 'scale'}
          showZ={tool !== 'scale'}
          size={0.9}
          onMouseDown={() => {
            gizmo.lastUsed = performance.now()
            const g = group.current
            if (!g) return
            start.current = { pos: g.position.clone(), rot: g.rotation.clone() }
            setDragging(true)
            inspect()
          }}
          onObjectChange={() => { if (start.current) inspect() }}
          onMouseUp={() => {
            gizmo.lastUsed = performance.now()
            commit()
            start.current = null
            setDragging(false)
            setInfo(null)
            material.color.copy(GHOST)
          }}
        />
      )}
      {dragging && <AirspaceGuides />}
    </>
  )
}

/** Translucent floor and ceiling discs and the fence wall, shown while dragging. */
function AirspaceGuides() {
  const L = useStore((s) => s.doc.limits)
  const h = L.maxAltitude - L.minAltitude
  return (
    <group>
      <mesh position={[0, L.minAltitude, 0]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={-1}>
        <circleGeometry args={[L.maxRadius, 96]} />
        <meshBasicMaterial color="#3b82f6" transparent opacity={0.07} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      <mesh position={[0, L.maxAltitude, 0]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={-1}>
        <circleGeometry args={[L.maxRadius, 96]} />
        <meshBasicMaterial color="#f43f5e" transparent opacity={0.06} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      <mesh position={[0, L.minAltitude + h / 2, 0]} renderOrder={-1}>
        <cylinderGeometry args={[L.maxRadius, L.maxRadius, h, 96, 1, true]} />
        <meshBasicMaterial color="#f43f5e" transparent opacity={0.035} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
    </group>
  )
}
