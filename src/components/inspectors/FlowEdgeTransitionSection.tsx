// ============================================================================
// FlowEdgeTransitionSection — strategy + duration UI for a flow edge
// ============================================================================
// Replaces the former TransitionNodeInspector. Reads / writes the transition
// config that lives on ShowEdge.transition.
// ============================================================================

import { useMemo } from 'react'
import { useGraphStore } from '../../stores/graphStore'
import { useHistoryStore } from '../../stores/historyStore'
import { useProjectStore } from '../../stores/projectStore'
import { useFormationStore } from '../../stores/formationStore'
import type { Vec3, FormationNodeData, ShowEdge, TransitionConfig } from '../../graph/types'
import { getAllTransitions, getTransition, hungarianMapping } from '../../registries/transitions'
import type { TransitionConstraints } from '../../registries/transitions'
import { Section, Field, NumberInput, SelectInput } from './shared'
import { TimingSection } from './TimingSection'

export function FlowEdgeTransitionSection({ edge }: { edge: ShowEdge }) {
  const nodes = useGraphStore((s) => s.nodes)
  const edgeTiming = useGraphStore((s) => s.getCachedEdgeTiming())
  const updateEdgeTransition = useGraphStore((s) => s.updateEdgeTransition)
  const pushDownstreamTiming = useGraphStore((s) => s.pushDownstreamTiming)
  const snapshot = useHistoryStore((s) => s.snapshot)
  const projectConstraints = useProjectStore((s) => s.constraints)
  const generatedPoints = useFormationStore((s) => s.generatedPoints)

  const cfg = edge.transition
  if (!cfg) return null

  const update = (patch: Partial<TransitionConfig>) => {
    snapshot('Edit Transition')
    updateEdgeTransition(edge.id, patch)
  }

  const updateParam = (key: string, value: unknown) => {
    snapshot(`Set transition ${key}`)
    updateEdgeTransition(edge.id, { parameters: { ...cfg.parameters, [key]: value } })
  }

  const p = (key: string, fallback: number) => {
    const v = Number(cfg.parameters[key])
    return isNaN(v) ? fallback : v
  }

  const strategies = getAllTransitions().map((t) => ({ value: t.id, label: t.name }))

  const eTime = edgeTiming.get(edge.id)
  const currentDuration = eTime ? eTime.end - eTime.start : cfg.preferredDuration

  const sourceNode = nodes.find((n) => n.id === edge.source)
  const targetNode = nodes.find((n) => n.id === edge.target)

  const minDuration = useMemo<number | null>(() => {
    const strategy = getTransition(cfg.strategyId)
    if (!strategy?.computeMinDuration) return null

    const constraints: TransitionConstraints = {
      maxVelocity: projectConstraints.maxVelocity,
      maxAcceleration: projectConstraints.maxAcceleration,
      minSpacing: projectConstraints.minDroneDistance,
      motionSpacing: Math.max(0.5, projectConstraints.minDroneDistance * 0.5),
    }

    const fromPts: Vec3[] = []
    const toPts: Vec3[] = []
    if (sourceNode?.type === 'formation') {
      const fd = sourceNode.data as FormationNodeData
      const pts = fd.formationId ? generatedPoints.get(fd.formationId) : null
      if (pts) fromPts.push(...pts)
    }
    if (targetNode?.type === 'formation') {
      const fd = targetNode.data as FormationNodeData
      const pts = fd.formationId ? generatedPoints.get(fd.formationId) : null
      if (pts) toPts.push(...pts)
    }
    if (fromPts.length === 0 || toPts.length === 0) return null

    const count = Math.min(fromPts.length, toPts.length)
    const mapping = Array.from({ length: count }, (_, i) => ({ sourceIndex: i, targetIndex: i }))
    return strategy.computeMinDuration(mapping, fromPts, toPts, cfg.parameters, constraints)
  }, [cfg.strategyId, cfg.parameters, sourceNode, targetNode, generatedPoints, projectConstraints])

  const needsMoreTime = minDuration !== null && minDuration > currentDuration + 0.05
  const pushDelta = needsMoreTime ? minDuration! - currentDuration : 0

  const mappingStats = useMemo<{ total: number; avg: number; max: number; count: number } | null>(() => {
    if (cfg.strategyId !== 'shortest-path') return null
    const fromPts: Vec3[] = []
    const toPts: Vec3[] = []
    if (sourceNode?.type === 'formation') {
      const fd = sourceNode.data as FormationNodeData
      const pts = fd.formationId ? generatedPoints.get(fd.formationId) : null
      if (pts) fromPts.push(...pts)
    }
    if (targetNode?.type === 'formation') {
      const fd = targetNode.data as FormationNodeData
      const pts = fd.formationId ? generatedPoints.get(fd.formationId) : null
      if (pts) toPts.push(...pts)
    }
    if (fromPts.length === 0 || toPts.length === 0) return null
    const mapping = hungarianMapping(fromPts, toPts)
    if (mapping.length === 0) return null
    let total = 0
    let max = 0
    for (const m of mapping) {
      const a = fromPts[m.sourceIndex]
      const b = toPts[m.targetIndex]
      if (!a || !b) continue
      const dx = a.x - b.x
      const dy = a.y - b.y
      const dz = a.z - b.z
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz)
      total += d
      if (d > max) max = d
    }
    return { total, avg: total / mapping.length, max, count: mapping.length }
  }, [cfg.strategyId, sourceNode, targetNode, generatedPoints])

  const handlePush = () => {
    if (pushDelta <= 0) return
    // Push the downstream timed node (target) forward.
    snapshot('Push downstream timing')
    pushDownstreamTiming(edge.target, pushDelta)
  }

  const sourcePoints = sourceNode?.type === 'formation'
    ? ((sourceNode.data as FormationNodeData).formationId
        ? (generatedPoints.get((sourceNode.data as FormationNodeData).formationId!)?.length ?? 0)
        : 0)
    : 0
  const targetPoints = targetNode?.type === 'formation'
    ? ((targetNode.data as FormationNodeData).formationId
        ? (generatedPoints.get((targetNode.data as FormationNodeData).formationId!)?.length ?? 0)
        : 0)
    : 0

  return (
    <div className={cfg.locked ? 'pointer-events-none opacity-60' : ''}>
      <Section title="Transition">
        <Field label="Strategy">
          <SelectInput
            value={cfg.strategyId}
            onChange={(v) => update({ strategyId: v, parameters: {} })}
            options={strategies}
          />
        </Field>
        <TransitionPreviewThumbnail strategyId={cfg.strategyId} />
      </Section>

      <Section title="Inferred">
        <div className="text-micro text-white/60 space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-white/40">Source → Target points</span>
            <span className="font-mono text-white/80">{sourcePoints} → {targetPoints}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-white/40">Current duration</span>
            <span className="font-mono text-white/80">{currentDuration.toFixed(2)}s</span>
          </div>
          {minDuration != null && (
            <div className="flex items-center justify-between">
              <span className="text-white/40">Min for physics</span>
              <span className={`font-mono ${currentDuration < minDuration ? 'text-amber-300' : 'text-white/80'}`}>{minDuration.toFixed(2)}s</span>
            </div>
          )}
        </div>
      </Section>

      <TimingSection
        mode="derived-with-preferred"
        preferredDuration={cfg.preferredDuration}
        minRequiredDuration={minDuration}
        onPreferredChange={(v) => update({ preferredDuration: v })}
        derivedStart={eTime?.start}
        derivedEnd={eTime?.end}
      />
      {needsMoreTime && (
        <div className="px-3 pb-2">
          <button
            className="w-full px-2 py-1 rounded text-micro font-medium bg-amber-500/20 text-amber-300 hover:bg-amber-500/30 border border-amber-500/30 transition-colors"
            onClick={handlePush}
          >
            Push downstream +{pushDelta.toFixed(1)}s
          </button>
        </div>
      )}

      {/* Strategy-specific parameters — same UIs as the old transition inspector. */}
      {cfg.strategyId === 'ant-walk' && (
        <>
          <Section title="Trail Lanes">
            <Field label="Lane Count">
              <NumberInput value={p('laneCount', 2)} onChange={(v) => updateParam('laneCount', Math.max(1, Math.min(8, Math.round(v))))} min={1} max={8} step={1} />
            </Field>
            <Field label="Arc Height">
              <NumberInput value={p('arcHeight', 5)} onChange={(v) => updateParam('arcHeight', v)} min={0} step={1} />
            </Field>
            <Field label="Lane Spread">
              <NumberInput value={p('laneSpread', 8)} onChange={(v) => updateParam('laneSpread', Math.max(0, v))} min={0} step={1} />
            </Field>
            <Field label="Zigzag">
              <NumberInput value={p('zigzag', 0)} onChange={(v) => updateParam('zigzag', Math.max(0, Math.min(3, v)))} min={0} max={3} step={0.1} />
            </Field>
          </Section>
          <Section title="Convoy Motion">
            <Field label="Trail Speed (m/s)">
              <NumberInput value={p('trailSpeed', 6)} onChange={(v) => updateParam('trailSpeed', Math.max(0.5, v))} min={0.5} step={0.5} />
            </Field>
            <Field label="Drone Spacing (m)">
              <NumberInput value={p('spacing', 2)} onChange={(v) => updateParam('spacing', Math.max(0.3, v))} min={0.3} step={0.1} />
            </Field>
          </Section>
          <Section title="Entry / Exit">
            <Field label="Entry Phase">
              <NumberInput value={p('entryPhase', 0.2)} onChange={(v) => updateParam('entryPhase', Math.max(0.05, Math.min(0.4, v)))} min={0.05} max={0.4} step={0.05} />
            </Field>
            <Field label="Exit Phase">
              <NumberInput value={p('exitPhase', 0.2)} onChange={(v) => updateParam('exitPhase', Math.max(0.05, Math.min(0.4, v)))} min={0.05} max={0.4} step={0.05} />
            </Field>
          </Section>
        </>
      )}

      {minDuration != null && minDuration > 0 && (() => {
        const ratio = currentDuration / minDuration
        const tone = ratio < 1 ? 'red' : ratio < 1.5 ? 'amber' : 'emerald'
        const label = ratio < 1
          ? `Exceeds physics budget — needs ≥ ${minDuration.toFixed(1)}s (pushDelta ${(minDuration - currentDuration).toFixed(1)}s)`
          : ratio < 1.5
          ? `Tight — ${currentDuration.toFixed(1)}s vs min ${minDuration.toFixed(1)}s (×${ratio.toFixed(2)})`
          : `Safe — ${currentDuration.toFixed(1)}s vs min ${minDuration.toFixed(1)}s (×${ratio.toFixed(2)})`
        return (
          <div className="px-3 pb-2">
            <div className={`px-2 py-1 rounded text-micro border ${
              tone === 'red' ? 'bg-red-500/15 border-red-500/30 text-red-300'
              : tone === 'amber' ? 'bg-amber-500/15 border-amber-500/30 text-amber-300'
              : 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300'
            }`}>
              {label}
            </div>
          </div>
        )
      })()}

      {cfg.strategyId === 'shortest-path' && mappingStats && (
        <Section title="Mapping stats">
          <div className="text-micro text-white/40 grid grid-cols-3 gap-2">
            <Stat label="Total" value={`${mappingStats.total.toFixed(1)} m`} />
            <Stat label="Avg / drone" value={`${mappingStats.avg.toFixed(2)} m`} />
            <Stat label="Max" value={`${mappingStats.max.toFixed(2)} m`} />
          </div>
          <div className="text-micro text-white/25 mt-1">{mappingStats.count} drones mapped via Hungarian (optimal min-cost assignment).</div>
        </Section>
      )}

      {(cfg.strategyId === 'shortest-path') && (
        <Section title="Stagger (Optional)">
          <Field label="Stagger Amount">
            <NumberInput value={p('staggerAmount', 0)} onChange={(v) => updateParam('staggerAmount', Math.max(0, Math.min(0.95, v)))} min={0} max={0.95} step={0.05} />
          </Field>
          <div className="text-micro text-white/25">0 = all drones move together, higher = sequential wave</div>
        </Section>
      )}

      {cfg.strategyId === 'stagger' && (
        <Section title="Stagger Settings">
          <Field label="Stagger Amount">
            <NumberInput value={p('staggerAmount', 0.5)} onChange={(v) => updateParam('staggerAmount', Math.max(0.05, Math.min(0.95, v)))} min={0.05} max={0.95} step={0.05} />
          </Field>
          <Field label="Mode">
            <SelectInput value={String(cfg.parameters['staggerMode'] ?? 'by-index')} onChange={(v) => updateParam('staggerMode', v)} options={[
              { value: 'by-index', label: 'By Index' },
              { value: 'by-x', label: 'By X Position' },
              { value: 'by-y', label: 'By Y Position' },
              { value: 'by-z', label: 'By Z Position' },
              { value: 'by-distance-from-center', label: 'By Distance from Center' },
              { value: 'random', label: 'Random' },
            ]} />
          </Field>
          <Field label="Stagger Curve">
            <SelectInput value={String(cfg.parameters['staggerCurve'] ?? 'linear')} onChange={(v) => updateParam('staggerCurve', v)} options={[
              { value: 'linear', label: 'Linear' },
              { value: 'ease-in', label: 'Ease In' },
              { value: 'ease-out', label: 'Ease Out' },
              { value: 'ease-in-out', label: 'Ease In-Out' },
            ]} />
          </Field>
        </Section>
      )}

      {cfg.strategyId === 'implosion' && (
        <Section title="Implosion Settings">
          <div className="text-micro text-white/30">Drones converge to focal point then expand to target. No additional parameters needed.</div>
        </Section>
      )}

      {cfg.strategyId === 'color-sweep' && (
        <Section title="Color Sweep Settings">
          <div className="text-micro text-white/30">Color changes propagate during transition. Assign color programs to source and target formations for best effect.</div>
        </Section>
      )}

      {cfg.strategyId === 'spiral' && (
        <Section title="Spiral Settings">
          <Field label="Turns">
            <NumberInput value={p('turns', 1)} onChange={(v) => updateParam('turns', Math.max(0.5, v))} min={0.5} max={5} step={0.5} />
          </Field>
          <Field label="Radius">
            <NumberInput value={p('radius', 5)} onChange={(v) => updateParam('radius', Math.max(0, v))} min={0} step={1} />
          </Field>
          <Field label="Direction">
            <SelectInput value={String(p('direction', 1))} onChange={(v) => updateParam('direction', Number(v))} options={[
              { value: '1', label: 'Clockwise' },
              { value: '-1', label: 'Counter-clockwise' },
            ]} />
          </Field>
        </Section>
      )}

      {cfg.strategyId === 'explosion' && (
        <Section title="Explosion Settings">
          <Field label="Max Radius">
            <NumberInput value={p('maxRadius', 15)} onChange={(v) => updateParam('maxRadius', Math.max(1, v))} min={1} step={1} />
          </Field>
          <Field label="Gravity">
            <NumberInput value={p('gravity', 0.3)} onChange={(v) => updateParam('gravity', Math.max(0, v))} min={0} max={2} step={0.1} />
          </Field>
        </Section>
      )}

      {cfg.strategyId === 'cascade' && (
        <Section title="Cascade Settings">
          <Field label="Speed">
            <NumberInput value={p('propagationSpeed', 1)} onChange={(v) => updateParam('propagationSpeed', Math.max(0.1, v))} min={0.1} max={5} step={0.1} />
          </Field>
          <Field label="Direction X">
            <NumberInput value={p('directionX', 1)} onChange={(v) => updateParam('directionX', v)} step={0.5} />
          </Field>
          <Field label="Direction Y">
            <NumberInput value={p('directionY', 0)} onChange={(v) => updateParam('directionY', v)} step={0.5} />
          </Field>
          <Field label="Direction Z">
            <NumberInput value={p('directionZ', 0)} onChange={(v) => updateParam('directionZ', v)} step={0.5} />
          </Field>
        </Section>
      )}

      {cfg.strategyId === 'morph' && (
        <Section title="Morph Settings">
          <Field label="Arc Height">
            <NumberInput value={p('arcHeight', 3)} onChange={(v) => updateParam('arcHeight', Math.max(0, v))} min={0} step={0.5} />
          </Field>
        </Section>
      )}

      {cfg.strategyId === 'bounce' && (
        <Section title="Bounce Settings">
          <Field label="Damping">
            <NumberInput value={p('damping', 0.5)} onChange={(v) => updateParam('damping', Math.max(0.1, Math.min(2, v)))} min={0.1} max={2} step={0.1} />
          </Field>
        </Section>
      )}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white/5 rounded px-2 py-1">
      <div className="text-[9px] uppercase tracking-wider text-white/30">{label}</div>
      <div className="text-caption text-white/80 font-mono">{value}</div>
    </div>
  )
}

function TransitionPreviewThumbnail({ strategyId }: { strategyId: string }) {
  const w = 120, h = 40, pad = 8
  const steps = 5

  const dots = useMemo(() => {
    const result: { sx: number; sy: number; tx: number; ty: number }[] = []
    for (let i = 0; i < steps; i++) {
      const t = i / (steps - 1)
      result.push({
        sx: pad + t * (w / 2 - pad * 2),
        sy: pad + (i % 2 === 0 ? 0 : h - 2 * pad),
        tx: w / 2 + pad + t * (w / 2 - pad * 2),
        ty: pad + (steps - 1 - i) % 2 === 0 ? 0 : h - 2 * pad,
      })
    }
    return result
  }, [])

  const getPathMidY = (i: number) => {
    switch (strategyId) {
      case 'spiral': return Math.sin(i * 1.5) * 8
      case 'explosion': return -Math.abs(i - 2) * 6
      case 'implosion': return Math.abs(i - 2) * 6
      case 'morph': return Math.sin(Math.PI * 0.5) * 8
      case 'bounce': return Math.sin(i * 2) * 5
      case 'cascade': return i * 3
      default: return 0
    }
  }

  return (
    <svg width={w} height={h} className="w-full bg-white/5 rounded border border-white/10 my-1">
      {dots.map((d, i) => {
        const midX = (d.sx + d.tx) / 2
        const midY = h / 2 + getPathMidY(i)
        return (
          <g key={i}>
            <path d={`M${d.sx},${d.sy} Q${midX},${midY} ${d.tx},${d.ty}`}
              fill="none" stroke="#a78bfa" strokeWidth={1} strokeDasharray="2,2" opacity={0.5} />
            <circle cx={d.sx} cy={d.sy} r={2.5} fill="#3b82f6" />
            <circle cx={d.tx} cy={d.ty} r={2.5} fill="#22c55e" />
          </g>
        )
      })}
      <text x={w / 2} y={h - 2} textAnchor="middle" fill="white" fillOpacity={0.3} fontSize={7}>
        {strategyId}
      </text>
    </svg>
  )
}
