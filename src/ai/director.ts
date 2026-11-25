// Show Director: a written brief becomes a complete show. Claude writes a
// structured plan (scenes, lights, cues); the engine builds it safely, lands
// arrivals on the music's downbeats, and applies automatic safety fixes.

import type { ShapeSpec, ShowDoc } from '@/core/types'
import { ShowPlan } from './schemas'
import { submitObject } from './submit'
import { describeMusic, estimateTimings } from './context'
import { buildShowFromPlan, type BuiltShow } from './convert'
import { describeToShape } from './shapeGen'
import { createModel, modelShape } from './model3d'
import { fourViews } from './render'
import { newShow } from '@/core/defaults'
import { formatTime } from '@/core/validate'
import { getState } from '@/state/store'

export const DIRECTOR_SYSTEM = `You are a creative director for drone light shows. Given a client brief, you design a complete show as a structured plan: a sequence of formations ("scenes") with their lights, plus light cues layered on top.

The medium
- Splits: once or twice in a show, a scene can split (split: halves, top-bottom, thirds or by shape) — its drones divide into groups that each fly 1–3 formations of their own at their own pace (stagger them with delay_seconds), and the next scene merges everyone back. Group formations are smaller (fewer drones), so keep them simple; each group stays on its own side (the default) so groups never cross.
- Every drone takes part in every scene (or in its group during a split). Drones are points of coloured light a few metres apart, seen from hundreds of metres away. Bold, recognisable shapes read; fine detail and long words don't.
- The engine sizes each formation automatically to the smallest safe size and keeps it inside the airspace; use shape.scale only to make a formation deliberately bigger. Flights between scenes are planned and timed by the engine for safety — you can't make them faster.
- Text: keep it short (about 1 character per 15–25 drones for crisp letters). For digits or short words use spare_fraction (0.3–0.6) so the text stays compact while the remaining drones wait dark behind it.
- For flat pictures that aren't built-in shapes (logos, symbols, silhouettes), use shape kind "custom" with a clear visual description. For 3D objects (a rocket, a trophy, a globe on a stand, an animal), use "model3d" — it is built from solid parts, checked visually from four angles, and looks best spinning. Use at most 4 custom or model3d shapes per show, for the moments that matter most.
- 3D shapes (sphere, torus, cube, helix, cone) look best spinning slowly (spin 10–25 °/s). 2D shapes face the audience; tilt or turn them only for effect.
- Transitions are part of the show: give 1–3 key flights a spectacle transition (cascade ripples, swirl, burst on a drop, an ant-walk column or rain for a big reveal). They take longer than direct flights (ant walk and rain ~1 min), so budget the battery and use direct for the rest.
- Text can be revealed: light effects write (stroke-by-stroke handwriting), type (typewriter) and flip (split-flap board) on text formations; an LED sign is a grid 7 drones tall with the matrix effect scrolling text.
- Long holds stay alive with a gentle idle_motion (breathe 4–8%, bob 1–2 m, sway 5–10°); use it on a few scenes, not all. When a formation uses only part of the fleet, give the spares a role instead of hiding them: a starfield behind a quiet scene, a halo or frame around a logo or name, a base band under text.
- Light: each scene has a base light; cues add accents over time (flashes, washes, sweeps, blackouts), anchored to a scene's arrival. Use cues sparingly and with intent.

Good shows
- Open with something simple and striking, build through contrast (shape, colour, scale, motion), and finish with the biggest, brightest moment.
- Tell the brief's story in a few clear beats rather than many small ones. Favour fewer, stronger scenes over many short ones.
- Use the client's colours and words where the brief gives them.
- With music: the song is the backbone. Read its sections and shape the show to them: quiet intro → calm, simple formations (text written on, slow breathing); builds → a transition that rises (cascade, swirl) arriving on the drop; drops → the biggest, brightest formations (use arrive_at_section to land your hero formation exactly on the biggest drop's start); breaks → something tender or a spare starfield; outro → the farewell text and a gentle finale. Hold for whole bars (hold_seconds = bars × bar length). Keep music_lighting on (bold for energetic songs, subtle for gentle ones) — it adds breathing, sweeps and flashes on every hit, so your own cues can focus on a few signature moments. The engine fits the show to the song, lands arrivals on downbeats and on the sections you choose.`

export interface DirectorRequest {
  brief: string
  droneCount: number
  /** Desired show length in seconds, or null to fit the music (or a natural length). */
  targetSeconds: number | null
  useMusic: boolean
  /** No song: compose an original score to the show (drops on the hero formations). */
  composeScore?: boolean
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
  if (req.composeScore) lines.push('', 'There is no song: an original score will be composed to your show, like a film score. In original_score, choose the 2–5 hero formations the music builds to and drops on (drops_at), any tender quiet moments (breaks_at), and a tempo for the mood. Every arrival lands on a bar; hold for whole bars at that tempo (one bar = 240 / bpm seconds). Keep music_lighting on so the lights follow the score.')
  return lines.join('\n')
}

export async function directShow(req: DirectorRequest, onProgress: (p: DirectorProgress) => void, signal?: AbortSignal): Promise<DirectorResult> {
  const current = getState().doc
  // Keep the music in the project either way; only time the show to it when asked.
  const base: ShowDoc = { ...newShow(req.droneCount, 'AI show'), limits: current.limits, site: current.site, audio: current.audio }

  onProgress({ phase: 'planning', scenes: [] })
  // The plan comes back as a tool call: far too many optional fields for grammar-constrained output (see submit.ts).
  let lastCount = 0
  const plan = await submitObject({
    schema: ShowPlan,
    tool: { name: 'submit_show_plan', description: 'Submit the complete show plan: every scene with its formation, light and timing, the light cues, and the music options.' },
    system: DIRECTOR_SYSTEM,
    content: [{ type: 'text', text: briefFor(req, base) }],
    maxTokens: 32000,
    effort: 'high',
    signal,
    onPartial: (snap) => {
      // Show scene names as the plan streams in.
      const scenes = (snap as { scenes?: { name?: unknown }[] } | null)?.scenes
      const names = Array.isArray(scenes) ? scenes.map((x) => (typeof x?.name === 'string' ? x.name : '')).filter(Boolean) : []
      if (names.length !== lastCount) {
        lastCount = names.length
        onProgress({ phase: 'planning', scenes: names })
      }
    },
    messages: { refusal: 'Claude declined this brief. Try rewording it.', tooLong: 'The plan was too long. Ask for a shorter show.', unreadable: 'The plan was incomplete. Try again.' },
  })
  if (!plan.scenes.length) throw new Error('The plan was incomplete. Try again.')

  // Draw custom formations and build 3D models in parallel (capped).
  const customIdx = plan.scenes.flatMap((s, i) => ((s.shape.kind === 'custom' || s.shape.kind === 'model3d') && s.shape.description ? [i] : [])).slice(0, 4)
  const custom = new Map<number, ShapeSpec>()
  let customFailures = 0
  if (customIdx.length) {
    onProgress({ phase: 'drawing', scenes: plan.scenes.map((s) => s.name), note: `Drawing ${customIdx.length} custom formation${customIdx.length > 1 ? 's' : ''} (3D models are checked from four angles)…` })
    const results = await Promise.allSettled(
      customIdx.map(async (i): Promise<{ shape: ShapeSpec }> => {
        const s = plan.scenes[i]!.shape
        if (s.kind === 'custom') return describeToShape(s.description!, signal)
        const attempts = await createModel(s.description!, { n: req.droneCount, rounds: 1, render: fourViews, signal })
        return { shape: modelShape(attempts[attempts.length - 1]!) }
      }),
    )
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
  const built = buildShowFromPlan(plan, base, custom, { alignToMusic: req.useMusic, composeScore: req.composeScore })
  return { plan, built, customFailures }
}
