// ============================================================================
// Transition pills in 3D — a clickable marker at the midpoint of every
// formation→formation flow edge. Click → select the edge (the inspector
// already routes single-edge selection to EdgeInspector), making transitions
// editable without leaving the stage. Fuchsia matches the timeline's
// transition-segment language.
// ============================================================================

import { useMemo, useState } from 'react'
import { useGraphStore } from '../../stores/graphStore'
import { useSelectionStore } from '../../stores/selectionStore'
import type { FormationNodeData } from '../../graph/types'
import { ACCENT_TRANSITION } from '../../ui/colors'

interface Pill {
  edgeId: string
  position: [number, number, number]
}

export function TransitionPills3D() {
  const nodes = useGraphStore((s) => s.nodes)
  const edges = useGraphStore((s) => s.edges)
  const selectedEdgeIds = useSelectionStore((s) => s.selectedEdgeIds)
  const selectEdge = useSelectionStore((s) => s.selectEdge)
  const [hoveredId, setHoveredId] = useState<string | null>(null)

  const pills = useMemo<Pill[]>(() => {
    const result: Pill[] = []
    for (const edge of edges) {
      if (edge.edgeType !== 'flow' || !edge.transition) continue
      const src = nodes.find((n) => n.id === edge.source)
      const tgt = nodes.find((n) => n.id === edge.target)
      if (src?.type !== 'formation' || tgt?.type !== 'formation') continue
      const a = (src.data as FormationNodeData).transform.position
      const b = (tgt.data as FormationNodeData).transform.position
      result.push({
        edgeId: edge.id,
        position: [(a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2],
      })
    }
    return result
  }, [nodes, edges])

  if (pills.length === 0) return null

  return (
    <>
      {pills.map((pill) => {
        const selected = selectedEdgeIds.includes(pill.edgeId)
        const hovered = hoveredId === pill.edgeId
        return (
          <mesh
            key={pill.edgeId}
            position={pill.position}
            scale={selected || hovered ? 1.4 : 1}
            onClick={(e) => {
              e.stopPropagation()
              selectEdge(pill.edgeId)
            }}
            onPointerOver={(e) => {
              e.stopPropagation()
              setHoveredId(pill.edgeId)
              document.body.style.cursor = 'pointer'
            }}
            onPointerOut={() => {
              setHoveredId((id) => (id === pill.edgeId ? null : id))
              document.body.style.cursor = ''
            }}
          >
            <octahedronGeometry args={[0.8]} />
            <meshStandardMaterial
              color={ACCENT_TRANSITION}
              emissive={ACCENT_TRANSITION}
              emissiveIntensity={selected ? 1.6 : hovered ? 1.2 : 0.6}
              transparent
              opacity={selected ? 0.95 : 0.7}
            />
          </mesh>
        )
      })}
    </>
  )
}
