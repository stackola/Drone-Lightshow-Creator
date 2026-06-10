import { memo } from 'react'
import { Handle, Position } from '@xyflow/react'
import { Rocket } from 'lucide-react'
import type { LaunchNodeData } from '../../../graph/types'
import { useViewStore } from '../../../stores/viewStore'
import { ValidationBadge } from './ValidationBadge'

interface LaunchNodeProps {
  id: string
  data: LaunchNodeData & { hasOverAllocation?: boolean; hasUnderAllocation?: boolean; unallocatedCount?: number; isActiveAtPlayhead?: boolean }
  selected?: boolean
}

function LaunchNodeInner({ id, data, selected }: LaunchNodeProps) {
  const pxPerSecond = useViewStore((s) => s.pxPerSecond)
  // Duration = stagger time + rise time (matches timing.ts)
  const duration = data.droneCount * data.staggerDelay + Math.max(1.5, 8 / 4)
  const width = Math.max(120, duration * pxPerSecond)

  // A-02: multi-line hover tooltip — drone count, stagger, derived launch
  // duration, fan-out timing. Pure read; no graph traversal yet (bottleneck
  // analysis is the medium-effort part of this ticket).
  const totalFanOut = data.droneCount * data.staggerDelay
  const tooltip = [
    `Launch — ${data.droneCount} drone${data.droneCount === 1 ? '' : 's'}`,
    `Stagger: ${data.staggerDelay}s · Total fan-out: ${totalFanOut.toFixed(1)}s`,
    `Estimated launch duration: ${duration.toFixed(1)}s`,
    `Start: ${data.startTime.toFixed(1)}s`,
    data.hasUnderAllocation ? `${data.unallocatedCount} drones not allocated downstream` : null,
  ].filter(Boolean).join('\n')

  return (
    <div
      title={tooltip}
      style={{ width }}
      className={`relative rounded-lg bg-emerald-600 px-3 py-2 text-white shadow-lg ring-2 ${
        data.hasOverAllocation ? 'ring-red-500 shadow-red-500/40 shadow-lg'
        : selected ? 'ring-cyan-400'
        : data.isActiveAtPlayhead ? 'ring-cyan-400/60 shadow-cyan-400/20 shadow-lg'
        : 'ring-transparent'
      }`}
    >
      <div className="flex items-center gap-2 text-sm font-semibold">
        <Rocket size={14} aria-hidden="true" />
        <span>Launch</span>
      </div>
      <div className="mt-1 text-xs text-white/70 space-y-0.5">
        <div>{data.droneCount} drones</div>
        <div>stagger: {data.staggerDelay}s</div>
      </div>
      {data.hasUnderAllocation && data.unallocatedCount != null && data.unallocatedCount > 0 && (
        <div className="absolute -top-2 -right-2 bg-orange-500 text-white text-[9px] font-bold rounded-full px-1.5 py-0.5 leading-none z-10">
          {data.unallocatedCount} unalloc
        </div>
      )}
      <ValidationBadge nodeId={id} />
      <Handle
        type="source"
        position={Position.Right}
        id="flow-out"
        className="!w-3 !h-3 !bg-emerald-400 !border-emerald-700"
        aria-label="Flow output"
      />
    </div>
  )
}

export const LaunchNode = memo(LaunchNodeInner)
