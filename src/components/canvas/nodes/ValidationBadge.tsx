// ============================================================================
// Slice 2 Step 4: ValidationBadge
// ============================================================================
// Inline badge on a node that reads flowDiagnostics + timing warnings and
// renders a red/amber dot with the violation count. Click selects the node and
// dispatches an `inspector:focusField` event (Inspector listens — out of scope here).
// ============================================================================

import { memo } from 'react'
import { useGraphStore } from '../../../stores/graphStore'
import { useSelectionStore } from '../../../stores/selectionStore'

function ValidationBadgeInner({ nodeId }: { nodeId: string }) {
  const diagnostics = useGraphStore((s) => s.flowDiagnostics)
  const relevant = diagnostics.filter((d) => d.nodeIds.includes(nodeId))
  if (relevant.length === 0) return null

  const errors = relevant.filter((d) => d.severity === 'error').length
  const warnings = relevant.filter((d) => d.severity === 'warning').length
  const tone = errors > 0 ? 'error' : 'warning'
  const count = errors + warnings
  const colorClass = tone === 'error' ? 'bg-red-500 text-white' : 'bg-amber-500 text-black'
  const title = relevant.map((d) => d.message).join('\n')

  const onClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    useSelectionStore.getState().selectNode(nodeId)
    window.dispatchEvent(new CustomEvent('inspector:focusField', { detail: { nodeId } }))
  }

  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={`${count} ${tone}${count > 1 ? 's' : ''}`}
      className={`absolute -top-1.5 -right-1.5 min-w-[14px] h-[14px] px-1 rounded-full text-[9px] font-bold leading-none flex items-center justify-center z-10 ${colorClass} shadow-sm border border-black/30`}
    >
      {count}
    </button>
  )
}

export const ValidationBadge = memo(ValidationBadgeInner)
