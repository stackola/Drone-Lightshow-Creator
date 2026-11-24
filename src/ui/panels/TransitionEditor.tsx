// Picks how drones travel into a formation: direct, or a choreographed transition.

import type { CascadeOrder, TransitionKind, TransitionStyle } from '@/core/types'
import { TRANSITIONS, type TransitionInfo } from '@/core/transitions'
import { NumberField, Row, Select } from '@/ui/components/controls'

const ORDERS: { value: CascadeOrder; label: string }[] = [
  { value: 'left', label: 'Left to right' },
  { value: 'right', label: 'Right to left' },
  { value: 'center', label: 'Centre outward' },
  { value: 'edge', label: 'Edges inward' },
  { value: 'top', label: 'Top down' },
  { value: 'bottom', label: 'Bottom up' },
]

export function defaultTransition(kind: TransitionKind): TransitionStyle | undefined {
  switch (kind) {
    case 'direct': return undefined
    case 'cascade': return { kind, amount: 0.6, order: 'left' }
    case 'swirl': return { kind, amount: 0.6, turns: 0.5 }
    case 'burst': return { kind, amount: 0.5 }
    case 'ant': return { kind, amount: 0.6, lanes: 0 }
    case 'rain': return { kind, amount: 0.6 }
  }
}

export function TransitionEditor({ style, info, onChange, keyPrefix }: {
  style: TransitionStyle | undefined
  info: TransitionInfo | undefined
  onChange: (s: TransitionStyle | undefined, label: string, key?: string) => void
  keyPrefix: string
}) {
  const kind = style?.kind ?? 'direct'
  const def = TRANSITIONS.find((t) => t.kind === kind)!
  const set = (patch: Partial<TransitionStyle>, label: string, key: string) => style && onChange({ ...style, ...patch }, label, `${keyPrefix}:${key}`)
  const pct = (label: string, title: string) => (
    <Row label={label} title={title}>
      <NumberField value={Math.round((style?.amount ?? 0.6) * 100)} step={5} min={10} max={100} unit="%" onChange={(v) => set({ amount: v / 100 }, `${label}`, 'amount')} />
    </Row>
  )
  return (
    <>
      <Row label="Transition" title={def.hint}>
        <Select<TransitionKind>
          value={kind}
          ariaLabel="Transition style"
          options={TRANSITIONS.map((t) => ({ value: t.kind, label: t.label }))}
          onChange={(k) => onChange(defaultTransition(k), `Transition: ${TRANSITIONS.find((t) => t.kind === k)!.label}`)}
        />
      </Row>
      {kind !== 'direct' && <div className="hint" style={{ margin: '0 0 6px 100px' }}>{def.hint}.</div>}
      {style?.kind === 'cascade' && (
        <>
          <Row label="Ripple from">
            <Select<CascadeOrder> value={style.order ?? 'left'} ariaLabel="Ripple direction" options={ORDERS} onChange={(o) => set({ order: o }, 'Ripple direction', 'order')} />
          </Row>
          {pct('Ripple', 'How spread out the start times are')}
        </>
      )}
      {style?.kind === 'swirl' && (
        <Row label="Turns" title="How far the formation turns on the way (negative = the other way)">
          <NumberField value={style.turns ?? 0.5} step={0.25} min={-3} max={3} onChange={(v) => set({ turns: v || 0.25 }, 'Swirl turns', 'turns')} />
        </Row>
      )}
      {style?.kind === 'burst' && pct('Burst', 'How far the formation explodes outward')}
      {style?.kind === 'rain' && pct('Drip', 'How spread out the drops are (top drones fall last, highest targets rise first)')}
      {style?.kind === 'ant' && (
        <Row label="Lanes" title="Drones side by side in the marching column (0 = automatic)">
          <NumberField value={style.lanes ?? 0} step={1} min={0} max={40} precision={0} onChange={(v) => set({ lanes: Math.round(v) }, 'Ant lanes', 'lanes')} />
        </Row>
      )}
      {info?.note && <div className="hint" style={{ margin: '2px 0 6px 100px', color: 'var(--warn)' }}>{info.note}</div>}
    </>
  )
}
