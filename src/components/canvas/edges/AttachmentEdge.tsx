// ============================================================================
// S3-02: Custom Attachment Edge
// ============================================================================
// Thin dashed line, muted gray/orange color, no count badge.
// Visually distinct from flow edges.
// ============================================================================

import { memo } from 'react'
import {
  getBezierPath,
  type EdgeProps,
} from '@xyflow/react'
import { useGraphStore } from '../../../stores/graphStore'
import { useFormationStore } from '../../../stores/formationStore'
import { getIdleBehavior } from '../../../registries/idleBehaviors'
import type { FormationNodeData, IdleNodeData } from '../../../graph/types'
import { ACCENT_PRIMARY } from '../../../ui/colors'

function AttachmentEdgeInner({
  id,
  source,
  target,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  selected,
}: EdgeProps) {
  // A-07: resolve source + target node display names + types for the hover
  // tooltip. Idle → Formation is the common direction; build the label so it
  // reads in narrative order regardless of which side of the edge each sits.
  const nodes = useGraphStore((s) => s.nodes)
  const formations = useFormationStore((s) => s.formations)
  const sourceNode = nodes.find((n) => n.id === source)
  const targetNode = nodes.find((n) => n.id === target)
  const labelFor = (n: typeof sourceNode): string => {
    if (!n) return 'node'
    if (n.type === 'formation') {
      const d = n.data as FormationNodeData
      const f = formations.find((x) => x.id === d.formationId)
      return f?.name ?? d.formationId ?? 'Formation'
    }
    if (n.type === 'idle') {
      const d = n.data as IdleNodeData
      return getIdleBehavior(d.behavior)?.name ?? d.behavior
    }
    return n.type
  }
  const sLabel = labelFor(sourceNode)
  const tLabel = labelFor(targetNode)
  const tooltip = sourceNode?.type === 'idle' && targetNode?.type === 'formation'
    ? `Idle "${sLabel}" attached to formation "${tLabel}"`
    : sourceNode?.type === 'formation' && targetNode?.type === 'idle'
    ? `Idle "${tLabel}" attached to formation "${sLabel}"`
    : `Attachment edge: ${sLabel} → ${tLabel}`

  const [edgePath] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  })

  // Drop BaseEdge in favour of a raw <path> so we can nest a native SVG
  // <title> element — it gives us a free hover tooltip without measuring or
  // positioning a custom popover.
  return (
    <path
      id={id}
      d={edgePath}
      fill="none"
      style={{
        stroke: selected ? ACCENT_PRIMARY : '#c4b5fd',
        strokeWidth: 1.5,
        strokeDasharray: '5 3',
        opacity: 0.85,
      }}
    >
      <title>{tooltip}</title>
    </path>
  )
}

export const AttachmentEdge = memo(AttachmentEdgeInner)
