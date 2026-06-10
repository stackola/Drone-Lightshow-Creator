// ============================================================================
// Bundle 3: Symmetry plane overlay — faint translucent plane in formation-local
// space, rendered for every formation node that has `symmetry` set.
// ============================================================================

import * as THREE from 'three'
import { useGraphStore } from '../../stores/graphStore'
import type { FormationNodeData, ShowNode } from '../../graph/types'

export function SymmetryOverlay() {
  const nodes = useGraphStore((s) => s.nodes)
  const overlays: { id: string; node: ShowNode; data: FormationNodeData }[] = []
  for (const n of nodes) {
    if (n.type !== 'formation') continue
    const d = n.data as FormationNodeData
    if (!d.symmetry) continue
    overlays.push({ id: n.id, node: n, data: d })
  }
  if (overlays.length === 0) return null
  return (
    <group>
      {overlays.map(({ id, data }) => {
        const t = data.transform
        // Pre-compute orientation: plane perpendicular to mirror axis.
        const axisRot: [number, number, number] =
          data.symmetry!.axis === 'x' ? [0, Math.PI / 2, 0]
          : data.symmetry!.axis === 'y' ? [Math.PI / 2, 0, 0]
          : [0, 0, 0]
        return (
          <group key={id}
            position={[t.position.x, t.position.y, t.position.z]}
            rotation={[t.rotation.x, t.rotation.y, t.rotation.z]}
            scale={[t.scale.x, t.scale.y, t.scale.z]}
          >
            <mesh rotation={axisRot}>
              <planeGeometry args={[40, 40]} />
              <meshBasicMaterial color="#a78bfa" transparent opacity={0.05} side={THREE.DoubleSide} depthWrite={false} />
            </mesh>
          </group>
        )
      })}
    </group>
  )
}
