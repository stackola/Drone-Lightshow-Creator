import { memo } from 'react'
import { Handle, Position, useReactFlow } from '@xyflow/react'
import { Lock } from 'lucide-react'
import type { IdleNodeData } from '../../../graph/types'
import { useViewStore } from '../../../stores/viewStore'
import { useDurationResize } from '../useDurationResize'
import { ValidationBadge } from './ValidationBadge'
import { getIdleBehavior } from '../../../registries/idleBehaviors'

interface IdleNodeProps {
  id: string
  data: IdleNodeData & { incomingDrones?: number; hasOverAllocation?: boolean; hasUnderAllocation?: boolean; unallocatedCount?: number; isActiveAtPlayhead?: boolean }
  selected?: boolean
}

function IdleNodeInner({ id, data, selected }: IdleNodeProps) {
  const pxPerSecond = useViewStore((s) => s.pxPerSecond)
  const { getZoom } = useReactFlow()
  const width = Math.max(120, data.duration * pxPerSecond)
  const endTime = data.startTime + data.duration
  const resize = useDurationResize(id, data.duration, { getZoom })

  return (
    <div
      className={`group relative rounded-lg bg-amber-500 border-2 border-dashed border-amber-300/50 text-white shadow-lg ring-2 ${
        data.hasOverAllocation ? 'ring-red-500 shadow-red-500/40 shadow-lg'
        : selected ? 'ring-cyan-400'
        : data.isActiveAtPlayhead ? 'ring-cyan-400/60 shadow-cyan-400/20 shadow-lg'
        : 'ring-transparent'
      }`}
      style={{ width }}
    >
      <div className="px-3 py-2">
        <div className="flex items-center justify-between text-sm font-semibold">
          <span className="flex items-center gap-1">
            {data.locked && <Lock size={11} className="opacity-80 flex-shrink-0" aria-label="Locked" />}
            {getIdleBehavior(data.behavior)?.name ?? data.behavior}
          </span>
          {data.incomingDrones != null && (
            <span className="ml-2 text-xs bg-amber-700 rounded px-1.5 py-0.5">
              {data.incomingDrones}
            </span>
          )}
        </div>
        <div className="mt-1 text-xs text-white/70">
          {data.startTime.toFixed(1)}s – {endTime.toFixed(1)}s
        </div>
      </div>

      {/* Right-edge resize handle */}
      <div
        className="absolute top-0 right-0 w-2 h-full cursor-ew-resize bg-white/0 group-hover:bg-white/15 hover:!bg-white/30 active:bg-white/40 rounded-r-lg focus:bg-cyan-500/40 outline-none transition-colors"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize idle duration"
        tabIndex={0}
        onKeyDown={resize.onKeyDown}
        onPointerDown={resize.onPointerDown}
        onPointerMove={resize.onPointerMove}
        onPointerUp={resize.onPointerUp}
      />

      <Handle
        type="target"
        position={Position.Left}
        id="flow-in"
        className="!w-3 !h-3 !bg-amber-300 !border-amber-700"
        aria-label="Flow input"
      />
      <Handle
        type="source"
        position={Position.Right}
        id="attach-out"
        className="!w-2.5 !h-2.5 !bg-amber-300 !border-amber-700"
        style={{ bottom: '25%', top: 'auto' }}
        aria-label="Attachment output"
      />
      <ValidationBadge nodeId={id} />
    </div>
  )
}

export const IdleNode = memo(IdleNodeInner)
