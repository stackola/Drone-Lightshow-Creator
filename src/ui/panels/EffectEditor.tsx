import type { Effect, EffectKind } from '@/core/types'
import { EFFECTS, defaultEffect } from '@/core/effects'
import { ColorField, NumberField, Row, Segmented, Select, Toggle } from '@/ui/components/controls'

function baseColor(e: Effect): string {
  switch (e.kind) {
    case 'solid': return e.color
    case 'flash': case 'strobe': return e.color
    case 'gradient': case 'pulse': case 'twinkle': case 'wave': return e.a
    case 'chase': return e.b
    case 'write': case 'type': case 'flip': case 'matrix': case 'meter': return e.a
    case 'react': return e.color
    case 'palette': return e.colors[0] ?? '#38bdf8'
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
          {effect.beatSync && (
            <Row label="">
              <Toggle checked={!!effect.onAccents} onChange={(v) => set('onAccents', v)} label="On the music’s accents (big hits)" />
            </Row>
          )}
          {effect.beatSync && !effect.onAccents && num('every', 'Every', 1, 'beats', 1, 64)}
        </>
      )}
      {effect.kind === 'react' && (
        <>
          {color('color', 'Colour')}
          <Row label="In silence" title="Brightness when the music is quiet">
            <NumberField value={Math.round(effect.floor * 100)} step={5} unit="%" min={0} max={100} onChange={(v) => set('floor', v / 100)} />
          </Row>
          <div className="hint">{hasBeats ? 'Brightness follows the music’s loudness. As a “tint” cue it makes the whole show breathe with the song.' : 'Load music to see it react.'}</div>
        </>
      )}
      {effect.kind === 'meter' && (
        <>
          {color('a', 'Low')}{color('b', 'Peak')}
          <div className="hint">{hasBeats ? 'Drones fill from the bottom up to the music’s current loudness.' : 'Load music to see it move.'}</div>
        </>
      )}
      {effect.kind === 'strobe' && (<>{color('color', 'Colour')}{num('rate', 'Rate', 0.5, 'Hz', 0.5, 25)}</>)}
      {effect.kind === 'write' && (
        <>
          {color('a', 'Ink')}{color('pen', 'Pen tip')}{color('b', 'Unwritten')}{num('duration', 'Writes in', 0.5, 's', 0.5, 60)}
          <div className="hint">Text is written letter by letter in stroke order; other shapes are drawn along their outline.</div>
        </>
      )}
      {effect.kind === 'type' && (<>{color('a', 'Letters')}{color('cursor', 'Cursor')}{color('b', 'Blank')}{num('duration', 'Types in', 0.5, 's', 0.5, 60)}</>)}
      {effect.kind === 'flip' && (<>{color('a', 'Letters')}{color('b', 'Dark flaps')}{num('duration', 'Settles in', 0.5, 's', 0.5, 60)}{num('rate', 'Flicker', 1, 'Hz', 1, 30)}</>)}
      {effect.kind === 'matrix' && (
        <>
          <Row label="Text">
            <input className="text-input" value={effect.text} aria-label="LED text" maxLength={120} onChange={(ev) => set('text', ev.target.value.toUpperCase())} />
          </Row>
          <Row label="Letters">
            <Segmented full value={String(effect.font === 5 ? 5 : 7)} options={[{ value: '7', label: '5×7 dots' }, { value: '5', label: '3×5 (small)' }]} onChange={(v) => set('font', Number(v))} />
          </Row>
          {color('a', 'LEDs on')}{color('b', 'LEDs off')}
          {num('speed', 'Scroll', 1, 'col/s', 0, 40)}
          <div className="hint">Scrolls right to left (0 = still). On a grid, each dot is one drone: a panel {effect.font === 5 ? 5 : 7} drones tall is pixel-perfect, taller panels centre the text. Each letter needs {effect.font === 5 ? 4 : 6} columns.</div>
        </>
      )}
      {effect.kind === 'image' && (
        <>
          <div className="hint">Each drone shows the colour of its part of the shape (drawing, image or 3D model part).</div>
          <Row label="Alive">
            <Segmented full value={effect.anim ?? 'none'} onChange={(v) => onChange({ ...effect, anim: v, speed: effect.speed ?? 1 }, 'Shape colour motion')} options={[
              { value: 'none', label: 'Still' }, { value: 'shimmer', label: 'Shimmer', title: 'Each drone breathes gently on its own clock' },
              { value: 'glint', label: 'Glint', title: 'A band of white light sweeps across, like light catching metal' },
              { value: 'pulse', label: 'Pulse', title: 'Brightens on every beat and settles back' }, { value: 'sparkle', label: 'Sparkle', title: 'Random drones flash white' },
            ]} />
          </Row>
          {effect.anim && effect.anim !== 'none' && num('speed', 'Speed', 0.1, '×', 0.05, 10)}
        </>
      )}
      {effect.kind === 'palette' && (
        <>
          <Row label="Colours">
            <div className="palette-stops">
              {effect.colors.map((c, i) => (
                <span key={i} className="palette-stop">
                  <ColorField value={c} onChange={(v) => set('colors', effect.colors.map((x, j) => (j === i ? v : x)))} />
                  {effect.colors.length > 2 && <button className="btn ghost icon sm" aria-label={`Remove colour ${i + 1}`} title="Remove colour" onClick={() => onChange({ ...effect, colors: effect.colors.filter((_, j) => j !== i) }, 'Palette colours')}>×</button>}
                </span>
              ))}
              {effect.colors.length < 6 && <button className="btn ghost sm" onClick={() => onChange({ ...effect, colors: [...effect.colors, effect.colors[effect.colors.length - 1] ?? '#ffffff'] }, 'Palette colours')}>+ Colour</button>}
            </div>
          </Row>
          <Row label="Across">
            <Segmented full value={effect.mode} onChange={(v) => set('mode', v)} options={[{ value: 'linear', label: 'In a direction' }, { value: 'radial', label: 'Centre → edge' }]} />
          </Row>
          {effect.mode === 'linear' && num('angle', 'Direction', 5, '°', -360, 360)}
          {num('speed', 'Flow', 0.05, '/s', -5, 5)}
        </>
      )}
      {effect.kind === 'off' && <div className="hint">These drones fly with lights off — handy for parking spare drones out of sight.</div>}
      {effect.kind !== 'off' && (
        <Row label="Brightness">
          <NumberField value={Math.round(effect.brightness * 100)} step={5} unit="%" min={0} max={100} onChange={(v) => set('brightness', v / 100)} />
        </Row>
      )}
    </>
  )
}
