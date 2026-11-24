// AI 3D models with "look and fix".
//
// 1. Claude builds the model from solid parts (structured output).
// 2. The engine turns it into drones; we render those drones from four angles.
// 3. Claude looks at the renders, says what's wrong, and returns a corrected
//    model — or declares it done. Repeat for a few rounds; the designer can add
//    their own feedback for further rounds.

import { z } from 'zod'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import type { BetaContentBlockParam } from '@anthropic-ai/sdk/resources/beta/messages/messages'
import type { ModelPart, ShapeSpec } from '@/core/types'
import { MAX_PARTS, sampleModel } from '@/core/model3d'
import { modelPart } from '@/core/serialize'
import { RefusalError, baseParams, getClient, recordUsage } from './client'

const vec3 = z.array(z.number()).describe('[x, y, z]')

export const PartInput = z.object({
  type: z.enum(['sphere', 'ellipsoid', 'box', 'cylinder', 'cone', 'capsule', 'torus']),
  name: z.string().optional().describe('What this part is, e.g. "left wing"'),
  color: z.string().describe('Hex colour, e.g. "#ff3366"'),
  center: vec3.optional().describe('sphere, ellipsoid, box, torus'),
  radius: z.number().optional().describe('sphere; cylinder; capsule; cone base; torus ring radius'),
  radii: vec3.optional().describe('ellipsoid semi-axes before rotation'),
  size: vec3.optional().describe('box width, height, depth before rotation'),
  from: vec3.optional().describe('cylinder, capsule, cone: start point (cone base)'),
  to: vec3.optional().describe('cylinder, capsule, cone: end point (cone tip)'),
  radius_top: z.number().optional().describe('cone radius at `to` (0 = pointed)'),
  tube: z.number().optional().describe('torus tube radius'),
  rotation: vec3.optional().describe('ellipsoid, box, torus: degrees about x, then y, then z'),
})

export const Model3DOutput = z.object({
  name: z.string().describe('Short name, e.g. "Hot-air balloon"'),
  parts: z.array(PartInput),
})
export type Model3DOutput = z.infer<typeof Model3DOutput>

export const ModelReview = z.object({
  critique: z.string().describe('What reads well and what is wrong, in one to three sentences, for the designer'),
  done: z.boolean().describe('true only if the drones already read clearly as the description (and any designer feedback is satisfied); then return the model unchanged'),
  model: Model3DOutput,
})

export const MODEL3D_SYSTEM = `You build 3D models for drone light shows out of solid primitive parts. Each model becomes a shell of a few hundred points of coloured light (drones a few metres apart), seen from far away at night, often turning slowly.

Coordinates: y is up, x is the audience's right, and z points toward the audience — the front of the model faces +z. Use any units; aim for the model to span roughly −1 to 1. It is rescaled automatically.

Parts (all solid; drones go on the outer surface of their union):
- sphere: center, radius
- ellipsoid: center, radii, rotation
- box: center, size, rotation
- cylinder: from, to, radius
- cone: from (base), to (tip), radius, radius_top (0 = pointed; >0 = truncated)
- capsule: from, to, radius — rounded rods: limbs, stems, handles, letter strokes
- torus: center, radius, tube, rotation — a ring lying flat in the XZ plane; rotation [90, 0, 0] stands it up facing the audience
Rotations are degrees about x, then y, then z.

Designing for drones:
- Bold volumes with a silhouette that reads from the front; enough depth to look 3D when it turns.
- Anything thinner than about a tenth of the model's size gets only a few drones and can vanish: exaggerate thin features (antennas, legs, tails, handles).
- Parts must touch or overlap to read as one object.
- A part entirely inside another part produces no drones.
- 4–30 parts. Bright, saturated colours (they become the light colours); never black or very dark.`

export interface ModelAttempt {
  name: string
  parts: ModelPart[]
  /** Four-view render of the drones (PNG base64). */
  image: string
  /** Parts that produced no drones (buried or invalid). */
  hiddenParts: number[]
  /** Claude's verdict after looking at this attempt (filled in when reviewed). */
  critique?: string
  verdict?: 'good' | 'fixed'
  feedback?: string
}

export type Renderer = (points: Float32Array, colors: Float32Array | null, title: string) => string

export function partsFromOutput(out: Model3DOutput): ModelPart[] {
  return out.parts
    .map((p) => modelPart({ ...p, radiusTop: p.radius_top }))
    .filter((p): p is ModelPart => !!p)
    .slice(0, MAX_PARTS)
}

/** Shape spec for a scene layer (sized to safe spacing afterwards). */
export function modelShape(a: { name: string; parts: ModelPart[] }): Extract<ShapeSpec, { kind: 'model' }> {
  return { kind: 'model', size: 1, name: a.name.slice(0, 40) || '3D model', parts: a.parts }
}

function makeAttempt(name: string, parts: ModelPart[], n: number, render: Renderer): ModelAttempt {
  const s = sampleModel(parts, n)
  if (!s) throw new Error('The model had no usable parts. Try again.')
  return { name, parts, image: render(s.points, s.colors, name), hiddenParts: s.hiddenParts }
}

async function structured<T extends z.ZodType>(schema: T, content: BetaContentBlockParam[], signal?: AbortSignal): Promise<z.infer<T>> {
  const stream = getClient().beta.messages.stream(
    {
      ...baseParams(),
      max_tokens: 16000,
      system: [{ type: 'text', text: MODEL3D_SYSTEM, cache_control: { type: 'ephemeral' } }],
      output_config: { effort: 'medium', format: zodOutputFormat(schema) },
      messages: [{ role: 'user', content }],
    },
    { signal },
  )
  const msg = await stream.finalMessage()
  recordUsage(msg.usage)
  if (msg.stop_reason === 'refusal') throw new RefusalError('Claude declined to build that model. Try describing it differently.')
  if (msg.stop_reason === 'max_tokens') throw new Error('The model got too complex. Try a simpler description.')
  const text = msg.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('')
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new Error('Couldn’t read the model. Try again.')
  }
  const parsed = schema.safeParse(raw)
  if (!parsed.success) throw new Error('Couldn’t read the model. Try again.')
  return parsed.data
}

export async function generateModel(description: string, n: number, render: Renderer, signal?: AbortSignal): Promise<ModelAttempt> {
  const out = await structured(Model3DOutput, [{ type: 'text', text: `Build a 3D drone formation of: ${description.trim()}` }], signal)
  return makeAttempt(out.name, partsFromOutput(out), n, render)
}

/**
 * One look-and-fix round: Claude sees the drones from four angles and either
 * approves (returns null — the attempt is marked good) or returns a fix.
 */
export async function lookAndFix(description: string, attempt: ModelAttempt, n: number, render: Renderer, opts: { feedback?: string; signal?: AbortSignal } = {}): Promise<{ critique: string; next: ModelAttempt | null }> {
  const model = { name: attempt.name, parts: attempt.parts }
  const content: BetaContentBlockParam[] = [
    { type: 'text', text: `The formation should depict: ${description.trim()}` },
    { type: 'text', text: `Your current model:\n${JSON.stringify(model)}` },
    { type: 'text', text: `This is how it comes out as ${n} drones, from four angles (drones further away are dimmer):` },
    { type: 'image', source: { type: 'base64', media_type: 'image/png', data: attempt.image } },
  ]
  if (attempt.hiddenParts.length) content.push({ type: 'text', text: `Parts ${attempt.hiddenParts.join(', ')} (0-based) produce no drones: they are buried inside other parts or invalid.` })
  content.push({
    type: 'text',
    text: opts.feedback?.trim()
      ? `The designer asks: ${opts.feedback.trim()}\nApply that, fix anything else that doesn't read, and return the improved model (done = false).`
      : 'Look at it as an audience would, mostly from the front. Is it instantly recognisable? Check proportions, missing or extra parts, parts that float or don’t connect, and thin features that got too few drones. If it already reads clearly, set done = true and return the model unchanged. Otherwise return an improved model.',
  })
  const review = await structured(ModelReview, content, opts.signal)
  if (review.done && !opts.feedback?.trim()) return { critique: review.critique, next: null }
  return { critique: review.critique, next: makeAttempt(review.model.name || attempt.name, partsFromOutput(review.model), n, render) }
}

/**
 * Generate, then look and fix up to `rounds` times or until Claude is
 * satisfied. `onUpdate` receives the attempts after every step.
 */
export async function createModel(description: string, opts: { n: number; rounds: number; render: Renderer; onUpdate?: (attempts: ModelAttempt[], busy: 'generating' | 'looking' | null) => void; signal?: AbortSignal }): Promise<ModelAttempt[]> {
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
