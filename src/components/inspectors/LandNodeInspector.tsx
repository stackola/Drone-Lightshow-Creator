import { useGraphStore } from '../../stores/graphStore'
import { useHistoryStore } from '../../stores/historyStore'
import type { LandNodeData } from '../../graph/types'
import { computeAllTiming } from '../../graph/timing'
import { InspectorHeader, Section } from './shared'
import { TimingSection } from './TimingSection'

export function LandNodeInspector({ nodeId }: { nodeId: string }) {
  const node = useGraphStore((s) => s.nodes.find((n) => n.id === nodeId))
  const nodes = useGraphStore((s) => s.nodes)
  const edges = useGraphStore((s) => s.edges)
  const updateNodeData = useGraphStore((s) => s.updateNodeData)
  const snapshot = useHistoryStore((s) => s.snapshot)

  if (!node || node.type !== 'land') return null
  const data = node.data as LandNodeData
  const range = computeAllTiming({ nodes, edges }).get(nodeId)

  const update = (patch: Partial<LandNodeData>, label = 'Edit Land') => {
    snapshot(label)
    updateNodeData(nodeId, patch as Partial<LandNodeData>)
  }

  // A-05: inferred summary. How many upstream nodes feed this land, and how
  // long does the staggered descent take?
  const upstreamEdges = edges.filter((e) => e.target === nodeId && e.edgeType === 'flow')
  // The drone count flowing in is whatever the launch upstream of this land
  // ultimately fans into — we approximate by summing source launch droneCounts.
  let totalIncoming = 0
  for (const n of nodes) {
    if (n.type !== 'launch') continue
    totalIncoming += (n.data as { droneCount: number }).droneCount
  }
  const descentDuration = totalIncoming * data.staggerDelay

  return (
    <div className="h-full flex flex-col overflow-y-auto">
      <InspectorHeader title="Land Node" />
      <TimingSection
        mode="derived"
        derivedStart={range?.start}
        derivedEnd={range?.end}
        staggerLabel="Stagger"
        staggerValue={data.staggerDelay}
        staggerStep={0.01}
        onStaggerChange={(v) => update({ staggerDelay: v }, 'Set land stagger')}
      />
      <Section title="Inferred">
        <div className="text-micro text-white/60 space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-white/40">Upstream nodes</span>
            <span className="font-mono text-white/80">{upstreamEdges.length}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-white/40">Est. descent time</span>
            <span className="font-mono text-white/80">{descentDuration.toFixed(2)}s</span>
          </div>
          {upstreamEdges.length === 0 && (
            <div className="mt-1 rounded bg-amber-500/10 border border-amber-500/30 px-2 py-1 text-amber-300 text-micro">
              No upstream node — nothing reaches this land. Connect a formation or transition.
            </div>
          )}
        </div>
      </Section>
    </div>
  )
}
