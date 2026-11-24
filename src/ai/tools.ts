// Tools the copilot can call. Each validates its input (zod), edits the show
// through the same safe paths the UI uses, and reports the resulting safety
// status so the model sees the consequences of its edits.

import { z } from 'zod'
import type { BetaToolResultBlockParam, BetaToolUnion } from '@anthropic-ai/sdk/resources/beta/messages/messages'
import type { LightCue, Scene, ShapeSpec, ShowDoc } from '@/core/types'
import { getState } from '@/state/store'
import { compile } from '@/core/compile'
import { validate } from '@/core/validate'
import { comfortableSpacing } from '@/core/validate'
import { fitScene, fitToAirspace, newId } from '@/core/defaults'
import { alignScenesToBars } from '@/core/music'
import { autoFix } from '@/core/fixes'
import { ceilTo } from '@/core/math'
import { defaultEffect } from '@/core/effects'
import { CueTiming, IdleMotionInput, LightInput, SceneInput, ShapeInput, SpareRoleInput } from './schemas'
import { cueFromInput, effectFromInput, motionFromInput, sceneFromInput, shapeFromInput, withSpareRole } from './convert'
import { calmMotion } from '@/core/idle'
import { describeMusic, summarizeShow } from './context'
import { contactSheet, fourViews } from './render'
import { createModel, lookAndFix, modelShape } from './model3d'
import { sampleModel } from '@/core/model3d'
import { allocate, scenePointColors } from '@/core/compile'
import { describeToShape } from './shapeGen'

export type ToolContent = BetaToolResultBlockParam['content']

export interface ToolOutcome {
  content: ToolContent
  /** One line for the chat card. */
  summary: string
  error?: boolean
}

interface ToolDef<S extends z.ZodType> {
  name: string
  description: string
  schema: S
  /** Card title while running. */
  label: (input: z.infer<S>) => string
  run: (input: z.infer<S>, ctx: { signal?: AbortSignal }) => Promise<ToolOutcome> | ToolOutcome
}

function tool<S extends z.ZodType>(d: ToolDef<S>): ToolDef<S> {
  return d
}

class ToolError extends Error {}

const doc = () => getState().doc

function findScene(id: string): { scene: Scene; index: number } {
  const index = doc().scenes.findIndex((s) => s.id === id)
  if (index < 0) throw new ToolError(`No scene with id "${id}". Call get_show for current ids.`)
  return { scene: doc().scenes[index]!, index }
}

function findCue(id: string): LightCue {
  const q = doc().cues.find((c) => c.id === id)
  if (!q) throw new ToolError(`No light cue with id "${id}". Call get_show for current ids.`)
  return q
}

function replaceScene(index: number, scene: Scene, label: string) {
  getState().update((d) => { d.scenes[index] = scene as typeof d.scenes[number] }, label)
}

/** One line describing the show's safety after an edit. */
export function safetyLine(d: ShowDoc = doc()): string {
  const v = validate(d, compile(d))
  if (!v.issues.length) return `Safety: all checks pass (closest approach ${v.stats.minDistance.toFixed(2)} m).`
  return `Safety: ${v.issues.length} issue(s) — ${v.issues.slice(0, 4).map((i) => `${i.title}${i.fix ? ` [fix: ${i.fix.label}]` : ''}`).join('; ')}${v.issues.length > 4 ? '; …' : ''}`
}

function ok(summary: string, detail?: string): ToolOutcome {
  return { summary, content: `${detail ?? summary}\n${safetyLine()}` }
}

async function resolveCustom(shape: z.infer<typeof ShapeInput>, signal?: AbortSignal): Promise<ShapeSpec | null> {
  if (shape.kind !== 'custom' && shape.kind !== 'model3d') return null
  if (!shape.description?.trim()) throw new ToolError(`A ${shape.kind} shape needs a description.`)
  if (shape.kind === 'custom') return (await describeToShape(shape.description, signal)).shape
  // 3D: generate, then one look-and-fix round.
  const attempts = await createModel(shape.description, { n: doc().droneCount, rounds: 1, render: fourViews, signal })
  return modelShape(attempts[attempts.length - 1]!)
}

const sceneRef = z.string().describe('Scene id, e.g. "scene_abc123" (from get_show or <show_state>)')

// --- Tool definitions ----------------------------------------------------------------

export const TOOLS = [
  tool({
    name: 'get_show',
    description: 'Get the complete current show: every scene with its id, shape, size, light, timing and position; light cues with ids; music; safety issues. Call it when you need ids or details, or if the user may have edited the show since <show_state>.',
    schema: z.object({}),
    label: () => 'Reading the show',
    run: () => ({ summary: 'Read the show', content: summarizeShow(doc()) }),
  }),
  tool({
    name: 'get_music',
    description: 'Get the music structure: tempo, bar start times in show time with loudness (0–9), and quiet/medium/loud sections. Call it before timing scenes or light cues to the music.',
    schema: z.object({}),
    label: () => 'Listening to the music',
    run: () => ({ summary: 'Read the music structure', content: describeMusic(doc()) }),
  }),
  tool({
    name: 'look_at_scenes',
    description: 'See formations as images: front view (as the audience sees them) in their opening colours; grey dots are drones with lights off. Use it to judge readability of text, how a custom shape came out, colour choices, or before giving a creative review.',
    schema: z.object({
      scene_ids: z.array(z.string()).optional().describe('Scenes to look at (default: all, up to 12)'),
      all_angles: z.boolean().optional().describe('Also show front, side, top and three-quarter views (up to 3 scenes) — use for 3D formations'),
    }),
    label: (i) => (i.scene_ids?.length ? `Looking at ${i.scene_ids.length} scene${i.scene_ids.length > 1 ? 's' : ''}${i.all_angles ? ' from all sides' : ''}` : 'Looking at the scenes'),
    run: (i) => {
      const d = doc()
      const compiled = compile(d)
      if (i.all_angles) {
        const list = compiled.scenes.filter((cs) => !i.scene_ids?.length || i.scene_ids.includes(cs.id)).slice(0, 3)
        if (!list.length) throw new ToolError('There are no scenes to look at.')
        return {
          summary: `Looked at ${list.length} scene${list.length > 1 ? 's' : ''} from all sides`,
          content: list.flatMap((cs) => [
            { type: 'text' as const, text: `Scene ${cs.index + 1} "${d.scenes[cs.index]!.name}" from four angles (dimmer = further away):` },
            { type: 'image' as const, source: { type: 'base64' as const, media_type: 'image/png' as const, data: fourViews(cs.points, scenePointColors(cs), d.scenes[cs.index]!.name) } },
          ]),
        }
      }
      const sheet = contactSheet(d, compiled, i.scene_ids)
      if (!sheet) throw new ToolError('There are no scenes to look at.')
      return {
        summary: `Looked at ${sheet.count} scene${sheet.count > 1 ? 's' : ''}`,
        content: [
          { type: 'text', text: `${sheet.count} formation(s), front view, opening colours, each tile labelled with its scene number and name.` },
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: sheet.data } },
        ],
      }
    },
  }),
  tool({
    name: 'add_scene',
    description: 'Add a new formation. It is automatically sized to safe drone spacing and placed inside the airspace. Use shape kind "custom" with a description for any picture that is not a built-in shape (it is drawn for you).',
    schema: z.object({
      scene: SceneInput,
      after_scene_id: z.string().optional().describe('Insert after this scene (default: at the end); use "start" to insert first'),
    }),
    label: (i) => `Adding “${i.scene.name}”`,
    run: async (i, ctx) => {
      const custom = await resolveCustom(i.scene.shape, ctx.signal)
      const input = custom && i.scene.light.effect === 'solid' && !i.scene.light.color ? { ...i.scene, light: { ...i.scene.light, effect: 'image' as const } } : i.scene
      const scene = sceneFromInput(doc(), input, { custom })
      const at = i.after_scene_id === 'start' ? 0 : i.after_scene_id ? findScene(i.after_scene_id).index + 1 : doc().scenes.length
      getState().update((d) => { d.scenes.splice(at, 0, scene as typeof d.scenes[number]) }, `Add ${scene.name}`)
      const main = scene.layers[0]!
      return ok(`Added “${scene.name}” as scene ${at + 1}`, `Added scene ${at + 1} [${scene.id}] "${scene.name}": ${main.shape.kind}, size ${main.shape.size} m${scene.layers.length > 1 ? `, ${scene.layers.length - 1} extra layer(s)` : ''}.`)
    },
  }),
  tool({
    name: 'edit_scene',
    description: 'Change a scene’s name, timing, placement, rotation, spin, idle motion, spare drones or overall size. Sizes can only grow beyond the safe minimum; flights can be set longer than their fastest safe time but never shorter.',
    schema: z.object({
      scene_id: sceneRef,
      name: z.string().optional(),
      hold_seconds: z.number().optional(),
      flight: z.union([z.literal('auto'), z.number()]).optional().describe('Flight-in duration in seconds, or "auto" for the comfortable safe default'),
      dim_flight: z.boolean().optional(),
      spin: z.number().optional().describe('Degrees per second while held'),
      tilt: z.number().optional(),
      turn: z.number().optional(),
      roll: z.number().optional(),
      x: z.number().optional().describe('Centre across (m, 0 = middle)'),
      altitude: z.number().optional().describe('Centre altitude (m)'),
      z: z.number().optional().describe('Centre depth (m, positive = toward the audience)'),
      size_scale: z.number().optional().describe('Multiply the formation size, e.g. 1.2 = 20% larger, 0.8 = smaller (never below safe spacing)'),
      idle_motion: IdleMotionInput.optional(),
      spare_role: SpareRoleInput.optional().describe('Give the scene’s spare drones a role (adds 25% spares if it has none)'),
    }),
    label: () => 'Editing a scene',
    run: (i) => {
      const { scene, index } = findScene(i.scene_id)
      const s: Scene = JSON.parse(JSON.stringify(scene))
      const changes: string[] = []
      if (i.name !== undefined) { s.name = i.name.slice(0, 60); changes.push(`name “${s.name}”`) }
      if (i.hold_seconds !== undefined) { s.hold = Math.max(0, Math.min(600, i.hold_seconds)); changes.push(`hold ${s.hold} s`) }
      if (i.flight !== undefined) { s.flight.duration = i.flight === 'auto' ? null : Math.max(0, Math.min(600, i.flight)); changes.push(`flight ${i.flight === 'auto' ? 'auto' : `${s.flight.duration} s`}`) }
      if (i.dim_flight !== undefined) { s.flight.dim = i.dim_flight; changes.push(i.dim_flight ? 'dimmed flight' : 'lit flight') }
      if (i.spin !== undefined) { s.spin = Math.max(-90, Math.min(90, i.spin)); changes.push(`spin ${s.spin}°/s`) }
      if (i.tilt !== undefined) s.rotation[0] = i.tilt
      if (i.turn !== undefined) s.rotation[1] = i.turn
      if (i.roll !== undefined) s.rotation[2] = i.roll
      if (i.tilt !== undefined || i.turn !== undefined || i.roll !== undefined) changes.push(`rotation ${s.rotation.join('/')}°`)
      if (i.x !== undefined) s.position[0] = i.x
      if (i.altitude !== undefined) s.position[1] = i.altitude
      if (i.z !== undefined) s.position[2] = i.z
      if (i.x !== undefined || i.altitude !== undefined || i.z !== undefined) changes.push(`centre (${s.position.join(', ')})`)
      let out = s
      if (i.size_scale !== undefined && Math.abs(i.size_scale - 1) > 1e-3) {
        const k = Math.max(0.2, Math.min(4, i.size_scale))
        out = { ...s, layers: s.layers.map((l) => ({ ...l, shape: { ...l.shape, size: ceilTo(l.shape.size * k, 0.1) } as ShapeSpec, offset: l.offset.map((v) => v * k) as Scene['position'] })) }
        changes.push(`size ×${k}`)
      }
      if (i.size_scale !== undefined || i.tilt !== undefined || i.turn !== undefined || i.roll !== undefined) {
        out = fitScene(out, doc().droneCount, comfortableSpacing(doc().limits.minSpacing), 'grow')
      }
      if (i.idle_motion) {
        const m = motionFromInput(i.idle_motion)
        out = { ...out }
        if (m) out.motion = m
        else delete out.motion
        out = calmMotion(out, doc())
        changes.push(out.motion ? `idle motion ${out.motion.kind} ${out.motion.amount}${m && out.motion.amount < m.amount ? ' (calmed to the safe limit)' : ''}` : m ? 'idle motion removed: too fast for this formation even when calmed' : 'still while held')
      }
      if (i.spare_role) {
        out = withSpareRole(out, doc(), i.spare_role)
        changes.push(`spare drones: ${i.spare_role}`)
      }
      replaceScene(index, out, `Edit ${out.name}`)
      return ok(`Edited “${out.name}”: ${changes.join(', ') || 'no change'}`)
    },
  }),
  tool({
    name: 'set_shape',
    description: 'Replace the shape of a scene (or one of its layers). The new shape is fitted to safe spacing and the airspace automatically. Use kind "custom" with a description for any picture.',
    schema: z.object({ scene_id: sceneRef, layer_index: z.number().optional().describe('Default 0 (the main shape)'), shape: ShapeInput }),
    label: (i) => `Changing shape to ${i.shape.kind === 'custom' ? i.shape.description ?? 'custom' : i.shape.kind}`,
    run: async (i, ctx) => {
      const { scene, index } = findScene(i.scene_id)
      const li = Math.round(i.layer_index ?? 0)
      const layer = scene.layers[li]
      if (!layer) throw new ToolError(`Scene has ${scene.layers.length} layer(s); layer_index ${li} doesn't exist.`)
      const custom = await resolveCustom(i.shape, ctx.signal)
      const shape = custom ?? shapeFromInput(i.shape)
      const effect = custom ? defaultEffect('image') : layer.effect.kind === 'image' ? effectFromInput({ effect: 'solid' }) : layer.effect
      let s: Scene = { ...scene, layers: scene.layers.map((l, k) => (k === li ? { ...l, shape, effect } : l)) }
      s = fitScene(s, doc().droneCount, comfortableSpacing(doc().limits.minSpacing), 'exact')
      const scale = Math.max(1, Math.min(4, i.shape.scale ?? 1))
      if (scale > 1.001) s = { ...s, layers: s.layers.map((l, k) => (k === li ? { ...l, shape: { ...l.shape, size: ceilTo(l.shape.size * scale, 0.1) } as ShapeSpec } : l)) }
      s = fitToAirspace(s, doc())
      replaceScene(index, s, `Change shape of ${s.name}`)
      return ok(`Changed “${s.name}” to ${custom ? `a custom drawing (${(shape as { name?: string }).name ?? ''})` : shape.kind}`, `Scene "${s.name}" layer ${li} is now ${shape.kind}${custom ? ' (custom drawing, lights use the drawing’s colours)' : ''}, size ${s.layers[li]!.shape.size} m.`)
    },
  }),
  tool({
    name: 'set_light',
    description: 'Set the base light effect of a scene (or one of its layers). For accents over time (flashes, washes, sweeps across several scenes), use add_cue instead.',
    schema: z.object({ scene_id: sceneRef, layer_index: z.number().optional(), light: LightInput }),
    label: (i) => `Setting light to ${i.light.effect}`,
    run: (i) => {
      const { scene, index } = findScene(i.scene_id)
      const li = Math.round(i.layer_index ?? 0)
      const layer = scene.layers[li]
      if (!layer) throw new ToolError(`Scene has ${scene.layers.length} layer(s); layer_index ${li} doesn't exist.`)
      if (i.light.effect === 'image' && layer.shape.kind !== 'image' && layer.shape.kind !== 'model') throw new ToolError('Shape colours (effect "image") only work on image, custom and 3D model formations.')
      const effect = effectFromInput(i.light)
      replaceScene(index, { ...scene, layers: scene.layers.map((l, k) => (k === li ? { ...l, effect } : l)) }, `Light for ${scene.name}`)
      return ok(`Set “${scene.name}” light: ${i.light.effect}`)
    },
  }),
  tool({
    name: 'improve_3d_model',
    description: 'Look at a 3D model formation from four angles and fix what doesn’t read — optionally following the designer’s feedback (e.g. "make the wings bigger"). Only for scenes whose shape is a 3D model.',
    schema: z.object({ scene_id: sceneRef, layer_index: z.number().optional(), feedback: z.string().optional().describe('What the designer wants changed') }),
    label: (i) => (i.feedback ? `Improving the 3D model: ${i.feedback}` : 'Looking at the 3D model and fixing it'),
    run: async (i, ctx) => {
      const { scene, index } = findScene(i.scene_id)
      const li = Math.round(i.layer_index ?? 0)
      const layer = scene.layers[li]
      if (!layer || layer.shape.kind !== 'model') throw new ToolError('That layer is not a 3D model. Use set_shape with kind "model3d" to create one.')
      const shape = layer.shape
      const count = allocate(doc().droneCount, scene.layers.map((l) => l.weight))[li]!
      const current = sampleModel(shape.parts, count)
      if (!current) throw new ToolError('The current model has no usable parts.')
      const attempt = { name: shape.name, parts: shape.parts, image: fourViews(current.points, current.colors, shape.name), hiddenParts: current.hiddenParts }
      const { critique, next } = await lookAndFix(shape.name, attempt, count, fourViews, { feedback: i.feedback, signal: ctx.signal })
      if (!next) return { summary: `Looks right: ${critique}`, content: `No change needed. ${critique}\n${safetyLine()}` }
      let s: Scene = { ...scene, layers: scene.layers.map((l, k) => (k === li ? { ...l, shape: { ...shape, name: next.name, parts: next.parts } } : l)) }
      s = fitToAirspace(fitScene(s, doc().droneCount, comfortableSpacing(doc().limits.minSpacing), 'exact'), doc())
      replaceScene(index, s, `Improve ${shape.name}`)
      return {
        summary: `Improved the 3D model: ${critique}`,
        content: [
          { type: 'text', text: `Critique of the previous version: ${critique}\nApplied an improved model (${next.parts.length} parts). The new version from four angles:` },
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: next.image } },
          { type: 'text', text: safetyLine() },
        ],
      }
    },
  }),
  tool({
    name: 'remove_scene',
    description: 'Delete a scene.',
    schema: z.object({ scene_id: sceneRef }),
    label: () => 'Removing a scene',
    run: (i) => {
      const { scene, index } = findScene(i.scene_id)
      getState().update((d) => { d.scenes.splice(index, 1) }, `Delete ${scene.name}`)
      return ok(`Removed “${scene.name}”`)
    },
  }),
  tool({
    name: 'move_scene',
    description: 'Move a scene to a new position in the order (1 = first).',
    schema: z.object({ scene_id: sceneRef, position: z.number().describe('1-based position') }),
    label: () => 'Reordering scenes',
    run: (i) => {
      const { scene, index } = findScene(i.scene_id)
      const to = Math.max(0, Math.min(doc().scenes.length - 1, Math.round(i.position) - 1))
      getState().update((d) => {
        const [item] = d.scenes.splice(index, 1)
        d.scenes.splice(to, 0, item!)
      }, 'Reorder scenes')
      return ok(`Moved “${scene.name}” to position ${to + 1}`)
    },
  }),
  tool({
    name: 'duplicate_scene',
    description: 'Copy a scene and insert the copy right after it.',
    schema: z.object({ scene_id: sceneRef, name: z.string().optional() }),
    label: () => 'Duplicating a scene',
    run: (i) => {
      const { scene, index } = findScene(i.scene_id)
      const copy: Scene = { ...JSON.parse(JSON.stringify(scene)), id: newId('scene'), name: i.name ?? `${scene.name} copy` }
      copy.layers.forEach((l) => (l.id = newId('layer')))
      getState().update((d) => { d.scenes.splice(index + 1, 0, copy as typeof d.scenes[number]) }, 'Duplicate scene')
      return ok(`Duplicated “${scene.name}”`, `Added [${copy.id}] "${copy.name}" after "${scene.name}".`)
    },
  }),
  tool({
    name: 'add_cue',
    description: 'Add a light cue: an effect played over every drone for a stretch of time, independent of formations (it can span flights and several scenes). Give either start_seconds (show time) or scene_id + offset_seconds (relative to that formation’s arrival).',
    schema: z.object({
      start_seconds: z.number().optional(),
      scene_id: z.string().optional(),
      offset_seconds: z.number().optional(),
      light: LightInput,
      ...CueTiming,
    }),
    label: (i) => `Adding a ${i.light.effect} cue`,
    run: (i) => {
      let start = i.start_seconds
      if (i.scene_id) {
        const { index } = findScene(i.scene_id)
        const t = compile(doc()).sceneTimes[index]!
        start = t.holdStart + (i.offset_seconds ?? 0)
      }
      if (start === undefined) throw new ToolError('Give start_seconds, or scene_id with offset_seconds.')
      const cue = cueFromInput(start, i.light, i)
      getState().update((d) => { d.cues.push(cue as typeof d.cues[number]) }, 'Add light cue')
      return ok(`Added a ${i.light.effect} cue at ${cue.start.toFixed(1)} s`, `Added cue [${cue.id}] ${cue.start.toFixed(2)}–${(cue.start + cue.duration).toFixed(2)} s.`)
    },
  }),
  tool({
    name: 'edit_cue',
    description: 'Change a light cue’s timing, light or blend.',
    schema: z.object({
      cue_id: z.string(),
      start_seconds: z.number().optional(),
      duration_seconds: z.number().optional(),
      light: LightInput.optional(),
      blend: CueTiming.blend.optional(),
      fade_in: z.number().optional(),
      fade_out: z.number().optional(),
    }),
    label: () => 'Editing a light cue',
    run: (i) => {
      const q = findCue(i.cue_id)
      const next = cueFromInput(i.start_seconds ?? q.start, i.light ?? { effect: 'solid' }, {
        duration_seconds: i.duration_seconds ?? q.duration, blend: i.blend ?? q.blend, fade_in: i.fade_in ?? q.fadeIn, fade_out: i.fade_out ?? q.fadeOut,
      })
      getState().update((d) => {
        const c = d.cues.find((x) => x.id === q.id)
        if (!c) return
        Object.assign(c, { start: next.start, duration: next.duration, blend: next.blend, fadeIn: next.fadeIn, fadeOut: next.fadeOut })
        if (i.light) c.effect = next.effect
      }, 'Edit light cue')
      return ok(`Edited cue at ${next.start.toFixed(1)} s`)
    },
  }),
  tool({
    name: 'remove_cue',
    description: 'Delete a light cue.',
    schema: z.object({ cue_id: z.string() }),
    label: () => 'Removing a light cue',
    run: (i) => {
      const q = findCue(i.cue_id)
      getState().update((d) => { d.cues = d.cues.filter((c) => c.id !== q.id) }, 'Delete light cue')
      return ok('Removed a light cue')
    },
  }),
  tool({
    name: 'align_to_music',
    description: 'Retime the show so every formation arrives exactly on a bar line (downbeat) and holds for whole bars while the music plays. Flights only get longer, never unsafe. Call after adding or reordering scenes when there is music.',
    schema: z.object({}),
    label: () => 'Landing formations on the beat',
    run: () => {
      if (!doc().audio) throw new ToolError('No music is loaded.')
      const { doc: next, aligned } = alignScenesToBars(doc())
      if (!aligned) return ok('No formations could be aligned (they arrive after the music ends?)')
      getState().replaceDoc(next, 'Align to music')
      return ok(`Landed ${aligned} formation${aligned > 1 ? 's' : ''} on downbeats`)
    },
  }),
  tool({
    name: 'fix_safety',
    description: 'Apply every automatic safety fix (resize dense formations, shrink formations too big for the airspace, move formations inside the limits, slow fast spins). Reports anything that still needs a decision.',
    schema: z.object({}),
    label: () => 'Fixing safety issues',
    run: () => {
      const { doc: next, applied, validation } = autoFix(doc())
      if (applied) getState().replaceDoc(next, 'Fix safety issues')
      return ok(applied ? `Applied ${applied} safety fix${applied > 1 ? 'es' : ''}` : 'Nothing to fix automatically', validation.issues.length ? `${validation.issues.length} issue(s) remain.` : 'All checks pass.')
    },
  }),
  tool({
    name: 'set_show',
    description: 'Rename the show or change the number of drones (every formation re-samples to the new count; run fix_safety afterwards).',
    schema: z.object({ name: z.string().optional(), drone_count: z.number().optional() }),
    label: () => 'Updating show settings',
    run: (i) => {
      getState().update((d) => {
        if (i.name) d.name = i.name.slice(0, 120)
        if (i.drone_count) d.droneCount = Math.max(1, Math.min(2000, Math.round(i.drone_count)))
      }, 'Show settings')
      return ok(`Updated show${i.name ? ` name “${i.name}”` : ''}${i.drone_count ? `, ${doc().droneCount} drones` : ''}`)
    },
  }),
] as const

type AnyTool = ToolDef<z.ZodType>

export function toolByName(name: string): AnyTool | undefined {
  return (TOOLS as readonly AnyTool[]).find((t) => t.name === name)
}

/** Tool definitions for the API request. */
export function toolDefinitions(eager: boolean): BetaToolUnion[] {
  return (TOOLS as readonly AnyTool[]).map((t) => {
    const { $schema: _drop, ...schema } = z.toJSONSchema(t.schema) as Record<string, unknown>
    return {
      name: t.name,
      description: t.description,
      input_schema: schema as { type: 'object'; [k: string]: unknown },
      ...(eager ? { eager_input_streaming: true } : {}),
    }
  })
}

/**
 * Validate and run one tool call. Invalid input (including input truncated by
 * eager streaming) is never executed: it comes back as an error the model can
 * correct.
 */
export async function runTool(name: string, input: unknown, signal?: AbortSignal): Promise<ToolOutcome & { label: string }> {
  const t = toolByName(name)
  if (!t) return { label: name, summary: `Unknown tool ${name}`, error: true, content: `Unknown tool "${name}".` }
  const parsed = t.schema.safeParse(input ?? {})
  if (!parsed.success) {
    return {
      label: name,
      summary: 'Invalid tool input',
      error: true,
      content: JSON.stringify({ INVALID_JSON: JSON.stringify(input), problems: parsed.error.issues.slice(0, 5).map((p) => `${p.path.join('.')}: ${p.message}`) }),
    }
  }
  const label = t.label(parsed.data)
  try {
    return { ...(await t.run(parsed.data, { signal })), label }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { label, summary: message, error: true, content: message }
  }
}

/** Card title for a tool call before it has run. */
export function toolLabel(name: string, input: unknown): string {
  const t = toolByName(name)
  if (!t) return name
  const p = t.schema.safeParse(input ?? {})
  return p.success ? t.label(p.data) : name.replace(/_/g, ' ')
}
