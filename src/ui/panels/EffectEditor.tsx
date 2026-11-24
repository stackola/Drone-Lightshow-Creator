import type { Effect, EffectKind } from '@/core/types'
import { EFFECTS, defaultEffect } from '@/core/effects'
import { ColorField, NumberField, Row, Select, Toggle } from '@/ui/components/controls'

function baseColor(e: Effect): string {
  switch (e.kind) {
    case 'solid': return e.color
    case 'flash': case 'strobe': return e.color
    case 'gradient': case 'pulse': case 'twinkle': case 'wave': return e.a
    case 'chase': return e.b
    default: return '#38bdf8'
  }
}

/** Edits any light effect. `onChange(next, key)` — the key merges continuous edits into one undo step. */
export function EffectEditor({ effect, onChange, allowImage, keyPrefix, hasBeats }: { effect: Effect; onChange: (e: Effect, label: string, key?: string) => void; allowImage: boolean; keyPrefix: string; hasBeats: boolean }) {
  const set = <K extends string>(k: K, v: unknown) => onChange({ ...effect, [k]: v } as Effect, 'Edit light', `${keyPrefix}:${k}`)
  const e = effect as Effect & Record<string, unknown>
  const color = (k: string, label: string) => (
    <Row label={label}>
      <ColorField value={String(e[k])} onChange={(v) => set(k, v)} />
    </Row>
  )
  const num = (k: string, label: string, step: number, unit?: string, min = 0, max = Infinity) => (
    <Row label={label}>
      <NumberField value={Number(e[k])} step={step} unit={unit} min={min} max={max} onChange={(v) => set(k, v)} />
    </Row>
  )
  return (
    <>
      <Row label="Effect">
        <Select<EffectKind>
          value={effect.kind}
          ariaLabel="Light effect"
          options={EFFECTS.filter((x) => allowImage || x.kind !== 'image').map((x) => ({ value: x.kind, label: x.label }))}
          onChange={(k) => onChange({ ...defaultEffect(k, baseColor(effect)), brightness: effect.kind === 'off' ? 1 : effect.brightness } as Effect, 'Change effect')}
        />
      </Row>
      {effect.kind === 'solid' && color('color', 'Colour')}
      {effect.kind === 'gradient' && (<>{color('a', 'From')}{color('b', 'To')}{num('angle', 'Direction', 5, '°', -360, 360)}</>)}
      {effect.kind === 'rainbow' && (<>{num('angle', 'Direction', 5, '°', -360, 360)}{num('speed', 'Speed', 0.05, 'cyc/s', -5, 5)}{num('scale', 'Spread', 0.1, '×', 0, 10)}</>)}
      {effect.kind === 'pulse' && (
        <>
          {color('a', 'Peak')}
          {color('b', 'Rest')}
          <Row label="Timing">
            <Toggle checked={effect.beatSync} onChange={(v) => set('beatSync', v)} label={hasBeats ? 'On the beat' : 'On the beat (load music)'} />
          </Row>
          {!effect.beatSync && num('period', 'Period', 0.1, 's', 0.05, 60)}
        </>
      )}
      {effect.kind === 'twinkle' && (<>{color('a', 'Base')}{color('b', 'Sparkle')}{num('rate', 'Rate', 0.1, 'Hz', 0, 20)}</>)}
      {effect.kind === 'chase' && (<>{color('a', 'Base')}{color('b', 'Highlight')}{num('speed', 'Speed', 0.05, 'laps/s', -5, 5)}{num('width', 'Width', 0.05, '', 0.01, 1)}</>)}
      {effect.kind === 'wave' && (<>{color('a', 'Base')}{color('b', 'Band')}{num('angle', 'Direction', 5, '°', -360, 360)}{num('speed', 'Speed', 0.05, '/s', -5, 5)}{num('width', 'Width', 0.05, '', 0.02, 1)}</>)}
      {effect.kind === 'flash' && (
        <>
          {color('color', 'Colour')}
          {num('decay', 'Decay', 0.05, 's', 0.02, 10)}
          <Row label="Timing">
            <Toggle checked={effect.beatSync} onChange={(v) => set('beatSync', v)} label={hasBeats ? 'On the beat' : 'On the beat (load music)'} />
          </Row>
          {effect.beatSync && num('every', 'Every', 1, 'beats', 1, 64)}
        </>
      )}
      {effect.kind === 'strobe' && (<>{color('color', 'Colour')}{num('rate', 'Rate', 0.5, 'Hz', 0.5, 25)}</>)}
      {effect.kind === 'image' && <div className="hint">Each drone shows the colour of its part of the shape (image pixel or 3D model part).</div>}
      {effect.kind === 'off' && <div className="hint">These drones fly with lights off — handy for parking spare drones out of sight.</div>}
      {effect.kind !== 'off' && (
        <Row label="Brightness">
          <NumberField value={Math.round(effect.brightness * 100)} step={5} unit="%" min={0} max={100} onChange={(v) => set('brightness', v / 100)} />
        </Row>
      )}
    </>
  )
}
