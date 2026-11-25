// What the model sees about the show: compact text summaries (pure, testable)
// and rendered images of formations (browser only, in render.ts).

import type { Effect, ShowDoc } from '@/core/types'
import { compile, allocate, findSceneTime, type Compiled } from '@/core/compile'
import { groupSizes } from '@/core/groups'
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
    case 'flash': return `flash ${e.color} ${e.beatSync ? (e.onAccents ? 'on the music’s accents' : `every ${e.every} beat${e.every > 1 ? 's' : ''}`) : 'once'} (decay ${e.decay}s)`
    case 'react': return `${e.color} pulsing with the music's loudness (floor ${Math.round(e.floor * 100)}%)`
    case 'meter': return `level meter ${e.a}→${e.b} following the music's loudness`
    case 'strobe': return `strobe ${e.color} at ${e.rate} Hz`
    case 'off': return 'lights off'
    case 'image': return 'image colours'
    case 'write': return `write-on ${e.a} with a ${e.pen} pen over ${e.duration}s`
    case 'type': return `typewriter ${e.a} over ${e.duration}s`
    case 'flip': return `flip board settling to ${e.a} over ${e.duration}s`
    case 'matrix': return `LED text "${e.text}" ${e.a} on ${e.b}, ${e.speed ? `scrolling ${e.speed} columns/s` : 'static'}`
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
  lines.push(...describeSite(doc))
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
    lines.push(`${i + 1}. [${s.id}] "${s.name}" — ${timing}. Centre (${s.position.map(f1).join(', ')}) m, rotation tilt ${s.rotation[0]}° turn ${s.rotation[1]}° roll ${s.rotation[2]}°, spin ${s.spin}°/s${describeMotion(s)}.${t?.detour ? ' Flight in takes a collision-free detour (spread, cross, close in).' : ''}${t && t.transition.requested !== 'direct' ? ` Transition in: ${t.transition.used}${t.transition.used !== t.transition.requested ? ` (asked for ${t.transition.requested})` : ''}${t.transition.note ? ` — ${t.transition.note}` : ''}.` : ''}`)
    s.layers.forEach((l, li) => {
      lines.push(`   layer ${li}${l.role ? ` (spare drones: ${l.role})` : ''}: ${counts[li]} drones, ${describeShape(l.shape)}; light: ${describeEffect(l.effect)}${l.offset.some((v) => v !== 0) ? `; offset (${l.offset.map(f1).join(', ')})` : ''}`)
    })
    if (s.groups?.length && t) {
      const sizes = groupSizes(s, doc.droneCount)
      lines.push(`   Splits into groups after the hold: they fly on their own ${formatTime(t.holdEnd)}–${formatTime(t.splitEnd)}, then the next scene merges everyone (drones in no group keep holding).`)
      s.groups.forEach((g, gi) => {
        const which = g.part ? `${g.part.axis === 'x' ? 'slice' : 'band'} ${g.part.index + 1} of ${g.part.of} ${g.part.axis === 'x' ? 'left→right' : 'bottom→top'}` : `layer(s) ${g.layers.map((id) => s.layers.findIndex((l) => l.id === id)).join(', ')}`
        lines.push(`   - group [${g.id}] "${g.name}": ${which}, ${sizes[gi]} drones${g.delay ? `, sets off ${g.delay} s after the hold` : ''}:`)
        g.steps.forEach((st, k) => {
          const tt = findSceneTime(compiled, st.id)
          const main = st.layers[0]
          lines.push(`      ${k + 1}. [${st.id}] "${st.name}" — ${tt ? `flies in ${formatTime(tt.flightStart)}–${formatTime(tt.holdStart)}, holds ${formatTime(tt.holdStart)}–${formatTime(tt.holdEnd)}` : ''}; centre (${st.position.map(f1).join(', ')}) m${st.spin ? `, spin ${st.spin}°/s` : ''}; ${main ? `${describeShape(main.shape)}; light: ${describeEffect(main.effect)}` : ''}${st.layers.length > 1 ? ` (+${st.layers.length - 1} layer)` : ''}`)
        })
      })
    }
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

/** The real site as the model needs it: accuracy, keep-out zones and the flight area, in show metres. */
export function describeSite(doc: ShowDoc): string[] {
  const out: string[] = []
  const acc = doc.limits.accuracy
  if (acc && (acc.h || acc.v)) out.push(`Position accuracy ±${acc.h} m across, ±${acc.v} m up/down: drones are kept ${(doc.limits.minSpacing + 2 * Math.max(acc.h, acc.v)).toFixed(2)} m apart and further from every boundary.`)
  const box = (pts: [number, number][]) => {
    const xs = pts.map((p) => p[0]), zs = pts.map((p) => p[1])
    return `x ${f1(Math.min(...xs))}…${f1(Math.max(...xs))}, z ${f1(Math.min(...zs))}…${f1(Math.max(...zs))}`
  }
  const zones = doc.site.zones ?? []
  if (zones.length) {
    out.push('Keep-out zones on the ground (show metres; x = across, + to the audience’s right; z + toward the audience) — formations and flights must keep clear:')
    for (const z of zones) out.push(`- "${z.name}" (${z.kind === 'building' ? 'obstacle' : z.kind}): ${box(z.points)}, ${z.top === null ? 'no ceiling (keep out entirely)' : `up to ${z.top} m (drones may pass above with the buffer)`}, buffer ${z.buffer} m.`)
  }
  if (doc.site.area?.length) out.push(`Permitted flight area: polygon spanning ${box(doc.site.area)}; every drone must stay inside.`)
  return out
}

export function describeMusic(doc: ShowDoc): string {
  const m = summarizeMusic(doc)
  if (!m) return 'No music is loaded (or no beat was detected).'
  const songEnd = m.offset + m.duration
  const c = compile(doc)
  const showEnd = c.sceneTimes.length ? c.sceneTimes[c.sceneTimes.length - 1]!.splitEnd : 0
  const onScreen = (s: { start: number; end: number }) =>
    doc.scenes.filter((_, i) => { const t = c.sceneTimes[i]; return t && t.holdStart < s.end && t.splitEnd > s.start }).map((sc) => `"${sc.name}"`).join(', ')
  const lines = [
    ...(doc.audio?.generated ? [`“${doc.audio.name}” is an original score composed to this show (drops where hero formations arrive). After changing scenes or timing, call compose_score again so the music follows the show.`] : []),
    `${Math.round(m.bpm)} BPM, bar length ${m.barLength.toFixed(2)} s. The song plays ${formatTime(m.offset)}–${formatTime(songEnd)} in show time (${formatTime(m.duration)} long); the last formation currently ends at ${formatTime(showEnd)}${Math.abs(showEnd - songEnd) > m.barLength ? (showEnd < songEnd ? ` — ${Math.round(songEnd - showEnd)} s before the song ends` : ` — ${Math.round(showEnd - songEnd)} s after the song ends`) : ' (with the song)'}.`,
    'Sections (1-based index · label · show time · bars · loudness · formations held during it):',
    ...m.sections.map((s, i) => `${i + 1}. ${s.label} · ${formatTime(s.start)}–${formatTime(s.end)} · ${s.bars} bars · ${Math.round(s.energy * 100)}% · ${onScreen(s) || '—'}`),
    m.accents.length ? `Accents (stand-out hits, show time): ${m.accents.slice(0, 40).map((t) => t.toFixed(1)).join(', ')}${m.accents.length > 40 ? ` … (${m.accents.length} in all)` : ''}` : 'No accents detected.',
    'Bars (show time:loudness 0–9):',
    m.bars.map((b) => `${b.t.toFixed(1)}:${b.energy}`).join(' '),
  ]
  if (!doc.audio?.energy) lines.push('(Loudness was not analysed for this song; reload the music to get it.)')
  if (!doc.audio?.sections) lines.push('(Sections were estimated from loudness; reload the music for full analysis.)')
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
