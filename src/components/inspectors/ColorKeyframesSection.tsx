// ============================================================================
// Bundle 4: Color Keyframes section — list / add / remove / scrub keyframes
// ============================================================================

import { useGraphStore } from '../../stores/graphStore'
import { useHistoryStore } from '../../stores/historyStore'
import { usePlayheadStore } from '../../stores/playheadStore'
import { getAllColorPrograms, getColorProgram, evaluateColorProgram } from '../../graph/colorPrograms'
import type { FormationNodeData, ColorProgramKeyframe } from '../../graph/types'
import { Field, NumberInput, SelectInput, Section } from './shared'
import { EasingSelect } from './EasingSelect'
import type { EasingType } from '../../graph/easing'

function swatch(programId: string): string {
  const prog = getColorProgram(programId)
  if (!prog) return '#666'
  const c = evaluateColorProgram(prog, 0, 1, { x: 0, y: 0, z: 0 }, 0)
  const r = Math.round(Math.max(0, Math.min(1, c.r)) * 255)
  const g = Math.round(Math.max(0, Math.min(1, c.g)) * 255)
  const b = Math.round(Math.max(0, Math.min(1, c.b)) * 255)
  return '#' + [r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('')
}

export function ColorKeyframesSection({ nodeId, data }: { nodeId: string; data: FormationNodeData }) {
  const updateNodeData = useGraphStore((s) => s.updateNodeData)
  const snapshot = useHistoryStore((s) => s.snapshot)
  const currentTime = usePlayheadStore((s) => s.currentTime)
  const programs = getAllColorPrograms()

  const keyframes = data.colorKeyframes ?? []

  const setKfs = (next: ColorProgramKeyframe[], label = 'Edit Color Keyframe') => {
    snapshot(label)
    updateNodeData(nodeId, { colorKeyframes: next } as Partial<FormationNodeData>)
  }

  const localTime = Math.max(0, Math.min(data.duration, currentTime - data.startTime))

  return (
    <Section title={`Color Keyframes (${keyframes.length})`}>
      {keyframes.map((kf, idx) => (
        <div key={kf.id ?? `${kf.time}-${idx}`} className="bg-accent-transition/10 rounded px-2 py-1.5 space-y-1 mb-1">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1">
              <span className="w-3 h-3 rounded-full border border-white/20" style={{ background: swatch(kf.colorProgramId) }} />
              <span className="text-micro font-semibold text-fuchsia-300">CKF {idx + 1}</span>
            </div>
            <button
              className="text-red-400 hover:text-red-300 text-micro px-1"
              onClick={() => setKfs(keyframes.filter((_, i) => i !== idx), 'Remove color keyframe')}
            >
              ✕
            </button>
          </div>
          <Field label="Time">
            <NumberInput
              value={kf.time}
              min={0}
              max={data.duration}
              step={0.1}
              onChange={(v) => setKfs(keyframes.map((k, i) => (i === idx ? { ...k, time: Math.max(0, Math.min(v, data.duration)) } : k)), 'Set color keyframe time')}
            />
          </Field>
          <Field label="Program">
            <SelectInput
              value={kf.colorProgramId}
              onChange={(v) => setKfs(keyframes.map((k, i) => (i === idx ? { ...k, colorProgramId: v } : k)), 'Set color keyframe program')}
              options={programs.map((p) => ({ value: p.id, label: p.name }))}
            />
          </Field>
          <Field label="Easing">
            <EasingSelect
              value={kf.easing ?? 'linear'}
              onChange={(v) => setKfs(keyframes.map((k, i) => (i === idx ? { ...k, easing: v as EasingType } : k)), 'Set color keyframe easing')}
              bezierConfig={kf.bezierConfig}
              onBezierConfigChange={(cfg) => setKfs(keyframes.map((k, i) => (i === idx ? { ...k, bezierConfig: cfg } : k)), 'Set color keyframe Bézier')}
            />
          </Field>
        </div>
      ))}
      <button
        className="w-full px-2 py-1 text-xs text-fuchsia-400 hover:text-fuchsia-300 bg-accent-transition/10 hover:bg-accent-transition/20 rounded transition-colors"
        onClick={() => {
          const firstProg = data.colorProgramId ?? programs[0]?.id
          if (!firstProg) return
          setKfs([
            ...keyframes,
            { id: `ckf-${Date.now()}`, time: localTime, colorProgramId: firstProg, easing: 'linear' },
          ], 'Add color keyframe')
        }}
      >
        + Add at playhead (t={localTime.toFixed(2)}s)
      </button>
    </Section>
  )
}
