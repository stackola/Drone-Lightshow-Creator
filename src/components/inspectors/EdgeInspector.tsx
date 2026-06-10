import { useGraphStore } from '../../stores/graphStore'
import { useHistoryStore } from '../../stores/historyStore'
import { useFormationStore } from '../../stores/formationStore'
import { getIdleBehavior } from '../../registries/idleBehaviors'
import type { AllocationMode } from '../../graph/types'
import { InspectorHeader, Section, Field, NumberInput, SelectInput } from './shared'
import { FlowEdgeTransitionSection } from './FlowEdgeTransitionSection'

export function EdgeInspector({ edgeId }: { edgeId: string }) {
  const edge = useGraphStore((s) => s.edges.find((e) => e.id === edgeId))
  const nodes = useGraphStore((s) => s.nodes)
  const updateEdgeAllocation = useGraphStore((s) => s.updateEdgeAllocation)
  const snapshot = useHistoryStore((s) => s.snapshot)

  if (!edge) return null
  const source = nodes.find((n) => n.id === edge.source)
  const target = nodes.find((n) => n.id === edge.target)
  const formations = useFormationStore((s) => s.formations)
  const nodeLabel = (n: typeof source): string => {
    if (!n) return 'unknown'
    // Resolve to a human-readable name when the node type supports one;
    // fall back to the truncated id prefix when nothing better is available.
    if (n.type === 'formation') {
      const fd = n.data as { formationId: string | null }
      const name = fd.formationId ? formations.find((f) => f.id === fd.formationId)?.name : null
      return `formation · ${name ?? n.id.slice(0, 8)}`
    }
    if (n.type === 'idle') {
      const id = n.data as { behavior: string }
      return `idle · ${getIdleBehavior(id.behavior)?.name ?? id.behavior}`
    }
    return `${n.type} · ${n.id.slice(0, 8)}`
  }

  const setMode = (mode: string) => {
    snapshot('Change Allocation Mode')
    let alloc: AllocationMode
    if (mode === 'manual-count') {
      alloc = { mode: 'manual-count', count: edge.droneCount > 0 ? edge.droneCount : 50 }
    } else if (mode === 'manual-percent') {
      alloc = { mode: 'manual-percent', percent: 50 }
    } else {
      alloc = { mode: 'auto' }
    }
    updateEdgeAllocation(edgeId, alloc)
  }

  const setCount = (count: number) => {
    snapshot('Change Drone Count')
    updateEdgeAllocation(edgeId, { mode: 'manual-count', count: Math.max(1, Math.round(count)) })
  }

  const setPercent = (percent: number) => {
    snapshot('Change Drone %')
    updateEdgeAllocation(edgeId, { mode: 'manual-percent', percent: Math.max(1, Math.min(100, Math.round(percent))) })
  }

  return (
    <div className="h-full flex flex-col overflow-y-auto">
      <InspectorHeader title={edge.edgeType === 'flow' ? 'Flow Edge' : 'Attachment Edge'} />
      <Section title="Connection">
        <div className="text-micro text-white/60 space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-white/40">Source</span>
            <span className="font-mono text-white/80">{nodeLabel(source)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-white/40">Target</span>
            <span className="font-mono text-white/80">{nodeLabel(target)}</span>
          </div>
        </div>
      </Section>
      {edge.edgeType === 'flow' && (
        <>
          <FlowEdgeTransitionSection edge={edge} />
          <Section title="Allocation">
            <Field label="Mode">
              <SelectInput
                value={edge.allocation.mode}
                onChange={setMode}
                options={[
                  { value: 'auto', label: 'Auto' },
                  { value: 'manual-count', label: 'Manual Count' },
                  { value: 'manual-percent', label: 'Manual Percent' },
                ]}
              />
            </Field>
            {edge.allocation.mode === 'manual-count' && (
              <Field label="Count">
                <NumberInput value={edge.allocation.count} onChange={setCount} min={1} step={1} />
              </Field>
            )}
            {edge.allocation.mode === 'manual-percent' && (
              <Field label="Percent">
                <NumberInput value={edge.allocation.percent} onChange={setPercent} min={1} max={100} step={5} />
              </Field>
            )}
          </Section>
          <Section title="Info">
            <div className="text-xs text-white/40">
              Computed: {edge.droneCount} drones
            </div>
          </Section>
        </>
      )}
      {edge.edgeType === 'attachment' && (
        <Section title="Info">
          <div className="text-xs text-white/40">
            Structural sync only — no drone flow
          </div>
        </Section>
      )}
    </div>
  )
}
