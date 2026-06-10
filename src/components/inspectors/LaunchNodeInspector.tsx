import { useGraphStore } from '../../stores/graphStore'
import { useHistoryStore } from '../../stores/historyStore'
import type { LaunchNodeData } from '../../graph/types'
import { computeAllTiming } from '../../graph/timing'
import { InspectorHeader, Section, Field, NumberInput } from './shared'
import { TimingSection } from './TimingSection'

export function LaunchNodeInspector({ nodeId }: { nodeId: string }) {
  const node = useGraphStore((s) => s.nodes.find((n) => n.id === nodeId))
  const nodes = useGraphStore((s) => s.nodes)
  const edges = useGraphStore((s) => s.edges)
  const updateNodeData = useGraphStore((s) => s.updateNodeData)
  const snapshot = useHistoryStore((s) => s.snapshot)

  if (!node || node.type !== 'launch') return null
  const data = node.data as LaunchNodeData
  const timing = computeAllTiming({ nodes, edges })
  const range = timing.get(nodeId)

  const update = (patch: Partial<LaunchNodeData>, label = 'Edit Launch') => {
    snapshot(label)
    updateNodeData(nodeId, patch as Partial<LaunchNodeData>)
  }

  // A-02: inferred summary. How long does the launch take, and what
  // downstream targets does it feed?
  const launchDuration = data.droneCount * data.staggerDelay
  const downstreamEdges = edges.filter((e) => e.source === nodeId && e.edgeType === 'flow')
  const downstreamTargets = downstreamEdges
    .map((e) => nodes.find((n) => n.id === e.target))
    .filter((n): n is NonNullable<typeof n> => n != null)

  return (
    <div className="h-full flex flex-col overflow-y-auto">
      <InspectorHeader title="Launch Node" />
      <Section title="Properties">
        <Field label="Drones">
          <NumberInput value={data.droneCount} onChange={(v) => update({ droneCount: Math.max(1, Math.round(v)) }, 'Set launch drone count')} min={1} step={1} />
        </Field>
      </Section>
      <Section title="Inferred">
        <div className="text-micro text-white/60 space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-white/40">Total launch time</span>
            <span className="font-mono text-white/80">{launchDuration.toFixed(2)}s</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-white/40">Downstream nodes</span>
            <span className="font-mono text-white/80">{downstreamTargets.length}</span>
          </div>
          {downstreamTargets.length === 0 && (
            <div className="mt-1 rounded bg-amber-500/10 border border-amber-500/30 px-2 py-1 text-amber-300 text-micro">
              No downstream targets — drones won&apos;t go anywhere. Connect a formation.
            </div>
          )}
        </div>
      </Section>
      <TimingSection
        mode="authored"
        startTime={data.startTime}
        duration={range ? range.end - range.start : data.droneCount * data.staggerDelay}
        onStartTimeChange={(v) => update({ startTime: v }, 'Set launch start time')}
        staggerLabel="Stagger"
        staggerValue={data.staggerDelay}
        staggerStep={0.01}
        onStaggerChange={(v) => update({ staggerDelay: v }, 'Set launch stagger')}
        derivedStart={range?.start}
        derivedEnd={range?.end}
      />
    </div>
  )
}
