// ============================================================================
// Drop Ghost — live preview of where a dragged formation will land. While a
// formation is dragged over the stage, raycasts the active build plane each
// frame at the cursor, snaps to the plane grid, and renders the formation's
// footprint as translucent points + a target ring. Kills the old "blind drop".
//
// Reads cursor + plane imperatively in useFrame (no per-move React renders),
// mirroring DroneCloud. Mounts only while a drag is in flight.
// ============================================================================

import { useMemo, useRef } from 'react'
import { useThree, useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useDragPreviewStore, peekDragCursor } from './dragPreview'
import { useFormationStore } from '../../stores/formationStore'
import { usePlanesStore } from '../../stores/planesStore'
import { snapToSurface, type BuildPlane } from '../../graph/buildPlane'
import { ACCENT_PRIMARY } from '../../ui/colors'

const _ndc = new THREE.Vector2()
const _normal = new THREE.Vector3()
const _origin = new THREE.Vector3()
const _hit = new THREE.Vector3()
const _quat = new THREE.Quaternion()
const _euler = new THREE.Euler()
const _plane = new THREE.Plane()
const _dummy = new THREE.Object3D()

function planeNormal(plane: BuildPlane): THREE.Vector3 {
  _euler.set(
    (plane.rotationDeg.x * Math.PI) / 180,
    (plane.rotationDeg.y * Math.PI) / 180,
    (plane.rotationDeg.z * Math.PI) / 180,
    'XYZ',
  )
  _quat.setFromEuler(_euler)
  return _normal.set(0, 0, 1).applyQuaternion(_quat).normalize()
}

export function DropGhost() {
  const formationId = useDragPreviewStore((s) => s.formationId)
  const { camera, gl, raycaster } = useThree()
  const meshRef = useRef<THREE.InstancedMesh>(null)
  const ringRef = useRef<THREE.Mesh>(null)

  const points = formationId ? useFormationStore.getState().getPoints(formationId) : undefined
  const count = points?.length ?? 0
  const geom = useMemo(() => new THREE.SphereGeometry(0.28, 8, 8), [])

  useFrame(() => {
    const mesh = meshRef.current
    const ring = ringRef.current
    if (!mesh || !ring || !points || count === 0) return
    const plane = usePlanesStore.getState().getActivePlane()
    const cursor = peekDragCursor()
    if (!plane || !cursor) {
      mesh.visible = false
      ring.visible = false
      return
    }
    const rect = gl.domElement.getBoundingClientRect()
    _ndc.set(((cursor.x - rect.left) / rect.width) * 2 - 1, -((cursor.y - rect.top) / rect.height) * 2 + 1)
    raycaster.setFromCamera(_ndc, camera)
    _origin.set(plane.position.x, plane.position.y, plane.position.z)
    _plane.setFromNormalAndCoplanarPoint(planeNormal(plane), _origin)
    if (!raycaster.ray.intersectPlane(_plane, _hit)) {
      mesh.visible = false
      ring.visible = false
      return
    }
    const pos = snapToSurface({ x: _hit.x, y: _hit.y, z: _hit.z }, plane)
    mesh.visible = true
    ring.visible = true
    for (let i = 0; i < count; i++) {
      const p = points[i]!
      _dummy.position.set(pos.x + p.x, pos.y + p.y, pos.z + p.z)
      _dummy.updateMatrix()
      mesh.setMatrixAt(i, _dummy.matrix)
    }
    mesh.instanceMatrix.needsUpdate = true
    ring.position.set(pos.x, pos.y, pos.z)
    ring.lookAt(pos.x + planeNormal(plane).x, pos.y + planeNormal(plane).y, pos.z + planeNormal(plane).z)
  })

  if (!formationId || count === 0) return null

  return (
    <group>
      <instancedMesh ref={meshRef} args={[geom, undefined, count]} frustumCulled={false}>
        <meshBasicMaterial color={ACCENT_PRIMARY} transparent opacity={0.45} depthWrite={false} />
      </instancedMesh>
      <mesh ref={ringRef}>
        <ringGeometry args={[1.1, 1.5, 32]} />
        <meshBasicMaterial color={ACCENT_PRIMARY} transparent opacity={0.6} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
    </group>
  )
}
