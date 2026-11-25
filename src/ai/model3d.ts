// AI 3D models with "look and fix".
//
// 1. Claude builds the model from parts (solids, flat plates, tubes, turned
//    profiles), optionally with joints that move parts while it's held.
// 2. The engine turns it into drones; we render those drones from four
//    angles, next to the parts as solid surfaces (what Claude modelled) and,
//    for moving parts, the drones at both ends of the motion.
// 3. Claude compares, says what's wrong, and returns a corrected model — or
//    declares it done. Repeat for a few rounds; the designer can add their
//    own feedback for further rounds.

import { z } from 'zod'
import type { BetaContentBlockParam } from '@anthropic-ai/sdk/resources/beta/messages/messages'
import type { ModelJoint, ModelPart, ShapeSpec } from '@/core/types'
import { MAX_PARTS, sampleModel } from '@/core/model3d'
import { MAX_JOINTS, modelPoses } from '@/core/joints'
import { generateShape } from '@/core/shapes'
import { modelJoints, modelPart } from '@/core/serialize'
import { submitObject } from './submit'

const vec3 = z.array(z.number()).describe('[x, y, z]')
const pair = z.array(z.number()).describe('[a, b]')

export const PartInput = z.object({
  type: z.enum(['sphere', 'ellipsoid', 'box', 'cylinder', 'cone', 'capsule', 'torus', 'plate', 'tube', 'lathe']),
  name: z.string().optional().describe('What this part is, e.g. "left wing"'),
  color: z.string().describe('Hex colour, e.g. "#ff3366" — the drones’ light colour'),
  center: vec3.optional().describe('sphere, ellipsoid, box, torus, plate, lathe'),
  radius: z.number().optional().describe('sphere; cylinder; capsule; cone base; torus ring radius; tube radius'),
  radii: vec3.optional().describe('ellipsoid semi-axes before rotation'),
  size: vec3.optional().describe('box width, height, depth before rotation'),
  from: vec3.optional().describe('cylinder, capsule, cone: start point (cone base)'),
  to: vec3.optional().describe('cylinder, capsule, cone: end point (cone tip)'),
  radius_top: z.number().optional().describe('cone radius at `to` (0 = pointed)'),
  tube: z.number().optional().describe('torus tube radius'),
  rotation: vec3.optional().describe('ellipsoid, box, torus, plate, lathe: degrees about x, then y, then z'),
  points: z.array(pair).optional().describe('plate: outline [x, y] points in the plate’s own plane (it faces +z before rotation), relative to center'),
  depth: z.number().optional().describe('plate: thickness'),
  path: z.array(vec3).optional().describe('tube: the points it runs through (2–40)'),
  profile: z.array(pair).optional().describe('lathe: [radius, height] pairs from bottom to top, revolved about the part’s vertical axis'),
  joint: z.string().optional().describe('id of the joint this part moves with (moving parts only)'),
})

export const JointInput = z.object({
  id: z.string().describe('Short id the moving parts refer to, e.g. "wing-l"'),
  name: z.string().describe('e.g. "Left wing"'),
  kind: z.enum(['swing', 'turn', 'slide']).describe('swing: back and forth about the axis; turn: round and round; slide: back and forth along the axis'),
  pivot: vec3.describe('Where the part is hinged (model coordinates), e.g. the shoulder for a wing'),
  axis: vec3.describe('Hinge direction (swing, turn) or slide direction'),
  amount: z.number().describe('swing: degrees either way; turn: degrees per second; slide: model units either way'),
  period: z.number().optional().describe('Seconds per back-and-forth (swing, slide); default 8'),
  phase: z.number().optional().describe('0–1: where in the beat it starts (0.5 = the opposite way)'),
  parent: z.string().optional().describe('id of the joint it hangs off (a wingtip off the wing)'),
})

export const Model3DOutput = z.object({
  name: z.string().describe('Short name, e.g. "Hot-air balloon"'),
  relief: z.boolean().optional().describe('true: drones only on the side the audience sees (twice as dense there) — for subjects shown from the front that don’t turn; false/omitted for objects that spin or are seen from several sides'),
  parts: z.array(PartInput),
  joints: z.array(JointInput).optional().describe('Moving parts (only if the description implies motion: flapping, waving, wagging, turning wheels…)'),
})
export type Model3DOutput = z.infer<typeof Model3DOutput>

export const ModelReview = z.object({
  critique: z.string().describe('What reads well and what is wrong, in one to three sentences, for the designer'),
  done: z.boolean().describe('true only if the drones already read clearly as the description (and any designer feedback is satisfied); then return the model unchanged'),
  model: Model3DOutput,
})

export const MODEL3D_SYSTEM = `You build 3D models for drone light shows. Each model becomes a few hundred points of coloured light (drones metres apart) seen from far away at night. You place parts; the engine spreads the drones evenly over the outer surface of their union.

Coordinates: y is up, x is the audience's right, z points toward the audience — the front faces +z. Aim for the model to span roughly −1 to 1 (it is rescaled).

Parts:
- sphere: center, radius
- ellipsoid: center, radii, rotation
- box: center, size, rotation
- cylinder: from, to, radius
- cone: from (base), to (tip), radius, radius_top (0 = pointed)
- capsule: from, to, radius — rounded rods
- torus: center, radius, tube, rotation — a ring lying flat in the XZ plane; rotation [90, 0, 0] stands it up facing the audience
- plate: center, points (an outline [x, y] in its own plane, facing +z), depth, rotation — stars, fins, leaves, petals, feathers, flames, logos, letters with thickness
- tube: path (points it runs through), radius — necks, tails, tentacles, vines, curls, rope, any curved stroke
- lathe: center, profile ([radius, height] from bottom to top), rotation — anything turned: vases, bells, bottles, balloons, trophies, bodies, domes
Rotations are degrees about x, then y, then z.

How parts become drones (use this — it is where the detail comes from):
- Parts thinner than the drone spacing become ONE sheet of drones (thin plates, flat ellipsoids/boxes: wings, fins, ears, leaves, capes, flags) or ONE line of drones (thin tubes, capsules, cylinders: legs, antennae, whiskers, stems, outlines, rays). These cost few drones and read crisply — use them for every thin feature instead of fattening it.
- A small sphere (smaller than the spacing) becomes a single drone: eyes, buttons, stars, highlights — give it a contrasting colour.
- Solid volumes get drones all over their surface; parts must touch or overlap to read as one object; a part entirely inside another produces no drones.
- relief = true puts drones only on the side the audience sees: use it for subjects shown from the front that don't turn (a face, an emblem, a bird with spread wings facing the audience). Leave it off for objects that spin or are seen from several sides.
- Bold silhouette first, then the 3–6 features that make it recognisable. Detail smaller than about two drone spacings won't show.

Colour (each part's colour is its drones' light):
- Night sky: bright, saturated colours; never black, grey or very dark (they vanish). White and pale yellow read as the brightest.
- 2–5 colours that belong together, with one strong accent where the eye should go (eyes, a flame, a heart). Contrasting neighbours separate parts that overlap from the front.

Moving parts (joints) — only when the description implies motion (flapping, waving, wagging, walking, turning wheels or blades):
- A joint moves its parts as one rigid piece: swing (back and forth about the axis by ± amount degrees, once per period seconds), turn (continuously, amount degrees per second) or slide (± amount along the axis).
- Put the pivot exactly at the hinge where the part attaches (a wing at the shoulder, not its middle). Axis: [0, 0, 1] swings in the picture the audience sees (a wing flapping seen from the front, a pendulum, a clock hand), [0, 1, 0] about the vertical (a door), [1, 0, 0] a nod.
- Mirrored pairs (left and right wings) use opposite axes ([0, 0, -1] and [0, 0, 1]) with the same phase so they move together; walking legs use phase 0 and 0.5.
- A joint can hang off another (parent): a wingtip off the wing, a little lag (phase −0.1) makes it fluid.
- Choose the motion's character (wings 20–30°, a tail 15°, legs 20° each way; periods 6–12 s). Big formations move their tips metres per beat, so the editor calms or slows it to what the drones can fly safely.

Use 6–60 parts.`

export interface ModelAttempt {
  name: string
  parts: ModelPart[]
  joints?: ModelJoint[]
  relief?: boolean
  /** Four-view render of the drones (PNG base64). */
  image: string
  /** The parts as dense solid surfaces, four views (what was modelled). */
  reference?: string
  /** Moving parts: the drones at rest and at both ends of the motion. */
  motion?: string
  /** Parts that produced no drones (buried or invalid). */
  hiddenParts: number[]
  /** Claude's verdict after looking at this attempt (filled in when reviewed). */
  critique?: string
  verdict?: 'good' | 'fixed'
  feedback?: string
}

export type Renderer = (points: Float32Array, colors: Float32Array | null, title: string) => string
export type StripRenderer = (frames: { points: Float32Array; label: string }[], colors: Float32Array | null, title: string) => string
/** Four-view renderer, plus (in the browser) a front strip for moving parts. */
export type Renderers = Renderer | { views: Renderer; strip?: StripRenderer }

const views = (r: Renderers): { views: Renderer; strip?: StripRenderer } => (typeof r === 'function' ? { views: r } : r)

export function partsFromOutput(out: Model3DOutput): ModelPart[] {
  return out.parts
    .map((p) => modelPart({ ...p, radiusTop: p.radius_top }))
    .filter((p): p is ModelPart => !!p)
    .slice(0, MAX_PARTS)
}

/** The model's joints, keeping only ones some part (or a child joint) refers to. */
export function jointsFromOutput(out: Model3DOutput, parts: ModelPart[]): ModelJoint[] {
  const all = modelJoints((out.joints ?? []).map((j) => ({ ...j, period: j.period ?? 8, phase: j.phase ?? 0 }))).slice(0, MAX_JOINTS)
  const used = new Set(parts.map((p) => p.joint).filter((x): x is string => !!x))
  for (let k = 0; k < 4; k++) for (const j of all) if (used.has(j.id) && j.parent) used.add(j.parent)
  return all.filter((j) => used.has(j.id))
}

/** Shape spec for a scene layer (sized to safe spacing afterwards). */
export function modelShape(a: { name: string; parts: ModelPart[]; joints?: ModelJoint[]; relief?: boolean }): Extract<ShapeSpec, { kind: 'model' }> {
  return {
    kind: 'model', size: 1, name: a.name.slice(0, 40) || '3D model', parts: a.parts,
    ...(a.joints?.length ? { joints: a.joints } : {}), ...(a.relief ? { relief: true } : {}),
  }
}

/** Render a model as drones (and as solid surfaces, and in motion) for a look-and-fix round. */
export function attemptFrom(model: { name: string; parts: ModelPart[]; joints?: ModelJoint[]; relief?: boolean }, n: number, render: Renderers): ModelAttempt {
  const R = views(render)
  const s = sampleModel(model.parts, n, { relief: model.relief })
  if (!s) throw new Error('The model had no usable parts. Try again.')
  const dense = sampleModel(model.parts, Math.max(600, Math.min(1200, n * 4)), { relief: model.relief })
  const spec = modelShape(model)
  const poses = model.joints?.length && R.strip ? modelPoses({ ...spec, size: 1 }, n, generateShape) : null
  return {
    name: model.name, parts: model.parts, joints: model.joints, relief: model.relief,
    image: R.views(s.points, s.colors, model.name),
    reference: dense ? R.views(dense.points, dense.colors, `${model.name}: your parts as solid surfaces`) : undefined,
    motion: poses && R.strip ? R.strip(poses, s.colors, `${model.name}: moving parts, front view`) : undefined,
    hiddenParts: s.hiddenParts,
  }
}

function attemptFromOutput(out: Model3DOutput, n: number, render: Renderers): ModelAttempt {
  const parts = partsFromOutput(out)
  return attemptFrom({ name: out.name, parts, joints: jointsFromOutput(out, parts), relief: out.relief === true }, n, render)
}

/** How far apart the drones will be, as a share of the model's size (closed surfaces; relief about 0.7×). */
function spacingHint(n: number): string {
  const frac = 1 / (0.6 * Math.sqrt(Math.max(1, n)))
  return `${n} drones: on a solid model they end up about ${Math.round(frac * 100)}% of the model's size apart (about ${Math.round(frac * 70)}% in relief); thin sheets and lines spend far fewer.`
}

/** One result from Claude, handed over as a tool call (see submit.ts). */
function structured<T extends z.ZodType>(schema: T, content: BetaContentBlockParam[], signal?: AbortSignal, tool = { name: 'submit_model', description: 'Submit the 3D model: a name, its parts and (if it moves) its joints.' }): Promise<z.infer<T>> {
  return submitObject({
    schema,
    tool,
    label: tool.name === 'submit_review' ? 'Look & fix (3D)' : '3D model',
    system: [{ type: 'text', text: MODEL3D_SYSTEM, cache_control: { type: 'ephemeral' } }],
    content,
    maxTokens: 24000,
    effort: 'high',
    signal,
    messages: { refusal: 'Claude declined to build that model. Try describing it differently.', tooLong: 'The model got too complex. Try a simpler description.', unreadable: 'Couldn’t read the model. Try again.' },
  })
}

export async function generateModel(description: string, n: number, render: Renderers, signal?: AbortSignal): Promise<ModelAttempt> {
  const out = await structured(Model3DOutput, [{ type: 'text', text: `Build a 3D drone formation of: ${description.trim()}\nDrone budget: ${spacingHint(n)}` }], signal)
  return attemptFromOutput(out, n, render)
}

/**
 * One look-and-fix round: Claude sees what it modelled, the drones from four
 * angles and (for moving parts) the motion, and either approves (returns
 * null — the attempt is marked good) or returns a fix.
 */
export async function lookAndFix(description: string, attempt: ModelAttempt, n: number, render: Renderers, opts: { feedback?: string; signal?: AbortSignal } = {}): Promise<{ critique: string; next: ModelAttempt | null }> {
  const model = { name: attempt.name, relief: attempt.relief, parts: attempt.parts, joints: attempt.joints }
  const content: BetaContentBlockParam[] = [
    { type: 'text', text: `The formation should depict: ${description.trim()}\nDrone budget: ${spacingHint(n)}` },
    { type: 'text', text: `Your current model:\n${JSON.stringify(model)}` },
  ]
  if (attempt.reference) {
    content.push({ type: 'text', text: 'What you modelled, as solid surfaces (four angles):' })
    content.push({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: attempt.reference } })
  }
  content.push({ type: 'text', text: `How it actually comes out as ${n} drones, from four angles (drones further away are dimmer):` })
  content.push({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: attempt.image } })
  if (attempt.motion) {
    content.push({ type: 'text', text: 'The moving parts, front view: at rest and at both ends of the motion:' })
    content.push({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: attempt.motion } })
  }
  if (attempt.hiddenParts.length) content.push({ type: 'text', text: `Parts ${attempt.hiddenParts.join(', ')} (0-based) produce no drones: they are buried inside other parts or invalid.` })
  content.push({
    type: 'text',
    text: opts.feedback?.trim()
      ? `The designer asks: ${opts.feedback.trim()}\nApply that, fix anything else that doesn't read, and return the improved model (done = false).`
      : [
          'Judge the drones as the audience would, mostly from the front. Compare them with what you modelled:',
          '- Is it instantly recognisable? Silhouette and proportions right?',
          '- Did the defining features survive as drones (eyes, beak, ears, windows, petals…)? Make thin features sheets or lines, give single-drone details a contrasting colour.',
          '- Parts that float, don’t connect, or vanish inside others? Muddy or dark colours? Neighbouring parts the same colour where they should separate?',
          '- If it doesn’t turn, would relief make the front clearer?',
          ...(attempt.motion ? ['- Moving parts: hinged at the right place, moving the right way, mirrored pairs together?'] : []),
          'If it already reads clearly, set done = true and return the model unchanged. Otherwise return an improved model.',
        ].join('\n'),
  })
  const review = await structured(ModelReview, content, opts.signal, { name: 'submit_review', description: 'Submit your review of the drones as built: the critique, whether it is done, and (if not) the corrected model.' })
  if (review.done && !opts.feedback?.trim()) return { critique: review.critique, next: null }
  return { critique: review.critique, next: attemptFromOutput({ ...review.model, name: review.model.name || attempt.name }, n, render) }
}

/**
 * Generate, then look and fix up to `rounds` times or until Claude is
 * satisfied. `onUpdate` receives the attempts after every step.
 */
export async function createModel(description: string, opts: { n: number; rounds: number; render: Renderers; onUpdate?: (attempts: ModelAttempt[], busy: 'generating' | 'looking' | null) => void; signal?: AbortSignal }): Promise<ModelAttempt[]> {
  const attempts: ModelAttempt[] = []
  const emit = (busy: 'generating' | 'looking' | null) => opts.onUpdate?.(attempts.map((a) => ({ ...a })), busy)
  emit('generating')
  attempts.push(await generateModel(description, opts.n, opts.render, opts.signal))
  for (let round = 0; round < opts.rounds; round++) {
    emit('looking')
    const current = attempts[attempts.length - 1]!
    const { critique, next } = await lookAndFix(description, current, opts.n, opts.render, { signal: opts.signal })
    current.critique = critique
    current.verdict = next ? 'fixed' : 'good'
    if (!next) break
    attempts.push(next)
  }
  emit(null)
  return attempts
}
