// What the model sees about the show: compact text summaries (pure, testable)
// and rendered images of formations (browser only, in render.ts).

import type { Effect, ShowDoc } from '@/core/types'
import { compile, allocate, type Compiled } from '@/core/compile'
import { validate, formatTime, type Validation } from '@/core/validate'
import { SHAPE_BY_KIND, sizeLabel } from '@/core/shapes'
import { summarizeMusic } from '@/core/music'
import { newScene, newShow } from '@/core/defaults'

const f1 = (v: number) => (Math.round(v * 10) / 10).toString()

export function describeEffect(e: Effect): string {
  switch (e.kind) {
    case 'solid': return `solid ${e.color}`
    case 'gradient': return `gradient ${e.a}→${e.b} at ${e.angle}°`
    case 'rainbow': return `rainbow (speed ${e.speed}, angle ${e.angle}°)`
    case 'pulse': return `pulse ${e.a}→${e.b} ${e.beatSync ? 'on the beat' : `every ${e.period}s`}`
    case 'twinkle': return `twinkle ${e.a} with ${e.b} sparkles at ${e.rate} Hz`
    case 'chase': return `chase ${e.b} over ${e.a} (speed ${e.speed}, width ${e.width})`
    case 'wave': return `wave ${e.b} band over ${e.a} (angle ${e.angle}°, speed ${e.speed})`
    case 'flash': return `flash ${e.color} ${e.beatSync ? `every ${e.every} beat${e.every > 1 ? 's' : ''}` : 'once'} (decay ${e.decay}s)`
    case 'strobe': return `strobe ${e.color} at ${e.rate} Hz`
    case 'off': return 'lights off'
    case 'image': return 'image colours'
  }
}

function describeShape(shape: ShowDoc['scenes'][number]['layers'][number]['shape']): string {
  const def = SHAPE_BY_KIND[shape.kind]
  const extras = def.params.map((p) => `${p.key} ${(shape as unknown as Record<string, number>)[p.key]}`)
  if ('fill' in shape) extras.unshift(shape.fill ?? 'filled')
  if (shape.kind === 'text') extras.unshift(`"${shape.text.replace(/\n/g, '\\n')}"`, shape.font)
  if (shape.kind === 'image') extras.unshift(`image "${shape.name}"`)
  if (shape.kind === 'model') extras.unshift(`3D model "${shape.name}", ${shape.parts.length} parts`)
  return `${def.label.toLowerCase()}${extras.length ? ` (${extras.join(', ')})` : ''}, ${sizeLabel(shape.kind).toLowerCase()} ${f1(shape.size)} m`
}

/** Compact, complete description of the current show for the model. */
function describeMotion(s: ShowDoc['scenes'][number]): string {
  const m = s.motion
  if (!m || m.kind === 'none' || !m.amount) return ''
  const amt = m.kind === 'breathe' ? `${Math.round(m.amount * 100)}%` : m.kind === 'bob' ? `${m.amount} m` : `${m.amount}°`
  return `, idle motion ${m.kind} ${amt} every ${m.period} s`
}

export function summarizeShow(doc: ShowDoc, compiled: Compiled = compile(doc), validation: Validation = validate(doc, compiled)): string {
  const L = doc.limits
  const lines: string[] = []
  lines.push(`Show "${doc.name}" — ${doc.droneCount} drones, total ${formatTime(compiled.duration)} (battery limit ${formatTime(L.maxFlightTime)}).`)
  lines.push(`Limits: min spacing ${L.minSpacing} m, speed ${L.maxSpeedH} m/s, climb ${L.maxSpeedUp} m/s, descent ${L.maxSpeedDown} m/s, accel ${L.maxAccel} m/s², jerk ${L.maxJerk} m/s³, airspace ${L.minAltitude}–${L.maxAltitude} m high, radius ${L.maxRadius} m. Audience ${doc.site.audienceDistance} m away facing the formations.`)
  if (doc.audio) {
    const end = doc.audio.offset + doc.audio.duration
    lines.push(`Music: "${doc.audio.name}", ${Math.round(doc.audio.bpm)} BPM, plays ${formatTime(doc.audio.offset)}–${formatTime(end)} (call get_music for bars and loudness).`)
  } else lines.push('Music: none loaded.')
  lines.push(`Takeoff ${formatTime(compiled.takeoff.t0)}–${formatTime(compiled.takeoff.t1)}.`)
  if (!doc.scenes.length) lines.push('Scenes: none yet.')
  doc.scenes.forEach((s, i) => {
    const t = compiled.sceneTimes[i]
    const counts = allocate(doc.droneCount, s.layers.map((l) => l.weight))
    const timing = t
      ? `flies in ${formatTime(t.flightStart)}–${formatTime(t.holdStart)} (${f1(t.holdStart - t.flightStart)} s, ${s.flight.duration === null ? 'auto' : 'set'}; fastest safe ${f1(t.minFlight)} s${s.flight.dim ? ', dimmed' : ''}), holds ${formatTime(t.holdStart)}–${formatTime(t.holdEnd)}`
      : ''
    lines.push(`${i + 1}. [${s.id}] "${s.name}" — ${timing}. Centre (${s.position.map(f1).join(', ')}) m, rotation tilt ${s.rotation[0]}° turn ${s.rotation[1]}° roll ${s.rotation[2]}°, spin ${s.spin}°/s${describeMotion(s)}.${t?.detour ? ' Flight in takes a collision-free detour (spread, cross, close in).' : ''}`)
    s.layers.forEach((l, li) => {
      lines.push(`   layer ${li}${l.role ? ` (spare drones: ${l.role})` : ''}: ${counts[li]} drones, ${describeShape(l.shape)}; light: ${describeEffect(l.effect)}${l.offset.some((v) => v !== 0) ? `; offset (${l.offset.map(f1).join(', ')})` : ''}`)
    })
  })
  lines.push(`Return & land ${formatTime(compiled.returnFlight.t0)}–${formatTime(compiled.duration)}.`)
  if (doc.cues.length) {
    lines.push('Light cues:')
    for (const q of [...doc.cues].sort((a, b) => a.start - b.start)) {
      lines.push(`- [${q.id}] ${formatTime(q.start)}–${formatTime(q.start + q.duration)} ${describeEffect(q.effect)}, blend ${q.blend}${q.fadeIn || q.fadeOut ? `, fade ${q.fadeIn}/${q.fadeOut} s` : ''}`)
    }
  } else lines.push('Light cues: none.')
  const st = validation.stats
  if (validation.issues.length) {
    lines.push(`Safety: ${validation.issues.length} issue(s):`)
    for (const i of validation.issues) lines.push(`- ${i.title} — ${i.detail}${i.fix ? ` (automatic fix available: ${i.fix.label})` : ''}`)
  } else lines.push(`Safety: all checks pass (closest approach ${st.minDistance.toFixed(2)} m, highest drone ${st.maxAltitude.toFixed(0)} m).`)
  return lines.join('\n')
}

export function describeMusic(doc: ShowDoc): string {
  const m = summarizeMusic(doc)
  if (!m) return 'No music is loaded (or no beat was detected).'
  const lines = [
    `${Math.round(m.bpm)} BPM, bar length ${m.barLength.toFixed(2)} s, music plays ${formatTime(m.offset)}–${formatTime(m.offset + m.duration)} in show time.`,
    'Sections by loudness:',
    ...m.sections.map((s) => `- ${formatTime(s.start)}–${formatTime(s.end)}: ${s.level}`),
    'Bars (show time:loudness 0–9):',
    m.bars.map((b) => `${b.t.toFixed(1)}:${b.energy}`).join(' '),
  ]
  if (!doc.audio?.energy) lines.push('(Loudness was not analysed for this song; reload the music to get it.)')
  return lines.join('\n')
}

/** Typical durations for this fleet and its limits, so plans can budget time. */
export function estimateTimings(base: ShowDoc): { takeoffAndFirst: number; typicalFlight: number; returnAndLand: number } {
  const doc = { ...newShow(base.droneCount), limits: base.limits, site: base.site }
  doc.scenes = [newScene(doc, 'circle'), newScene(doc, 'heart'), newScene(doc, 'sphere')]
  const c = compile(doc)
  const st = c.sceneTimes
  const typical = ((st[1]!.holdStart - st[1]!.flightStart) + (st[2]!.holdStart - st[2]!.flightStart)) / 2
  return { takeoffAndFirst: st[0]!.holdStart, typicalFlight: typical, returnAndLand: c.duration - c.returnFlight.t0 }
}
