// Show Director: a written brief becomes a complete show. Claude writes a
// structured plan (scenes, lights, cues); the engine builds it safely, lands
// arrivals on the music's downbeats, and applies automatic safety fixes.

import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import type { ShapeSpec, ShowDoc } from '@/core/types'
import { ShowPlan } from './schemas'
import { RefusalError, baseParams, getClient, recordUsage } from './client'
import { describeMusic, estimateTimings } from './context'
import { buildShowFromPlan, type BuiltShow } from './convert'
import { describeToShape } from './shapeGen'
import { newShow } from '@/core/defaults'
import { formatTime } from '@/core/validate'
import { getState } from '@/state/store'

export const DIRECTOR_SYSTEM = `You are a creative director for drone light shows. Given a client brief, you design a complete show as a structured plan: a sequence of formations ("scenes") with their lights, plus light cues layered on top.

The medium
- Every drone takes part in every scene. Drones are points of coloured light a few metres apart, seen from hundreds of metres away. Bold, recognisable shapes read; fine detail and long words don't.
- The engine sizes each formation automatically to the smallest safe size and keeps it inside the airspace; use shape.scale only to make a formation deliberately bigger. Flights between scenes are planned and timed by the engine for safety — you can't make them faster.
- Text: keep it short (about 1 character per 15–25 drones for crisp letters). For digits or short words use spare_fraction (0.3–0.6) so the text stays compact while the remaining drones wait dark behind it.
- For pictures that aren't built-in shapes (logos, animals, objects, symbols), use shape kind "custom" with a clear visual description. Use at most 4 custom shapes per show, for the moments that matter most.
- 3D shapes (sphere, torus, cube, helix, cone) look best spinning slowly (spin 10–25 °/s). 2D shapes face the audience; tilt or turn them only for effect.
- Light: each scene has a base light; cues add accents over time (flashes, washes, sweeps, blackouts), anchored to a scene's arrival. Use cues sparingly and with intent.

Good shows
- Open with something simple and striking, build through contrast (shape, colour, scale, motion), and finish with the biggest, brightest moment.
- Tell the brief's story in a few clear beats rather than many small ones. Favour fewer, stronger scenes over many short ones.
- Use the client's colours and words where the brief gives them.
- With music: hold formations for whole bars (hold_seconds = bars × bar length), save big shapes and beat-synced flashes (pulse or flash with beat_sync) for loud sections, use slow twinkles and dimmed flights in quiet passages. The engine lands every arrival exactly on a downbeat.`

export interface DirectorRequest {
  brief: string
  droneCount: number
  /** Desired show length in seconds, or null to fit the music (or a natural length). */
  targetSeconds: number | null
  useMusic: boolean
}

export interface DirectorProgress {
  phase: 'planning' | 'drawing' | 'building'
  scenes: string[]
  note?: string
}

export interface DirectorResult {
  plan: ShowPlan
  built: BuiltShow
  customFailures: number
}

function briefFor(req: DirectorRequest, base: ShowDoc): string {
  const t = estimateTimings(base)
  const L = base.limits
  const lines = [
    `Brief from the client:\n${req.brief.trim()}`,
    '',
    `Fleet: ${req.droneCount} drones. Limits: ${L.minSpacing} m spacing, speed ${L.maxSpeedH} m/s, climb ${L.maxSpeedUp} m/s, airspace ${L.minAltitude}–${L.maxAltitude} m, radius ${L.maxRadius} m, battery ${formatTime(L.maxFlightTime)}.`,
    `Timing with this fleet: takeoff and the first flight take about ${Math.round(t.takeoffAndFirst)} s before the first formation appears; flights between formations take roughly ${Math.round(t.typicalFlight)} s (longer between very different or large shapes); returning and landing take about ${Math.round(t.returnAndLand)} s.`,
  ]
  const music = req.useMusic && base.audio ? describeMusic(base) : null
  if (music) lines.push('', `Music (the show is set to it):\n${music}`)
  if (req.targetSeconds) {
    const budget = req.targetSeconds - t.takeoffAndFirst - t.returnAndLand
    const perScene = t.typicalFlight + 7
    lines.push('', `Target show length: about ${formatTime(req.targetSeconds)} in total. That leaves roughly ${Math.max(0, Math.round(budget))} s for formations and the flights between them — about ${Math.max(2, Math.round(budget / perScene))} scenes at typical holds.`)
  } else if (music) {
    lines.push('', 'Fit the show to the music: formations should fill the song, with the finale during its last strong section.')
  } else {
    lines.push('', 'Choose a natural length for the brief (typically 4–8 scenes).')
  }
  return lines.join('\n')
}

export async function directShow(req: DirectorRequest, onProgress: (p: DirectorProgress) => void, signal?: AbortSignal): Promise<DirectorResult> {
  const client = getClient()
  const current = getState().doc
  // Keep the music in the project either way; only time the show to it when asked.
  const base: ShowDoc = { ...newShow(req.droneCount, 'AI show'), limits: current.limits, site: current.site, audio: current.audio }

  onProgress({ phase: 'planning', scenes: [] })
  const stream = client.beta.messages.stream(
    {
      ...baseParams(),
      max_tokens: 32000,
      system: DIRECTOR_SYSTEM,
      output_config: { effort: 'high', format: zodOutputFormat(ShowPlan) },
      messages: [{ role: 'user', content: briefFor(req, base) }],
    },
    { signal },
  )
  let lastCount = 0
  stream.on('text', (_d, snapshot) => {
    // Show scene names as the plan streams in.
    const scenesPart = snapshot.split('"cues"')[0] ?? ''
    const names = [...scenesPart.matchAll(/"name"\s*:\s*"((?:[^"\\]|\\.)*)"\s*,\s*"shape"/g)].map((m) => m[1]!.replace(/\\"/g, '"'))
    if (names.length !== lastCount) {
      lastCount = names.length
      onProgress({ phase: 'planning', scenes: names })
    }
  })
  const msg = await stream.finalMessage()
  recordUsage(msg.usage)
  if (msg.stop_reason === 'refusal') throw new RefusalError('Claude declined this brief. Try rewording it.')
  if (msg.stop_reason === 'max_tokens') throw new Error('The plan was too long. Ask for a shorter show.')
  const text = msg.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('')
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new Error('Couldn’t read the plan. Try again.')
  }
  const parsed = ShowPlan.safeParse(raw)
  if (!parsed.success || !parsed.data.scenes.length) throw new Error('The plan was incomplete. Try again.')
  const plan = parsed.data

  // Draw custom formations in parallel (capped).
  const customIdx = plan.scenes.flatMap((s, i) => (s.shape.kind === 'custom' && s.shape.description ? [i] : [])).slice(0, 4)
  const custom = new Map<number, ShapeSpec>()
  let customFailures = 0
  if (customIdx.length) {
    onProgress({ phase: 'drawing', scenes: plan.scenes.map((s) => s.name), note: `Drawing ${customIdx.length} custom formation${customIdx.length > 1 ? 's' : ''}…` })
    const results = await Promise.allSettled(customIdx.map((i) => describeToShape(plan.scenes[i]!.shape.description!, signal)))
    results.forEach((r, k) => {
      if (r.status === 'fulfilled') custom.set(customIdx[k]!, r.value.shape)
      else customFailures++
    })
    // Custom drawings carry their own colours unless the plan chose a light.
    customIdx.forEach((i) => {
      const s = plan.scenes[i]!
      if (custom.has(i) && s.light.effect === 'solid' && !s.light.color) s.light = { ...s.light, effect: 'image' }
    })
  }
  onProgress({ phase: 'building', scenes: plan.scenes.map((s) => s.name) })
  const built = buildShowFromPlan(plan, base, custom, { alignToMusic: req.useMusic })
  return { plan, built, customFailures }
}
