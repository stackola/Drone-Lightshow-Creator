// ============================================================================
// Slice 2: Shared <TimingSection> for all node inspectors.
//
// Three modes:
//   - 'authored'              Launch / Formation / Idle: Start + Duration are stored fields.
//   - 'derived'               Land: start and end are derived from upstream + stagger.
//   - 'derived-with-preferred' Transition: Preferred is stored; Min / Effective are derived.
//
// Fixed labels — no more "Start" vs "Start Time" drift, no dead Duration fields on transitions.
// ============================================================================

import { Section, Field, NumberInput, DerivedValue, formatSeconds } from './shared'

type TimingMode = 'authored' | 'derived' | 'derived-with-preferred'

export interface TimingSectionProps {
  mode: TimingMode

  // Always available — the resolved time range after the solver runs.
  derivedStart?: number
  derivedEnd?: number

  // mode === 'authored'
  startTime?: number
  duration?: number
  onStartTimeChange?: (v: number) => void
  onDurationChange?: (v: number) => void

  // mode === 'derived-with-preferred' (Transition)
  preferredDuration?: number
  minRequiredDuration?: number | null
  onPreferredChange?: (v: number) => void

  // Optional secondary authored field — typically "Stagger".
  staggerLabel?: string
  staggerValue?: number
  staggerStep?: number
  onStaggerChange?: (v: number) => void
}

export function TimingSection(props: TimingSectionProps) {
  const { mode, derivedStart, derivedEnd } = props

  return (
    <Section title="Timing">
      {mode === 'authored' && (
        <>
          <Field label="Start">
            {props.onStartTimeChange ? (
              <NumberInput
                value={props.startTime ?? 0}
                onChange={(v) => props.onStartTimeChange?.(Math.max(0, v))}
                min={0}
                step={0.5}
              />
            ) : (
              <DerivedValue value={props.startTime ?? 0} tooltip="Derived from upstream timing" />
            )}
          </Field>
          <Field label="Duration">
            {props.onDurationChange ? (
              <NumberInput
                value={props.duration ?? 0}
                onChange={(v) => props.onDurationChange?.(Math.max(0.1, v))}
                min={0.1}
                step={0.5}
              />
            ) : (
              <DerivedValue value={props.duration ?? 0} tooltip="Derived from other fields" />
            )}
          </Field>
        </>
      )}

      {mode === 'derived-with-preferred' && (
        <>
          <Field label="Preferred">
            <NumberInput
              value={props.preferredDuration ?? 0}
              onChange={(v) => props.onPreferredChange?.(Math.max(0.1, v))}
              min={0.1}
              step={0.5}
            />
          </Field>
          {props.minRequiredDuration != null && (
            <Field label="Min Required">
              <DerivedValue
                value={props.minRequiredDuration}
                tone={
                  (props.preferredDuration ?? 0) >= props.minRequiredDuration ? 'ok' : 'warning'
                }
                tooltip="Computed from strategy.computeMinDuration() and current constraints"
              />
            </Field>
          )}
          <Field label="Effective">
            <DerivedValue
              value={Math.max(props.preferredDuration ?? 0, props.minRequiredDuration ?? 0)}
              tooltip="max(Preferred, Min Required) — what the engine actually uses"
            />
          </Field>
        </>
      )}

      {props.staggerLabel != null && (
        <Field label={props.staggerLabel}>
          <NumberInput
            value={props.staggerValue ?? 0}
            onChange={(v) => props.onStaggerChange?.(Math.max(0, v))}
            min={0}
            step={props.staggerStep ?? 0.01}
          />
        </Field>
      )}

      {derivedStart != null && derivedEnd != null && (
        <div className="text-micro text-white/30 pt-1 border-t border-white/5">
          Range: {formatSeconds(derivedStart)} – {formatSeconds(derivedEnd)}
        </div>
      )}
    </Section>
  )
}
