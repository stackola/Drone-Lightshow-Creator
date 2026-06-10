// ============================================================================
// Bundle 2: Snap Plane Widget — visible grid quad + PivotControls gizmo
// ============================================================================

import * as THREE from 'three'
import { PivotControls, Grid } from '@react-three/drei'
import { useMemo } from 'react'
import { useViewStore } from '../../stores/viewStore'
import { ACCENT_PRIMARY } from '../../ui/colors'

export function SnapPlaneWidget() {
  const snapPlane = useViewStore((s) => s.snapPlane)
  const setPosition = useViewStore((s) => s.setSnapPlanePosition)
  const setRotationDeg = useViewStore((s) => s.setSnapPlaneRotationDeg)
  const setDraggingGizmo = useViewStore((s) => s.setDraggingGizmo)

  const matrix = useMemo(() => {
    const m = new THREE.Matrix4()
    const e = new THREE.Euler(
      (snapPlane.rotationDeg.x * Math.PI) / 180,
      (snapPlane.rotationDeg.y * Math.PI) / 180,
      (snapPlane.rotationDeg.z * Math.PI) / 180,
      'XYZ',
    )
    m.makeRotationFromEuler(e)
    m.setPosition(snapPlane.position.x, snapPlane.position.y, snapPlane.position.z)
    return m
  }, [snapPlane.position.x, snapPlane.position.y, snapPlane.position.z, snapPlane.rotationDeg.x, snapPlane.rotationDeg.y, snapPlane.rotationDeg.z])

  if (!snapPlane.active) return null

  return (
    <PivotControls
      matrix={matrix}
      autoTransform={false}
      anchor={[0, 0, 0]}
      depthTest={false}
      lineWidth={2}
      disableScaling
      activeAxes={[true, true, true]}
      onDragStart={() => setDraggingGizmo(true)}
      onDragEnd={() => setDraggingGizmo(false)}
      onDrag={(m) => {
        const out = new THREE.Matrix4().fromArray(m.toArray())
        const pos = new THREE.Vector3()
        const quat = new THREE.Quaternion()
        const scl = new THREE.Vector3()
        out.decompose(pos, quat, scl)
        const e = new THREE.Euler().setFromQuaternion(quat, 'XYZ')
        setPosition({ x: pos.x, y: pos.y, z: pos.z })
        setRotationDeg({
          x: (e.x * 180) / Math.PI,
          y: (e.y * 180) / Math.PI,
          z: (e.z * 180) / Math.PI,
        })
      }}
    >
      <group>
        {/* Translucent fill so the plane is visible */}
        <mesh rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[snapPlane.size, snapPlane.size]} />
          <meshBasicMaterial color={ACCENT_PRIMARY} transparent opacity={0.04} side={THREE.DoubleSide} depthWrite={false} />
        </mesh>
        {/* Local grid lines */}
        <Grid
          args={[snapPlane.size, snapPlane.size]}
          cellSize={snapPlane.cellSize}
          cellThickness={0.5}
          cellColor={ACCENT_PRIMARY}
          sectionSize={snapPlane.cellSize * 5}
          sectionThickness={1}
          sectionColor="#06b6d4"
          fadeDistance={snapPlane.size * 1.5}
          fadeStrength={1.5}
          followCamera={false}
        />
      </group>
    </PivotControls>
  )
}
