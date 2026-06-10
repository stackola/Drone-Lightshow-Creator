import { memo } from 'react'
import { Handle, Position, useReactFlow } from '@xyflow/react'
import { Lock } from 'lucide-react'
import type { FormationNodeData } from '../../../graph/types'
import { useViewStore } from '../../../stores/viewStore'
import { useFormationStore } from '../../../stores/formationStore'
import { useDurationResize } from '../useDurationResize'
import { ValidationBadge } from './ValidationBadge'
import { RegistryItemPreview } from '../../RegistryItemPreview'
import { getIdleBehavior } from '../../../registries/idleBehaviors'
import { getColorProgram } from '../../../graph/colorPrograms'

interface FormationNodeProps {
  id: string
  data: FormationNodeData & { label?: string; incomingDrones?: number; hasOverAllocation?: boolean; hasUnderAllocation?: boolean; unallocatedCount?: number; isActiveAtPlayhead?: boolean }
  selected?: boolean
}

function FormationNodeInner({ id, data, selected }: FormationNodeProps) {
  const pxPerSecond = useViewStore((s) => s.pxPerSecond)
  const { getZoom } = useReactFlow()
  const width = Math.max(120, data.duration * pxPerSecond)
  const endTime = data.startTime + data.duration
  const resize = useDurationResize(id, data.duration, { getZoom })

  // L1 thumbnail — look up the underlying formation and, if it's a static
  // generator-based formation, render a tiny preview inside the card. Only
  // when there's room (wider than ~140 px).
  const formation = useFormationStore((s) => (data.formationId ? s.formations.find((f) => f.id === data.formationId) : undefined))
  const showThumbnail = width >= 140 && formation && formation.type === 'static' && formation.generatorId

  const annotationCount = data.annotations?.length ?? 0
  const muted = data.muted
  const soloed = data.soloed
  const locked = data.locked
  const colorProgramName = data.colorProgramId ? getColorProgram(data.colorProgramId)?.name ?? data.colorProgramId : null
  const tooltip = [
    `Formation${formation?.name ? ` · ${formation.name}` : ''}`,
    `Time: ${data.startTime.toFixed(1)}s → ${endTime.toFixed(1)}s (${data.duration.toFixed(1)}s)`,
    colorProgramName ? `Color: ${colorProgramName}` : null,
    data.keyframes.length ? `${data.keyframes.length} transform keyframes` : null,
    data.colorKeyframes?.length ? `${data.colorKeyframes.length} color keyframes` : null,
    data.colorOverrides?.length ? `${data.colorOverrides.length} color override groups` : null,
    data.symmetry ? `Symmetry: ${data.symmetry.axis.toUpperCase()}` : null,
    muted ? 'MUTED' : null,
    soloed ? 'SOLO' : null,
    locked ? 'LOCKED' : null,
  ].filter(Boolean).join('\n')

  return (
    <div
      title={tooltip}
      style={{ width, opacity: muted ? 0.5 : 1 }}
      className={`group relative rounded-lg bg-blue-600 text-white shadow-lg ring-2 ${
        data.hasOverAllocation ? 'ring-red-500 shadow-red-500/40 shadow-lg'
        : selected ? 'ring-cyan-400'
        : data.isActiveAtPlayhead ? 'ring-cyan-400/60 shadow-cyan-400/20 shadow-lg animate-pulse-slow'
        : 'ring-transparent'
      } ${soloed ? 'outline outline-2 outline-yellow-300/70' : ''}`}
    >
      <div className="px-3 py-2 flex items-center gap-2">
        {showThumbnail && formation && (
          <RegistryItemPreview
            kind="generator"
            id={formation.generatorId}
            params={formation.parameters}
            size={32}
            framed={false}
          />
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between text-sm font-semibold">
            <span className="truncate flex items-center gap-1">
              {locked && <Lock size={11} className="opacity-80 flex-shrink-0" aria-label="Locked" />}
              {data.label ?? formation?.name ?? data.formationId ?? 'Formation'}
            </span>
            {data.incomingDrones != null && (
              <span className="ml-2 text-xs bg-blue-800 rounded px-1.5 py-0.5">
                {data.incomingDrones}
              </span>
            )}
          </div>
          <div className="mt-1 text-xs text-white/70">
            {data.startTime.toFixed(1)}s – {endTime.toFixed(1)}s
          </div>
        </div>
      </div>

      {/* Attached idle sub-bars */}
      {data.idleConfigs.length > 0 && (
        <div className="px-1 pb-1 space-y-1">
          {data.idleConfigs.map((ic) => (
            <div
              key={ic.id}
              className="rounded bg-amber-500/80 px-2 py-0.5 text-xs text-white/90 flex justify-between"
            >
              <span>{getIdleBehavior(ic.behavior)?.name ?? ic.behavior}</span>
              <span>idle</span>
            </div>
          ))}
        </div>
      )}

      {data.hasUnderAllocation && data.unallocatedCount != null && data.unallocatedCount > 0 && (
        <div className="absolute -top-2 -right-2 bg-orange-500 text-white text-caption font-bold rounded-full px-1.5 py-0.5 leading-none z-10" title={`${data.unallocatedCount} unallocated drones`}>
          {data.unallocatedCount}
        </div>
      )}
      {annotationCount > 0 && (
        <div className="absolute -top-2 -left-2 bg-amber-400 text-amber-900 text-micro font-bold rounded-full w-5 h-5 flex items-center justify-center z-10" title={`${annotationCount} note${annotationCount === 1 ? '' : 's'}`}>
          📝
        </div>
      )}
      <ValidationBadge nodeId={id} />

      {/* Right-edge resize handle — wider, more discoverable */}
      <div
        className="absolute top-0 right-0 w-2 h-full cursor-ew-resize bg-white/0 group-hover:bg-white/15 hover:!bg-white/30 active:bg-white/40 rounded-r-lg focus:bg-cyan-500/40 outline-none transition-colors"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize formation duration"
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
        className="!w-3 !h-3 !bg-blue-400 !border-blue-700"
        aria-label="Flow input"
      />
      <Handle
        type="source"
        position={Position.Right}
        id="flow-out"
        className="!w-3 !h-3 !bg-blue-400 !border-blue-700"
        aria-label="Flow output"
      />
      <Handle
        type="target"
        position={Position.Bottom}
        id="idle-attach"
        className="!w-2.5 !h-2.5 !bg-amber-400 !border-amber-700"
        style={{ left: '80%' }}
        aria-label="Idle attachment"
      />
    </div>
  )
}

export const FormationNode = memo(FormationNodeInner)
