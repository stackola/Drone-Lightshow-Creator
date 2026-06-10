// ============================================================================
// Mapping line viz — when a shortest-path flow edge is selected, render
// straight line segments from each source point to its mapped target point,
// colored by per-pair distance (blue = short, red = long). Read-only.
// ============================================================================

import { useMemo } from 'react'
import * as THREE from 'three'
import { useSelectionStore } from '../../stores/selectionStore'
import { useGraphStore } from '../../stores/graphStore'
import { useFormationStore } from '../../stores/formationStore'
import { hungarianMapping } from '../../registries/transitions'
import type { FormationNodeData, Vec3 } from '../../graph/types'
import { ACCENT_PRIMARY } from '../../ui/colors'

export function TransitionMappingLines() {
  const selectedEdgeIds = useSelectionStore((s) => s.selectedEdgeIds)
  const nodes = useGraphStore((s) => s.nodes)
  const edges = useGraphStore((s) => s.edges)
  const generatedPoints = useFormationStore((s) => s.generatedPoints)

  const geometry = useMemo(() => {
    if (selectedEdgeIds.length !== 1) return null
    const edge = edges.find((e) => e.id === selectedEdgeIds[0])
    if (!edge || edge.edgeType !== 'flow' || !edge.transition) return null
    if (edge.transition.strategyId !== 'shortest-path') return null

    const srcNode = nodes.find((n) => n.id === edge.source)
    const tgtNode = nodes.find((n) => n.id === edge.target)
    if (!srcNode || !tgtNode) return null
    if (srcNode.type !== 'formation' || tgtNode.type !== 'formation') return null

    const fromPts: Vec3[] = []
    const toPts: Vec3[] = []
    const sfd = srcNode.data as FormationNodeData
    const tfd = tgtNode.data as FormationNodeData
    const sPts = sfd.formationId ? generatedPoints.get(sfd.formationId) : null
    const tPts = tfd.formationId ? generatedPoints.get(tfd.formationId) : null
    if (!sPts || !tPts) return null

    for (const p of sPts) {
      fromPts.push({
        x: p.x * sfd.transform.scale.x + sfd.transform.position.x,
        y: p.y * sfd.transform.scale.y + sfd.transform.position.y,
        z: p.z * sfd.transform.scale.z + sfd.transform.position.z,
      })
    }
    for (const p of tPts) {
      toPts.push({
        x: p.x * tfd.transform.scale.x + tfd.transform.position.x,
        y: p.y * tfd.transform.scale.y + tfd.transform.position.y,
        z: p.z * tfd.transform.scale.z + tfd.transform.position.z,
      })
    }
    if (fromPts.length === 0 || toPts.length === 0) return null
    if (Math.min(fromPts.length, toPts.length) > 200) return null

    const mapping = hungarianMapping(fromPts, toPts)
    if (mapping.length === 0) return null

    const dists: number[] = []
    let maxD = 0
    for (const m of mapping) {
      const a = fromPts[m.sourceIndex]!
      const b = toPts[m.targetIndex]!
      const d = Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2)
      dists.push(d)
      if (d > maxD) maxD = d
    }
    if (maxD === 0) return null

    const positions = new Float32Array(mapping.length * 6)
    const colors = new Float32Array(mapping.length * 6)
    const cBlue = new THREE.Color(ACCENT_PRIMARY)
    const cRed = new THREE.Color('#f97316')
    const cTemp = new THREE.Color()
    for (let i = 0; i < mapping.length; i++) {
      const m = mapping[i]!
      const a = fromPts[m.sourceIndex]!
      const b = toPts[m.targetIndex]!
      positions[i * 6 + 0] = a.x
      positions[i * 6 + 1] = a.y
      positions[i * 6 + 2] = a.z
      positions[i * 6 + 3] = b.x
      positions[i * 6 + 4] = b.y
      positions[i * 6 + 5] = b.z
      const t = dists[i]! / maxD
      cTemp.copy(cBlue).lerp(cRed, t)
      for (let k = 0; k < 2; k++) {
        colors[i * 6 + k * 3 + 0] = cTemp.r
        colors[i * 6 + k * 3 + 1] = cTemp.g
        colors[i * 6 + k * 3 + 2] = cTemp.b
      }
    }
    const geom = new THREE.BufferGeometry()
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geom.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    return geom
  }, [selectedEdgeIds, nodes, edges, generatedPoints])

  if (!geometry) return null

  return (
    <lineSegments geometry={geometry}>
      <lineBasicMaterial vertexColors transparent opacity={0.5} depthWrite={false} />
    </lineSegments>
  )
}
