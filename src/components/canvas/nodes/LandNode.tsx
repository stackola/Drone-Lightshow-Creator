import { memo } from 'react'
import { Handle, Position } from '@xyflow/react'
import { ArrowDownToLine, Lock } from 'lucide-react'
import type { LandNodeData } from '../../../graph/types'
import { ValidationBadge } from './ValidationBadge'

interface LandNodeProps {
  id: string
  data: LandNodeData & { hasOverAllocation?: boolean; isActiveAtPlayhead?: boolean }
  selected?: boolean
}

function LandNodeInner({ id, data, selected }: LandNodeProps) {
  // A-05: richer tooltip — surfaces the "protected from deletion" rule that
  // was previously discoverable only by trying to delete the node and seeing
  // it refuse. Also names the derived timing explicitly.
  const tooltip = [
    'Land',
    `Stagger: ${data.staggerDelay}s (between drones)`,
    'Timing derived from upstream nodes',
    'Protected from deletion — every show needs a land node',
  ].join('\n')

  return (
    <div
      className={`relative rounded-lg bg-red-600 border border-dashed border-red-300/40 px-3 py-2 min-w-[120px] text-white shadow-lg ring-2 ${
        data.hasOverAllocation ? 'ring-yellow-400 shadow-yellow-400/40 shadow-lg'
        : selected ? 'ring-cyan-400'
        : data.isActiveAtPlayhead ? 'ring-cyan-400/60 shadow-cyan-400/20 shadow-lg'
        : 'ring-transparent'
      }`}
      title={tooltip}
    >
      <div className="flex items-center gap-2 text-sm font-semibold">
        <ArrowDownToLine size={14} aria-hidden="true" />
        <span>Land</span>
        <Lock size={10} className="text-white/50 ml-auto" aria-hidden="true" />
      </div>
      <div className="mt-1 text-xs text-white/70">
        stagger: {data.staggerDelay}s
      </div>
      <Handle
        type="target"
        position={Position.Left}
        id="flow-in"
        className="!w-3 !h-3 !bg-red-400 !border-red-700"
        aria-label="Flow input"
      />
      <ValidationBadge nodeId={id} />
    </div>
  )
}

export const LandNode = memo(LandNodeInner)
