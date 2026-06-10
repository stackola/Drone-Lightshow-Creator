import { useState } from 'react'
import { useGraphStore } from '../../stores/graphStore'
import { useHistoryStore } from '../../stores/historyStore'
import { useFormationStore } from '../../stores/formationStore'
import { buildSymmetryPairs } from '../../graph/symmetry'
import { getAllGenerators } from '../../registries/generators'
import type { FormationNodeData, IdleBehavior, IdleInherit } from '../../graph/types'
import { DEFAULT_IDLE_INHERIT } from '../../graph/types'
import type { EasingType } from '../../graph/easing'
import { getAllIdleBehaviors } from '../../registries/idleBehaviors'
import { RegistryItemPreview } from '../RegistryItemPreview'
import { getAllColorPrograms } from '../../graph/colorPrograms'
import type { PlaybackMode } from '../../graph/animatedFormation'
import { InspectorHeader, LockedBanner, Section, Field, NumberInput, SelectInput, VectorInput } from './shared'
import { TimingSection } from './TimingSection'
import { computeAllTiming } from '../../graph/timing'
import { EasingSelect } from './EasingSelect'
import { KeyframeCurveEditor } from '../KeyframeCurveEditor'
import { ColorProgramEditor } from './ColorProgramEditor'
import { ColorKeyframesSection } from './ColorKeyframesSection'
import { ColorOverridesSection } from './ColorOverridesSection'
import { applyJitter, mirrorFormation, applyDensityFalloff, scaleToFit } from '../../graph/formationTools'
import { usePointEditorStore } from '../viewport/PointEditor'
import { Crosshair } from 'lucide-react'
import { registerColorProgram } from '../../graph/colorPrograms'
import { AnnotationsSection } from './AnnotationsSection'

export function FormationNodeInspector({ nodeId }: { nodeId: string }) {
  const node = useGraphStore((s) => s.nodes.find((n) => n.id === nodeId))
  const nodes = useGraphStore((s) => s.nodes)
  const edges = useGraphStore((s) => s.edges)
  const updateNodeData = useGraphStore((s) => s.updateNodeData)
  const addAttachedIdle = useGraphStore((s) => s.addAttachedIdle)
  const updateAttachedIdle = useGraphStore((s) => s.updateAttachedIdle)
  const removeAttachedIdle = useGraphStore((s) => s.removeAttachedIdle)
  const addKeyframe = useGraphStore((s) => s.addKeyframe)
  const updateKeyframe = useGraphStore((s) => s.updateKeyframe)
  const removeKeyframe = useGraphStore((s) => s.removeKeyframe)
  const snapshot = useHistoryStore((s) => s.snapshot)
  const formations = useFormationStore((s) => s.formations)
  const updateFormation = useFormationStore((s) => s.updateFormation)
  const regeneratePoints = useFormationStore((s) => s.regeneratePoints)
  const getPoints = useFormationStore((s) => s.getPoints)

  if (!node || node.type !== 'formation') return null
  const data = node.data as FormationNodeData

  const update = (patch: Partial<FormationNodeData>) => {
    snapshot("Edit Formation")
    updateNodeData(nodeId, patch as Partial<FormationNodeData>)
  }

  // Drone count summary
  const incomingEdges = edges.filter((e) => e.edgeType === 'flow' && e.target === nodeId)
  const outgoingEdges = edges.filter((e) => e.edgeType === 'flow' && e.source === nodeId)
  const incomingDrones = incomingEdges.reduce((sum, e) => sum + e.droneCount, 0)
  const outgoingDrones = outgoingEdges.reduce((sum, e) => sum + e.droneCount, 0)
  const idleAllocation = data.idleConfigs.length > 0 ? '(auto)' : 0

  // Formation definition (inline editing)
  const formation = formations.find((f) => f.id === data.formationId)
  const formationPoints = formation?.pointCount ?? 0
  const generators = getAllGenerators()
  const generatorOptions = generators.map((g) => ({ value: g.id, label: g.name }))
  const points = data.formationId ? getPoints(data.formationId) : undefined

  const getAnimatedDef = useFormationStore((s) => s.getAnimatedDef)
  const updateAnimatedDef = useFormationStore((s) => s.updateAnimatedDef)

  const animatedDef = data.formationId ? getAnimatedDef(data.formationId) : undefined
  const isAnimated = formation?.type === 'animated' && !!animatedDef

  const formationOptions = [
    { value: '', label: '(none)' },
    ...formations.map((f) => ({ value: f.id, label: f.name })),
  ]

  const idleBehaviors = getAllIdleBehaviors().map((b) => ({ value: b.id, label: b.name }))

  const handleAddIdle = () => {
    snapshot("Add attached idle")
    addAttachedIdle(nodeId, {
      behavior: 'hover' as IdleBehavior,
      radius: 5,
      speed: 1,
      altitude: 10,
      colorProgramId: null,
      inherit: { ...DEFAULT_IDLE_INHERIT },
    })
  }

  return (
    <div className="h-full flex flex-col">
      <InspectorHeader title={formation ? `Formation · ${formation.name}` : 'Formation Node'} />
      {data.locked && <LockedBanner onUnlock={() => { snapshot('Unlock Formation'); updateNodeData(nodeId, { locked: false } as Partial<FormationNodeData>) }} />}
      <div className={`flex-1 overflow-y-auto ${data.locked ? 'pointer-events-none opacity-60' : ''}`}>
      <Section title="Formation">
        <Field label="Shape">
          <SelectInput
            value={data.formationId ?? ''}
            onChange={(v) => update({ formationId: v || null })}
            options={formationOptions}
          />
        </Field>
        {formation && (
          <>
            <Field label="Name">
              <input
                type="text"
                value={formation.name}
                onChange={(e) => updateFormation(formation.id, { name: e.target.value })}
                className="w-full bg-surface-hover border border-white/10 rounded px-2 py-0.5 text-xs text-white/80 outline-none focus:border-cyan-500/50"
              />
            </Field>
            <Field label="Generator">
              <div className="flex items-center gap-2 w-full">
                <SelectInput
                  value={formation.generatorId}
                  onChange={(v) => {
                    const gen = generators.find((g) => g.id === v)
                    if (gen) {
                      updateFormation(formation.id, { generatorId: v, parameters: { ...gen.defaultParams } })
                      regeneratePoints(formation.id)
                    }
                  }}
                  options={generatorOptions}
                />
                {/* L1 live preview — small thumbnail of the generator's output with current params. */}
                <RegistryItemPreview kind="generator" id={formation.generatorId} params={formation.parameters} size={36} />
              </div>
            </Field>
            {Object.entries(formation.parameters).map(([key, val]) => (
              <Field key={key} label={key}>
                <NumberInput
                  value={val}
                  onChange={(v) => {
                    updateFormation(formation.id, {
                      parameters: { ...formation.parameters, [key]: v },
                    })
                    regeneratePoints(formation.id)
                  }}
                  step={key === 'spacing' ? 0.5 : 1}
                  min={1}
                />
              </Field>
            ))}
            <div className="text-micro text-white/30">
              {points?.length ?? formationPoints} points generated
            </div>
          </>
        )}
      </Section>
      {isAnimated && animatedDef && (
        <Section title="Animation Playback">
          <div className="text-micro text-white/30 mb-1">
            Anim duration: {animatedDef.duration.toFixed(1)}s &middot; {animatedDef.droneCount} drones
          </div>
          <Field label="Mode">
            <SelectInput
              value={animatedDef.playback.mode}
              onChange={(v) => {
                snapshot("Set animation mode")
                updateAnimatedDef(data.formationId!, {
                  ...animatedDef,
                  playback: { ...animatedDef.playback, mode: v as PlaybackMode },
                })
              }}
              options={[
                { value: 'clamp', label: 'Clamp (play once)' },
                { value: 'loop', label: 'Loop' },
                { value: 'boomerang', label: 'Boomerang' },
              ]}
            />
          </Field>
          <Field label="Speed">
            <NumberInput
              value={animatedDef.playback.speed}
              onChange={(v) => {
                snapshot("Set animation speed")
                updateAnimatedDef(data.formationId!, {
                  ...animatedDef,
                  playback: { ...animatedDef.playback, speed: Math.max(0.1, v) },
                })
              }}
              min={0.1}
              max={5}
              step={0.1}
            />
          </Field>
          <Field label="Trim In">
            <NumberInput
              value={animatedDef.playback.trimIn}
              onChange={(v) => {
                snapshot("Set animation trim in")
                updateAnimatedDef(data.formationId!, {
                  ...animatedDef,
                  playback: { ...animatedDef.playback, trimIn: Math.max(0, v) },
                })
              }}
              min={0}
              max={animatedDef.duration}
              step={0.1}
            />
          </Field>
          <Field label="Trim Out">
            <NumberInput
              value={animatedDef.playback.trimOut}
              onChange={(v) => {
                snapshot("Set animation trim out")
                updateAnimatedDef(data.formationId!, {
                  ...animatedDef,
                  playback: { ...animatedDef.playback, trimOut: Math.max(0, v) },
                })
              }}
              min={0}
              max={animatedDef.duration}
              step={0.1}
            />
          </Field>
          {animatedDef.playback.trimIn + animatedDef.playback.trimOut > 0 && (
            <div className="text-micro text-white/30">
              Effective range: {animatedDef.playback.trimIn.toFixed(1)}s – {(animatedDef.duration - animatedDef.playback.trimOut).toFixed(1)}s
            </div>
          )}
        </Section>
      )}
      {(() => {
        const range = computeAllTiming({ nodes, edges }).get(nodeId)
        return (
          <TimingSection
            mode="authored"
            startTime={data.startTime}
            duration={data.duration}
            onStartTimeChange={(v) => update({ startTime: v })}
            onDurationChange={(v) => update({ duration: v })}
            derivedStart={range?.start}
            derivedEnd={range?.end}
          />
        )
      })()}
      <Section title="Color Program">
        <ColorProgramSection nodeId={nodeId} data={data} />
      </Section>
      <ColorKeyframesSection nodeId={nodeId} data={data} />
      <ColorOverridesSection nodeId={nodeId} data={data} />
      <Section title="Base Transform (t=0)">
        <Field label="Position">
          <VectorInput
            value={data.transform.position}
            onChange={(v) => update({ transform: { ...data.transform, position: v } })}
            step={1}
            unit="m"
          />
        </Field>
        <Field label="Rotation">
          <VectorInput
            value={{
              x: +(data.transform.rotation.x * 180 / Math.PI).toFixed(1),
              y: +(data.transform.rotation.y * 180 / Math.PI).toFixed(1),
              z: +(data.transform.rotation.z * 180 / Math.PI).toFixed(1),
            }}
            onChange={(v) => update({ transform: { ...data.transform, rotation: { x: v.x * Math.PI / 180, y: v.y * Math.PI / 180, z: v.z * Math.PI / 180 } } })}
            step={5}
            unit="°"
          />
        </Field>
        <Field label="Scale">
          <NumberInput value={data.transform.scale.x} onChange={(v) => {
            const s = Math.max(0.01, v)
            update({ transform: { ...data.transform, scale: { x: s, y: s, z: s } } })
          }} min={0.01} step={0.1} />
        </Field>
      </Section>
      <Section title={`Keyframes (${data.keyframes.length})`}>
        {data.keyframes.map((kf, idx) => (
          <div key={kf.id ?? `kf-${kf.time}-${idx}`} className="bg-cyan-500/10 rounded px-2 py-1.5 text-xs text-white/60 space-y-1.5 mb-1">
            <div className="flex items-center justify-between">
              <span className="text-micro font-semibold text-cyan-400">KF {idx + 1}</span>
              <button
                className="text-red-400 hover:text-red-300 text-micro px-1"
                onClick={() => { snapshot("Remove keyframe"); removeKeyframe(nodeId, idx) }}
              >
                ✕
              </button>
            </div>
            <div className="grid grid-cols-2 gap-1">
              <Field label="Time">
                <NumberInput value={kf.time} onChange={(v) => { snapshot("Set keyframe time"); updateKeyframe(nodeId, idx, { time: Math.max(0, Math.min(v, data.duration)) }) }} min={0} max={data.duration} step={0.5} />
              </Field>
              <Field label="Easing">
                <EasingSelect
                  value={kf.easing}
                  onChange={(v) => { snapshot("Set keyframe easing"); updateKeyframe(nodeId, idx, { easing: v as EasingType }) }}
                  bezierConfig={kf.bezierConfig}
                  onBezierConfigChange={(cfg) => { snapshot("Edit Bézier"); updateKeyframe(nodeId, idx, { bezierConfig: cfg }) }}
                />
              </Field>
            </div>
            <Field label="Position">
              <VectorInput
                value={kf.transform.position}
                onChange={(v) => { snapshot('Set keyframe position'); updateKeyframe(nodeId, idx, { transform: { ...kf.transform, position: v } }) }}
                step={1}
                unit="m"
              />
            </Field>
            <Field label="Rotation">
              <VectorInput
                value={{
                  x: +(kf.transform.rotation.x * 180 / Math.PI).toFixed(1),
                  y: +(kf.transform.rotation.y * 180 / Math.PI).toFixed(1),
                  z: +(kf.transform.rotation.z * 180 / Math.PI).toFixed(1),
                }}
                onChange={(v) => { snapshot('Set keyframe rotation'); updateKeyframe(nodeId, idx, { transform: { ...kf.transform, rotation: { x: v.x * Math.PI / 180, y: v.y * Math.PI / 180, z: v.z * Math.PI / 180 } } }) }}
                step={5}
                unit="°"
              />
            </Field>
            <Field label="Scale">
              <NumberInput value={kf.transform.scale.x} onChange={(v) => {
                const s = Math.max(0.01, v)
                snapshot("Set keyframe scale")
                updateKeyframe(nodeId, idx, { transform: { ...kf.transform, scale: { x: s, y: s, z: s } } })
              }} min={0.01} step={0.1} />
            </Field>
          </div>
        ))}
        <button
          className="w-full mt-1 px-2 py-1 text-xs text-cyan-400 hover:text-cyan-300 bg-cyan-500/10 hover:bg-cyan-500/20 rounded transition-colors"
          onClick={() => {
            snapshot("Add keyframe")
            addKeyframe(nodeId, data.duration, { ...data.transform }, 'ease-in-out')
          }}
        >
          + Add Keyframe
        </button>
        {/* S19: Keyframe Curve Editor */}
        {data.keyframes.length > 0 && <KeyframeCurveEditor nodeId={nodeId} />}
      </Section>
      {/* Bundle 3: Live Symmetry */}
      {formation && data.formationId && (
        <Section title="Symmetry (live mirror)">
          {(['x', 'y', 'z'] as const).map((axis) => {
            const active = data.symmetry?.axis === axis
            return (
              <button
                key={axis}
                className={`px-2 py-0.5 mr-1 text-micro rounded transition-colors ${
                  active ? 'bg-violet-500/30 text-violet-200' : 'bg-white/5 hover:bg-white/10 text-white/50'
                }`}
                onClick={() => {
                  snapshot("Toggle symmetry")
                  if (active) {
                    update({ symmetry: null })
                  } else {
                    const pts = getPoints(data.formationId!) ?? []
                    const pairs = buildSymmetryPairs(pts, axis, { x: 0, y: 0, z: 0 }, 0.05)
                    update({ symmetry: { axis, plane: { x: 0, y: 0, z: 0 }, pairs, epsilon: 0.05 } })
                  }
                }}
              >
                {active ? '✓ ' : ''}Mirror {axis.toUpperCase()}
              </button>
            )
          })}
          {data.symmetry && (
            <div className="text-micro text-white/30 mt-1">
              {data.symmetry.pairs.length} pair groups · edits propagate automatically
            </div>
          )}
        </Section>
      )}
      {/* S13-05/06/07/08: Formation Tools */}
      {formation && data.formationId && (
        <Section title="Formation Tools">
          {/* Item 5 (2026-05-22): toggle point-edit mode. When active, the
              3D viewport renders a PivotControls at the selection centroid
              and clicking drones selects them (shift-click adds). */}
          <PointEditToggle formationId={data.formationId} />
          <div className="flex gap-1 flex-wrap mt-1">
            <button className="px-2 py-0.5 text-micro bg-white/5 hover:bg-white/10 rounded transition-colors text-white/50"
              onClick={() => { snapshot("Jitter points"); const pts = getPoints(data.formationId!); if (pts) { useFormationStore.setState((s: { generatedPoints: Map<string, import('../../graph/types').Vec3[]> }) => { s.generatedPoints.set(data.formationId!, applyJitter(pts, 0.5)) }) } }}>
              Jitter
            </button>
            <button className="px-2 py-0.5 text-micro bg-white/5 hover:bg-white/10 rounded transition-colors text-white/50"
              onClick={() => { snapshot("Mirror X"); const pts = getPoints(data.formationId!); if (pts) { useFormationStore.setState((s: { generatedPoints: Map<string, import('../../graph/types').Vec3[]>; formations: { id: string; pointCount: number }[] }) => { const mirrored = mirrorFormation(pts, 'x'); s.generatedPoints.set(data.formationId!, mirrored); const f = s.formations.find((f: { id: string }) => f.id === data.formationId); if (f) f.pointCount = mirrored.length }) } }}>
              Mirror X
            </button>
            <button className="px-2 py-0.5 text-micro bg-white/5 hover:bg-white/10 rounded transition-colors text-white/50"
              onClick={() => { snapshot("Mirror Z"); const pts = getPoints(data.formationId!); if (pts) { useFormationStore.setState((s: { generatedPoints: Map<string, import('../../graph/types').Vec3[]>; formations: { id: string; pointCount: number }[] }) => { const mirrored = mirrorFormation(pts, 'z'); s.generatedPoints.set(data.formationId!, mirrored); const f = s.formations.find((f: { id: string }) => f.id === data.formationId); if (f) f.pointCount = mirrored.length }) } }}>
              Mirror Z
            </button>
            <button className="px-2 py-0.5 text-micro bg-white/5 hover:bg-white/10 rounded transition-colors text-white/50"
              onClick={() => { snapshot("Densify Center"); const pts = getPoints(data.formationId!); if (pts) { const dense = applyDensityFalloff(pts, Math.floor(pts.length * 0.7), 'center-dense'); useFormationStore.setState((s: { generatedPoints: Map<string, import('../../graph/types').Vec3[]>; formations: { id: string; pointCount: number }[] }) => { s.generatedPoints.set(data.formationId!, dense); const f = s.formations.find((f: { id: string }) => f.id === data.formationId); if (f) f.pointCount = dense.length }) } }}>
              Densify Center
            </button>
            <button className="px-2 py-0.5 text-micro bg-white/5 hover:bg-white/10 rounded transition-colors text-white/50"
              onClick={() => { snapshot("Scale to Fit"); const pts = getPoints(data.formationId!); if (pts) { const scaled = scaleToFit(pts, pts.length, 1.5); useFormationStore.setState((s: { generatedPoints: Map<string, import('../../graph/types').Vec3[]> }) => { s.generatedPoints.set(data.formationId!, scaled) }) } }}>
              Scale to Fit
            </button>
          </div>
        </Section>
      )}
      <Section title="Attached Idle">
        {data.idleConfigs.map((ic) => {
          const inh = ic.inherit ?? DEFAULT_IDLE_INHERIT
          const toggleInherit = (key: keyof IdleInherit) => {
            snapshot("Toggle idle inherit")
            updateAttachedIdle(nodeId, ic.id, { inherit: { ...inh, [key]: !inh[key] } })
          }
          return (
            <div key={ic.id} className="bg-amber-500/10 rounded px-2 py-1.5 text-xs text-white/60 space-y-1.5 mb-1">
              <div className="flex items-center justify-between gap-2">
                <SelectInput
                  value={ic.behavior}
                  onChange={(v) => { snapshot("Set idle behavior"); updateAttachedIdle(nodeId, ic.id, { behavior: v as IdleBehavior }) }}
                  options={idleBehaviors}
                />
                {/* L1 live preview — small animated thumbnail of the idle behavior. */}
                <RegistryItemPreview kind="idle" id={ic.behavior} params={{ radius: ic.radius, speed: ic.speed, altitude: ic.altitude }} size={28} />
                <button
                  className="ml-1 text-red-400 hover:text-red-300 text-micro px-1"
                  onClick={() => { snapshot("Remove attached idle"); removeAttachedIdle(nodeId, ic.id) }}
                >
                  ✕
                </button>
              </div>
              {/* S10-18: Color program picker on idle config */}
              <SelectInput
                value={ic.colorProgramId ?? ''}
                onChange={(v) => { snapshot("Set idle color program"); updateAttachedIdle(nodeId, ic.id, { colorProgramId: v || null }) }}
                options={[{ value: '', label: '(default color)' }, ...getAllColorPrograms().map((p) => ({ value: p.id, label: p.name }))]}
              />
              <div className="text-micro text-white/40 font-semibold mt-1">Inherit from keyframes:</div>
              <div className="grid grid-cols-3 gap-x-2 gap-y-0.5 text-micro">
                {(['translate', 'rotate', 'scale'] as const).map((group) => (
                  ['X', 'Y', 'Z'].map((axis) => {
                    const key = `${group}${axis}` as keyof IdleInherit
                    return (
                      <label key={key} className="flex items-center gap-1 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={inh[key]}
                          onChange={() => toggleInherit(key)}
                          className="w-3 h-3 rounded border-white/20 bg-surface-hover accent-amber-400"
                        />
                        <span className="text-white/50">{group[0]!.toUpperCase()}{group.slice(1)} {axis}</span>
                      </label>
                    )
                  })
                ))}
              </div>
            </div>
          )
        })}
        <button
          className="w-full mt-1 px-2 py-1 text-xs text-amber-400 hover:text-amber-300 bg-amber-500/10 hover:bg-amber-500/20 rounded transition-colors"
          onClick={handleAddIdle}
        >
          + Add Idle Config
        </button>
      </Section>
      <Section title="Drone Flow Summary">
        <div className="space-y-0.5 text-xs text-white/50">
          <div className="flex justify-between"><span>Incoming:</span><span className="text-white/70">{incomingDrones}</span></div>
          <div className="flex justify-between"><span>Formation pts:</span><span className="text-white/70">{formationPoints}</span></div>
          <div className="flex justify-between"><span>Idle alloc:</span><span className="text-white/70">{idleAllocation}</span></div>
          <div className="flex justify-between"><span>Outgoing:</span><span className="text-white/70">{outgoingDrones}</span></div>
        </div>
      </Section>
      <AnnotationsSection nodeId={nodeId} data={data} />
      <Section title="Info">
        <div className="text-xs text-white/40">
          End: {(data.startTime + data.duration).toFixed(1)}s
        </div>
        <div className="text-xs text-white/40">
          Keyframes: {data.keyframes.length}
        </div>
      </Section>
      </div>
    </div>
  )
}

/** Item 5 (2026-05-22) — toggle point-edit mode for this formation. Reads the
 *  singleton pointEditorStore so the 3D viewport's `<PointEditorGizmo />` can
 *  observe the same state. */
function PointEditToggle({ formationId }: { formationId: string }) {
  const isActive = usePointEditorStore((s) => s.isActive)
  const activeFor = usePointEditorStore((s) => s.formationId)
  const selectedCount = usePointEditorStore((s) => s.selectedIndices.size)
  const enterEditMode = usePointEditorStore((s) => s.enterEditMode)
  const exitEditMode = usePointEditorStore((s) => s.exitEditMode)
  const clearSelection = usePointEditorStore((s) => s.clearSelection)
  const active = isActive && activeFor === formationId
  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={() => (active ? exitEditMode() : enterEditMode(formationId))}
        className={`flex-1 px-2 py-1 text-micro rounded transition-colors inline-flex items-center justify-center gap-1 ${
          active
            ? 'bg-cyan-500/30 text-cyan-200 border border-cyan-400/40'
            : 'bg-white/5 hover:bg-white/10 text-white/60 border border-transparent'
        }`}
        title="Point-edit mode — click drones in 3D to select; drag the gizmo to move; Esc to exit"
      >
        <Crosshair size={11} aria-hidden="true" />
        {active ? `Point Edit · ${selectedCount} selected` : 'Edit Points'}
      </button>
      {active && selectedCount > 0 && (
        <button
          type="button"
          onClick={() => clearSelection()}
          className="px-1.5 py-1 text-micro rounded bg-white/5 hover:bg-white/10 text-white/60"
          title="Clear point selection"
        >
          Clear
        </button>
      )}
    </div>
  )
}

/** Bundle 4: program picker + inline editor (replaces basic creator). */
function ColorProgramSection({ nodeId, data }: { nodeId: string; data: FormationNodeData }) {
  const updateNodeData = useGraphStore((s) => s.updateNodeData)
  const snapshot = useHistoryStore((s) => s.snapshot)
  const [editing, setEditing] = useState(false)
  return (
    <>
      <Field label="Program">
        <SelectInput
          value={data.colorProgramId ?? ''}
          onChange={(v) => { snapshot("Set color program"); updateNodeData(nodeId, { colorProgramId: v || null } as Partial<FormationNodeData>) }}
          options={[
            { value: '', label: '(default)' },
            ...getAllColorPrograms().map((p) => ({ value: p.id, label: p.name })),
          ]}
        />
      </Field>
      <div className="flex gap-1">
        <button
          onClick={() => setEditing((e) => !e)}
          className="flex-1 px-2 py-0.5 text-micro text-cyan-400 hover:text-cyan-300 bg-cyan-500/10 hover:bg-cyan-500/20 rounded transition-colors"
        >
          {editing ? 'Hide editor' : (data.colorProgramId ? 'Edit / Replace' : '+ Create custom')}
        </button>
      </div>
      {editing && (
        <ColorProgramEditor
          initialProgramId={data.colorProgramId ?? undefined}
          onSaved={(id) => { snapshot("Save color program"); updateNodeData(nodeId, { colorProgramId: id } as Partial<FormationNodeData>); setEditing(false) }}
          onCancel={() => setEditing(false)}
        />
      )}
    </>
  )
}

// S10-17: Legacy inline color program creator (kept temporarily to preserve API surface area)
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function ColorProgramCreator({ onCreated }: { onCreated: (id: string) => void }) {
  const [isOpen, setIsOpen] = useState(false)
  const [name, setName] = useState('Custom Color')
  const [type, setType] = useState<'solid' | 'gradient' | 'rainbow' | 'pulse'>('solid')
  const [r, setR] = useState(1)
  const [g, setG] = useState(1)
  const [b, setB] = useState(1)
  const [r2, setR2] = useState(0)
  const [g2, setG2] = useState(0)
  const [b2, setB2] = useState(1)
  const [axis, setAxis] = useState<'x' | 'y' | 'z'>('y')
  const [freq, setFreq] = useState(1)

  if (!isOpen) {
    return (
      <button onClick={() => setIsOpen(true)}
        className="w-full mt-1 px-2 py-0.5 text-micro text-cyan-400 hover:text-cyan-300 bg-cyan-500/10 hover:bg-cyan-500/20 rounded transition-colors">
        + Create Custom Color
      </button>
    )
  }

  const handleCreate = () => {
    const id = `custom-${Date.now()}`
    let program: Parameters<typeof registerColorProgram>[0]
    switch (type) {
      case 'solid':
        program = { id, name, type: 'solid', color: { r, g, b } }
        break
      case 'gradient':
        program = { id, name, type: 'gradient', colorStart: { r, g, b }, colorEnd: { r: r2, g: g2, b: b2 }, axis }
        break
      case 'rainbow':
        program = { id, name, type: 'rainbow', mode: 'spatial', axis, saturation: 1, brightness: 1, speed: 0.2 }
        break
      case 'pulse':
        program = { id, name, type: 'pulse', color: { r, g, b }, frequency: freq, amplitude: 0.8, minBrightness: 0.2 }
        break
    }
    registerColorProgram(program)
    onCreated(id)
    setIsOpen(false)
  }

  return (
    <div className="mt-1 p-2 bg-white/5 rounded border border-white/10 space-y-1.5">
      <Field label="Name">
        <input type="text" value={name} onChange={(e) => setName(e.target.value)}
          className="w-full bg-surface-hover border border-white/10 rounded px-2 py-0.5 text-xs text-white/80 outline-none" />
      </Field>
      <Field label="Type">
        <SelectInput value={type} onChange={(v) => setType(v as typeof type)} options={[
          { value: 'solid', label: 'Solid Color' },
          { value: 'gradient', label: 'Gradient' },
          { value: 'rainbow', label: 'Rainbow' },
          { value: 'pulse', label: 'Pulse' },
        ]} />
      </Field>
      {(type === 'solid' || type === 'gradient' || type === 'pulse') && (
        <Field label="Color (R/G/B)">
          <div className="flex gap-1">
            <NumberInput value={r} onChange={setR} min={0} max={1} step={0.1} />
            <NumberInput value={g} onChange={setG} min={0} max={1} step={0.1} />
            <NumberInput value={b} onChange={setB} min={0} max={1} step={0.1} />
          </div>
        </Field>
      )}
      {type === 'gradient' && (
        <Field label="End Color">
          <div className="flex gap-1">
            <NumberInput value={r2} onChange={setR2} min={0} max={1} step={0.1} />
            <NumberInput value={g2} onChange={setG2} min={0} max={1} step={0.1} />
            <NumberInput value={b2} onChange={setB2} min={0} max={1} step={0.1} />
          </div>
        </Field>
      )}
      {(type === 'gradient' || type === 'rainbow') && (
        <Field label="Axis">
          <SelectInput value={axis} onChange={(v) => setAxis(v as 'x' | 'y' | 'z')} options={[
            { value: 'x', label: 'X' }, { value: 'y', label: 'Y' }, { value: 'z', label: 'Z' },
          ]} />
        </Field>
      )}
      {type === 'pulse' && (
        <Field label="Frequency">
          <NumberInput value={freq} onChange={setFreq} min={0.1} max={10} step={0.1} />
        </Field>
      )}
      <div className="flex gap-1 mt-1">
        <button onClick={handleCreate}
          className="flex-1 px-2 py-1 text-micro text-cyan-400 bg-cyan-500/10 hover:bg-cyan-500/20 rounded transition-colors">
          Create
        </button>
        <button onClick={() => setIsOpen(false)}
          className="px-2 py-1 text-micro text-white/40 hover:text-white/60 bg-white/5 rounded transition-colors">
          Cancel
        </button>
      </div>
    </div>
  )
}
