// ============================================================================
// Build Plane Widget — renders every BuildPlane + a move/rotate gizmo on the
// active one. Generalises SnapPlaneWidget to multiple, curvable planes.
// ============================================================================

import * as THREE from 'three'
import { PivotControls } from '@react-three/drei'
import { useMemo } from 'react'
import { usePlanesStore } from '../../stores/planesStore'
import { useViewStore } from '../../stores/viewStore'
import { useHistoryStore } from '../../stores/historyStore'
import { planeSurfaceToLocal, type BuildPlane } from '../../graph/buildPlane'
import { ACCENT_PRIMARY } from '../../ui/colors'

/** Tessellation resolution for a plane's curved surface mesh. */
function segmentsFor(plane: BuildPlane): number {
  const raw = Math.round(plane.size / Math.max(0.5, plane.cellSize))
  return Math.min(48, Math.max(8, raw))
}

/** Build a curvature-lifted surface BufferGeometry in plane-local space. */
function useSurfaceGeometry(plane: BuildPlane): THREE.BufferGeometry {
  return useMemo(() => {
    const n = segmentsFor(plane)
    const half = plane.size / 2
    const step = plane.size / n
    const positions: number[] = []
    for (let j = 0; j <= n; j++) {
      for (let i = 0; i <= n; i++) {
        const local = planeSurfaceToLocal({ u: -half + i * step, v: -half + j * step }, plane)
        positions.push(local.x, local.y, local.z)
      }
    }
    const indices: number[] = []
    const row = n + 1
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const a = j * row + i
        const b = a + 1
        const c = a + row
        const d = c + 1
        indices.push(a, c, b, b, c, d)
      }
    }
    const geom = new THREE.BufferGeometry()
    geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    geom.setIndex(indices)
    geom.computeVertexNormals()
    return geom
  }, [plane.size, plane.cellSize, plane.curvature.type, plane.curvature.amount, plane.curvature.axis, plane.curvature.wavelength])
}

function matrixOf(plane: BuildPlane): THREE.Matrix4 {
  const m = new THREE.Matrix4()
  const e = new THREE.Euler(
    (plane.rotationDeg.x * Math.PI) / 180,
    (plane.rotationDeg.y * Math.PI) / 180,
    (plane.rotationDeg.z * Math.PI) / 180,
    'XYZ',
  )
  m.makeRotationFromEuler(e)
  m.setPosition(plane.position.x, plane.position.y, plane.position.z)
  return m
}

/** Shaded translucent surface + wireframe overlay, in plane-local space. */
function PlaneSurface({ plane, active }: { plane: BuildPlane; active: boolean }) {
  const geom = useSurfaceGeometry(plane)
  const color = plane.locked ? '#f59e0b' : active ? ACCENT_PRIMARY : '#64748b'
  return (
    <group>
      <mesh geometry={geom}>
        <meshBasicMaterial color={color} transparent opacity={active ? 0.12 : 0.05} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      <lineSegments>
        <wireframeGeometry args={[geom]} />
        <lineBasicMaterial color={color} transparent opacity={active ? 0.6 : 0.28} depthWrite={false} />
      </lineSegments>
    </group>
  )
}

export function BuildPlaneWidget() {
  const planes = usePlanesStore((s) => s.planes)
  const activePlaneId = usePlanesStore((s) => s.activePlaneId)
  const updatePlane = usePlanesStore((s) => s.updatePlane)
  const setDraggingGizmo = useViewStore((s) => s.setDraggingGizmo)
  const snapshot = useHistoryStore((s) => s.snapshot)

  return (
    <>
      {planes.filter((p) => p.visible).map((plane) => {
        const active = plane.id === activePlaneId
        if (!active) {
          // Inactive planes: surface only, positioned by a plain group matrix.
          return (
            <group key={plane.id} matrixAutoUpdate={false} matrix={matrixOf(plane)}>
              <PlaneSurface plane={plane} active={false} />
            </group>
          )
        }
        // Active plane: surface wrapped in a move/rotate gizmo.
        return (
          <PivotControls
            key={plane.id}
            matrix={matrixOf(plane)}
            autoTransform={false}
            anchor={[0, 0, 0]}
            depthTest={false}
            lineWidth={2}
            disableScaling
            activeAxes={[true, true, true]}
            onDragStart={() => {
              snapshot('Move plane')
              setDraggingGizmo(true)
            }}
            onDragEnd={() => setDraggingGizmo(false)}
            onDrag={(m) => {
              const out = new THREE.Matrix4().fromArray(m.toArray())
              const pos = new THREE.Vector3()
              const quat = new THREE.Quaternion()
              const scl = new THREE.Vector3()
              out.decompose(pos, quat, scl)
              const e = new THREE.Euler().setFromQuaternion(quat, 'XYZ')
              updatePlane(plane.id, {
                position: { x: pos.x, y: pos.y, z: pos.z },
                rotationDeg: { x: (e.x * 180) / Math.PI, y: (e.y * 180) / Math.PI, z: (e.z * 180) / Math.PI },
              })
            }}
          >
            <PlaneSurface plane={plane} active />
          </PivotControls>
        )
      })}
    </>
  )
}
