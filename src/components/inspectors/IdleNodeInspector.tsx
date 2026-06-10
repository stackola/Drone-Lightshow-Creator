import { useGraphStore } from '../../stores/graphStore'
import { useHistoryStore } from '../../stores/historyStore'
import { useFormationStore } from '../../stores/formationStore'
import type { IdleNodeData, IdleBehavior } from '../../graph/types'
import { getAllIdleBehaviors } from '../../registries/idleBehaviors'
import { getAllColorPrograms } from '../../graph/colorPrograms'
import { InspectorHeader, LockedBanner, Section, Field, NumberInput, SelectInput, VectorInput } from './shared'
import { TimingSection } from './TimingSection'
import { computeAllTiming } from '../../graph/timing'
import { RegistrySelect } from '../inputs/RegistrySelect'
// (The bespoke IdlePatternPreview was removed 2026-05-21 — superseded by the
// L4 RegistrySelect which renders L1 previews per option. Plan §L1.)

export function IdleNodeInspector({ nodeId }: { nodeId: string }) {
  const node = useGraphStore((s) => s.nodes.find((n) => n.id === nodeId))
  const nodes = useGraphStore((s) => s.nodes)
  const edges = useGraphStore((s) => s.edges)
  const updateNodeData = useGraphStore((s) => s.updateNodeData)
  const snapshot = useHistoryStore((s) => s.snapshot)

  if (!node || node.type !== 'idle') return null
  const data = node.data as IdleNodeData
  const range = computeAllTiming({ nodes, edges }).get(nodeId)

  // Pass a `label` so each call site contributes a semantic Undo-toast label
  // ("Undo: Set idle radius") instead of the generic "Edit Idle".
  const update = (patch: Partial<IdleNodeData>, label = 'Edit Idle') => {
    snapshot(label)
    updateNodeData(nodeId, patch as Partial<IdleNodeData>)
  }

  const behaviors = getAllIdleBehaviors().map((b) => ({ value: b.id, label: b.name }))

  return (
    <div className="h-full flex flex-col">
      <InspectorHeader title={`Idle · ${getAllIdleBehaviors().find((b) => b.id === data.behavior)?.name ?? data.behavior}`} />
      {data.locked && <LockedBanner onUnlock={() => { snapshot('Unlock Idle'); updateNodeData(nodeId, { locked: false } as Partial<IdleNodeData>) }} />}
      <div className={`flex-1 overflow-y-auto ${data.locked ? 'pointer-events-none opacity-60' : ''}`}>
      <Section title="Behavior">
        <Field label="Type">
          {/* L4 RegistrySelect — full popover of behaviour previews. Each tile
              shows the actual behavior animation; click to swap. */}
          <RegistrySelect
            kind="idle"
            value={data.behavior}
            options={behaviors.map((b) => ({ id: b.value, label: b.label }))}
            onChange={(v) => update({ behavior: v as IdleBehavior }, 'Set idle behavior')}
            params={{ radius: data.radius, speed: data.speed, altitude: data.altitude }}
          />
        </Field>
      </Section>
      <TimingSection
        mode="authored"
        startTime={data.startTime}
        duration={data.duration}
        onStartTimeChange={(v) => update({ startTime: v }, 'Set idle start time')}
        onDurationChange={(v) => update({ duration: v }, 'Set idle duration')}
        derivedStart={range?.start}
        derivedEnd={range?.end}
      />
      <Section title="Center Position">
        <Field label="Center">
          <VectorInput
            value={data.center}
            onChange={(v) => update({ center: v }, 'Set idle center')}
            step={1}
            unit="m"
          />
        </Field>
      </Section>
      <Section title="Properties">
        <Field label="Radius">
          <NumberInput value={data.radius} onChange={(v) => update({ radius: Math.max(0, v) }, 'Set idle radius')} min={0} step={1} />
        </Field>
        <Field label="Speed">
          <NumberInput value={data.speed} onChange={(v) => update({ speed: Math.max(0, v) }, 'Set idle speed')} min={0} step={0.1} />
        </Field>
        <Field label="Altitude">
          <NumberInput value={data.altitude} onChange={(v) => update({ altitude: Math.max(0, v) }, 'Set idle altitude')} min={0} step={1} />
        </Field>
      </Section>
      <Section title="Color Program">
        <Field label="Program">
          <SelectInput
            value={data.colorProgramId ?? ''}
            onChange={(v) => update({ colorProgramId: v || null }, 'Set idle color program')}
            options={[
              { value: '', label: '(default)' },
              ...getAllColorPrograms().map((p) => ({ value: p.id, label: p.name })),
            ]}
          />
        </Field>
      </Section>
      {(() => {
        // A-04: inferred summary. Idle nodes can be standalone or attached to
        // a formation via an attachment edge. Show which (and which formation).
        const attachmentEdge = edges.find((e) => e.target === nodeId && e.edgeType === 'attachment')
        const flowIn = edges.filter((e) => e.target === nodeId && e.edgeType === 'flow').length
        const flowOut = edges.filter((e) => e.source === nodeId && e.edgeType === 'flow').length
        const parent = attachmentEdge ? nodes.find((n) => n.id === attachmentEdge.source) : null
        const parentName = parent?.type === 'formation'
          ? (useFormationStore.getState().formations.find((f) => f.id === (parent.data as { formationId: string | null }).formationId)?.name ?? null)
          : null
        return (
          <Section title="Inferred">
            <div className="text-micro text-white/60 space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-white/40">Attached to</span>
                <span className="font-mono text-white/80">
                  {parent ? (parentName ?? `formation (${parent.id.slice(0, 8)})`) : 'standalone'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-white/40">Flow in / out</span>
                <span className="font-mono text-white/80">{flowIn} / {flowOut}</span>
              </div>
              {flowIn === 0 && !parent && (
                <div className="mt-1 rounded bg-amber-500/10 border border-amber-500/30 px-2 py-1 text-amber-300 text-micro">
                  Idle has no input — nothing reaches it. Attach to a formation or connect upstream.
                </div>
              )}
            </div>
          </Section>
        )
      })()}
      </div>
    </div>
  )
}
