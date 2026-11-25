// Tools the copilot can call. Each validates its input (zod), edits the show
// through the same safe paths the UI uses, and reports the resulting safety
// status so the model sees the consequences of its edits.

import { safeSpacing } from '@/core/site'
import { z } from 'zod'
import type { BetaToolResultBlockParam, BetaToolUnion } from '@anthropic-ai/sdk/resources/beta/messages/messages'
import type { LightCue, Scene, ShapeSpec, ShowDoc } from '@/core/types'
import { getState } from '@/state/store'
import { compile } from '@/core/compile'
import { formatTime, validate } from '@/core/validate'
import { comfortableSpacing } from '@/core/validate'
import { fitScene, fitToAirspace, newId, newLayer } from '@/core/defaults'
import { alignScenesToBars } from '@/core/music'
import { MUSIC_TAG, arriveAt, composeScore, fitToSong, lightTheMusic, musicMoment } from '@/core/musicTools'
import { autoFix, tidySplit } from '@/core/fixes'
import { ceilTo } from '@/core/math'
import { defaultEffect } from '@/core/effects'
import { CueTiming, GroupInput, IdleMotionInput, KeyframeInput, LightInput, SceneInput, ShapeInput, SpareRoleInput, StepInput, TransitionInput } from './schemas'
import { type CustomShapes, applySplit, cueFromInput, keysFromInput, effectFromInput, motionFromInput, sceneFromInput, shapeFromInput, stepFromInput, transitionFromInput, withSpareRole } from './convert'
import { calmMotion } from '@/core/idle'
import { describeMusic, summarizeShow } from './context'
import { contactSheet, fourViews } from './render'
import { createModel, lookAndFix, modelShape } from './model3d'
import { sampleModel } from '@/core/model3d'
import { allocate, findSceneTime, scenePointColors } from '@/core/compile'
import { drawAndCheck } from './shapeGen'
import { MAX_CUSTOM, customJobs, resolveCustoms } from './customs'
import { findScene as findAnyScene, findGroup, groupSizes, replaceSceneIn, sceneDroneCount } from '@/core/groups'
import { groupDoc, groupSpots, splitSceneDoc } from '@/core/splits'
import { pruneGroups } from '@/core/groups'
import { ACCURACY_PRESETS, ZONE_KINDS, reanchorSite } from '@/core/site'
import { simVerdict } from '@/core/simulate'
import { runSimAsync } from '@/state/sim'
import { play, seek } from '@/state/playback'

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

/**
 * A scene or group step by id. `index` is the main scene's position (-1 for
 * a group step); `sub` is the document as the scene sees it (a group step
 * has only its group's drones).
 */
function findScene(id: string): { scene: Scene; index: number; sub: ShowDoc; step: boolean } {
  const ref = findAnyScene(doc(), id)
  if (!ref) throw new ToolError(`No scene with id "${id}". Call get_show for current ids.`)
  const n = sceneDroneCount(doc(), id)
  return { scene: ref.scene, index: ref.group ? -1 : ref.index, sub: n === doc().droneCount ? doc() : { ...doc(), droneCount: n }, step: !!ref.group }
}

function findMainScene(id: string): { scene: Scene; index: number } {
  const r = findScene(id)
  if (r.step) throw new ToolError('That is a formation inside a group; this only works on main scenes. Use remove_scene / edit_scene on group formations, or add_group_step.')
  return r
}

function findCue(id: string): LightCue {
  const q = doc().cues.find((c) => c.id === id)
  if (!q) throw new ToolError(`No light cue with id "${id}". Call get_show for current ids.`)
  return q
}

function replaceScene(id: string, scene: Scene, label: string) {
  getState().update((d) => { replaceSceneIn(d as ShowDoc, id, scene) }, label)
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

async function resolveCustom(shape: z.infer<typeof ShapeInput>, signal?: AbortSignal, n = doc().droneCount): Promise<ShapeSpec | null> {
  if (shape.kind !== 'custom' && shape.kind !== 'model3d') return null
  if (!shape.description?.trim()) throw new ToolError(`A ${shape.kind} shape needs a description.`)
  if (shape.kind === 'custom') return (await drawAndCheck(shape.description, n, signal)).shape
  // 3D: generate, then one look-and-fix round.
  const attempts = await createModel(shape.description, { n, rounds: 1, render: fourViews, signal })
  return modelShape(attempts[attempts.length - 1]!)
}

/** Custom drawings and 3D models anywhere in these scenes (main, extra shapes, group formations), up to 10. */
async function customsFor(scenes: (SceneInput | StepInput)[], drones: number, signal?: AbortSignal): Promise<{ customs: CustomShapes; note: string }> {
  const jobs = customJobs(scenes, drones)
  if (!jobs.length) return { customs: new Map(), note: '' }
  const r = await resolveCustoms(jobs, signal)
  const parts = [
    r.failed ? `${r.failed} custom formation(s) failed and show a placeholder sphere (${r.errors[0]})` : '',
    r.skipped ? `${r.skipped} custom formation(s) were over the limit of ${MAX_CUSTOM} per request and show a placeholder: create them in another call` : '',
  ].filter(Boolean)
  return { customs: r.customs, note: parts.length ? ` Note: ${parts.join('; ')}.` : '' }
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
    description: 'Get the music structure: tempo, the song’s sections (intro, verse, build, drop, break, outro — numbered, with show times, bars, loudness and which formations are held during each), accents (stand-out hits), bar times with loudness, and how the show length compares to the song. Call it before timing scenes or light cues to the music.',
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
      const { customs, note } = await customsFor([i.scene], doc().droneCount, ctx.signal)
      const scene = sceneFromInput(doc(), i.scene, { customs })
      const at = i.after_scene_id === 'start' ? 0 : i.after_scene_id ? findMainScene(i.after_scene_id).index + 1 : doc().scenes.length
      let next: ShowDoc = { ...doc(), scenes: [...doc().scenes.slice(0, at), scene, ...doc().scenes.slice(at)] }
      if (i.scene.split?.groups.length) next = applySplit(next, scene.id, i.scene.split, customs)
      getState().replaceDoc(next, `Add ${scene.name}`)
      const main = scene.layers[0]!
      return ok(`Added “${scene.name}” as scene ${at + 1}`, `Added scene ${at + 1} [${scene.id}] "${scene.name}": ${main.shape.kind}, size ${main.shape.size} m${scene.layers.length > 1 ? `, ${scene.layers.length - 1} extra layer(s)` : ''}.${note}`)
    },
  }),
  tool({
    name: 'edit_scene',
    description: 'Change a scene’s name, timing, placement, rotation, spin, idle motion, keyframes (moving, turning or resizing the whole formation while held), spare drones, transition style (how drones fly in) or overall size. Sizes can only grow beyond the safe minimum; flights can be set longer than their fastest safe time but never shorter.',
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
      transition: TransitionInput.optional().describe('How drones fly into this scene'),
      keyframes: z.union([z.literal('clear'), z.array(KeyframeInput)]).optional().describe('Replace the keyframes (move, turn or resize the whole formation while held; eases into each key and rests; the next flight starts from the last key), or "clear"'),
    }),
    label: () => 'Editing a scene',
    run: (i) => {
      const { scene, sub } = findScene(i.scene_id)
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
        out = fitScene(out, sub.droneCount, comfortableSpacing(safeSpacing(sub.limits)), 'grow')
      }
      if (i.idle_motion) {
        const m = motionFromInput(i.idle_motion)
        out = { ...out }
        if (m) out.motion = m
        else delete out.motion
        out = calmMotion(out, sub)
        changes.push(out.motion ? `idle motion ${out.motion.kind} ${out.motion.amount}${m && out.motion.amount < m.amount ? ' (calmed to the safe limit)' : ''}` : m ? 'idle motion removed: too fast for this formation even when calmed' : 'still while held')
      }
      if (i.transition) {
        const st = transitionFromInput(i.transition)
        out = { ...out, flight: { ...out.flight } }
        if (st) out.flight.style = st
        else delete out.flight.style
        changes.push(`transition ${i.transition.style}`)
      }
      if (i.keyframes !== undefined) {
        out = { ...out }
        if (i.keyframes === 'clear' || !i.keyframes.length) { delete out.keys; changes.push('no keyframes') }
        else { out.keys = keysFromInput(i.keyframes, out.hold); changes.push(`${out.keys.length} keyframe(s)`) }
      }
      if (i.spare_role) {
        out = withSpareRole(out, sub, i.spare_role)
        changes.push(`spare drones: ${i.spare_role}`)
      }
      replaceScene(scene.id, out, `Edit ${out.name}`)
      return ok(`Edited “${out.name}”: ${changes.join(', ') || 'no change'}`)
    },
  }),
  tool({
    name: 'set_shape',
    description: 'Replace the shape of a scene (or one of its layers). The new shape is fitted to safe spacing and the airspace automatically. Use kind "custom" with a description for any picture.',
    schema: z.object({ scene_id: sceneRef, layer_index: z.number().optional().describe('Default 0 (the main shape)'), shape: ShapeInput }),
    label: (i) => `Changing shape to ${i.shape.kind === 'custom' ? i.shape.description ?? 'custom' : i.shape.kind}`,
    run: async (i, ctx) => {
      const { scene, sub } = findScene(i.scene_id)
      const li = Math.round(i.layer_index ?? 0)
      const layer = scene.layers[li]
      if (!layer) throw new ToolError(`Scene has ${scene.layers.length} layer(s); layer_index ${li} doesn't exist.`)
      const custom = await resolveCustom(i.shape, ctx.signal, sub.droneCount)
      const shape = custom ?? shapeFromInput(i.shape)
      const effect = custom ? defaultEffect('image') : layer.effect.kind === 'image' ? effectFromInput({ effect: 'solid' }) : layer.effect
      let s: Scene = { ...scene, layers: scene.layers.map((l, k) => (k === li ? { ...l, shape, effect } : l)) }
      s = fitScene(s, sub.droneCount, comfortableSpacing(safeSpacing(sub.limits)), 'exact')
      const scale = Math.max(1, Math.min(4, i.shape.scale ?? 1))
      if (scale > 1.001) s = { ...s, layers: s.layers.map((l, k) => (k === li ? { ...l, shape: { ...l.shape, size: ceilTo(l.shape.size * scale, 0.1) } as ShapeSpec } : l)) }
      s = fitToAirspace(s, sub)
      replaceScene(scene.id, s, `Change shape of ${s.name}`)
      return ok(`Changed “${s.name}” to ${custom ? `a custom drawing (${(shape as { name?: string }).name ?? ''})` : shape.kind}`, `Scene "${s.name}" layer ${li} is now ${shape.kind}${custom ? ' (custom drawing, lights use the drawing’s colours)' : ''}, size ${s.layers[li]!.shape.size} m.`)
    },
  }),
  tool({
    name: 'set_light',
    description: 'Set the base light effect of a scene (or one of its layers). For accents over time (flashes, washes, sweeps across several scenes), use add_cue instead.',
    schema: z.object({ scene_id: sceneRef, layer_index: z.number().optional(), light: LightInput }),
    label: (i) => `Setting light to ${i.light.effect}`,
    run: (i) => {
      const { scene } = findScene(i.scene_id)
      const li = Math.round(i.layer_index ?? 0)
      const layer = scene.layers[li]
      if (!layer) throw new ToolError(`Scene has ${scene.layers.length} layer(s); layer_index ${li} doesn't exist.`)
      if (i.light.effect === 'image' && layer.shape.kind !== 'image' && layer.shape.kind !== 'model') throw new ToolError('Shape colours (effect "image") only work on image, custom and 3D model formations.')
      const effect = effectFromInput(i.light)
      replaceScene(scene.id, { ...scene, layers: scene.layers.map((l, k) => (k === li ? { ...l, effect } : l)) }, `Light for ${scene.name}`)
      return ok(`Set “${scene.name}” light: ${i.light.effect}`)
    },
  }),
  tool({
    name: 'improve_3d_model',
    description: 'Look at a 3D model formation from four angles and fix what doesn’t read — optionally following the designer’s feedback (e.g. "make the wings bigger"). Only for scenes whose shape is a 3D model.',
    schema: z.object({ scene_id: sceneRef, layer_index: z.number().optional(), feedback: z.string().optional().describe('What the designer wants changed') }),
    label: (i) => (i.feedback ? `Improving the 3D model: ${i.feedback}` : 'Looking at the 3D model and fixing it'),
    run: async (i, ctx) => {
      const { scene, sub } = findScene(i.scene_id)
      const li = Math.round(i.layer_index ?? 0)
      const layer = scene.layers[li]
      if (!layer || layer.shape.kind !== 'model') throw new ToolError('That layer is not a 3D model. Use set_shape with kind "model3d" to create one.')
      const shape = layer.shape
      const count = allocate(sub.droneCount, scene.layers.map((l) => l.weight))[li]!
      const current = sampleModel(shape.parts, count)
      if (!current) throw new ToolError('The current model has no usable parts.')
      const attempt = { name: shape.name, parts: shape.parts, image: fourViews(current.points, current.colors, shape.name), hiddenParts: current.hiddenParts }
      const { critique, next } = await lookAndFix(shape.name, attempt, count, fourViews, { feedback: i.feedback, signal: ctx.signal })
      if (!next) return { summary: `Looks right: ${critique}`, content: `No change needed. ${critique}\n${safetyLine()}` }
      let s: Scene = { ...scene, layers: scene.layers.map((l, k) => (k === li ? { ...l, shape: { ...shape, name: next.name, parts: next.parts } } : l)) }
      s = fitToAirspace(fitScene(s, sub.droneCount, comfortableSpacing(safeSpacing(sub.limits)), 'exact'), sub)
      replaceScene(scene.id, s, `Improve ${shape.name}`)
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
      const { scene } = findScene(i.scene_id)
      getState().update((d) => {
        const r = findAnyScene(d as ShowDoc, i.scene_id)
        if (!r) return
        if (r.group) r.group.steps.splice(r.index, 1)
        else d.scenes.splice(r.index, 1)
      }, `Delete ${scene.name}`)
      return ok(`Removed “${scene.name}”`)
    },
  }),
  tool({
    name: 'move_scene',
    description: 'Move a scene to a new position in the order (1 = first).',
    schema: z.object({ scene_id: sceneRef, position: z.number().describe('1-based position') }),
    label: () => 'Reordering scenes',
    run: (i) => {
      const { scene, index } = findMainScene(i.scene_id)
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
      const { scene, index } = findMainScene(i.scene_id)
      const copy: Scene = { ...JSON.parse(JSON.stringify(scene)), id: newId('scene'), name: i.name ?? `${scene.name} copy` }
      delete copy.groups
      copy.layers.forEach((l) => (l.id = newId('layer')))
      getState().update((d) => { d.scenes.splice(index + 1, 0, copy as typeof d.scenes[number]) }, 'Duplicate scene')
      return ok(`Duplicated “${scene.name}”`, `Added [${copy.id}] "${copy.name}" after "${scene.name}".`)
    },
  }),
  tool({
    name: 'split_scene',
    description: 'Splits and merges: after a scene’s hold, its drones divide into groups that each fly their own formations at their own pace; the next scene merges everyone back. Divide by shape (each layer a group), left/right halves, lower/upper halves or three columns. Groups are checked against each other (they don’t share a clock), so keep them on their own sides. mode "merge" removes the groups.',
    schema: z.object({
      scene_id: sceneRef,
      mode: z.enum(['shapes', 'halves', 'top-bottom', 'thirds', 'merge']),
      groups: z.array(GroupInput).optional().describe('Per group, in order (by layer, left→right, or lower→upper): its formations. Omit for one default formation per group.'),
    }),
    label: (i) => (i.mode === 'merge' ? 'Merging groups back' : `Splitting a scene (${i.mode})`),
    run: async (i, ctx) => {
      const { scene, step } = findScene(i.scene_id)
      if (step) throw new ToolError('Formations inside a group cannot split again; split a main scene.')
      if (i.mode === 'merge') {
        const { groups: _g, ...rest } = scene
        void _g
        replaceScene(scene.id, rest, 'Remove groups')
        return ok(`Removed the groups of “${scene.name}”`)
      }
      const base: ShowDoc = { ...doc(), scenes: doc().scenes.map((s) => (s.id === scene.id ? { ...s, groups: undefined } : s)) }
      const per = Math.max(20, Math.round(doc().droneCount / Math.max(1, i.groups?.length ?? 2)))
      const { customs, note } = i.groups?.length ? await customsFor(i.groups.flatMap((g) => g.steps), per, ctx.signal) : { customs: new Map(), note: '' }
      const next = i.groups?.length
        ? applySplit(base, scene.id, { mode: i.mode, groups: i.groups }, customs)
        : tidySplit(splitSceneDoc(base, scene.id, i.mode).doc, scene.id)
      const after = next.scenes.find((s) => s.id === scene.id)
      if (!after?.groups?.length) throw new ToolError('This scene has nothing to split (no shapes without a spare role).')
      getState().replaceDoc(next, `Split ${scene.name}`)
      const sizes = groupSizes(after, doc().droneCount)
      return ok(`Split “${scene.name}” into ${after.groups.length} groups`, `Split "${scene.name}" (${i.mode}) into groups: ${after.groups.map((g, gi) => `[${g.id}] "${g.name}" ${sizes[gi]} drones → ${g.steps.map((st) => `[${st.id}] "${st.name}"`).join(', ') || 'no formations'}`).join('; ')}.${note}`)
    },
  }),
  tool({
    name: 'add_group_step',
    description: 'Add a formation to a group’s own sequence (during a split). It is sized for the group’s drones. Place it on the group’s side (across) so groups stay apart.',
    schema: z.object({ group_id: z.string().describe('Group id from get_show'), step: StepInput, after_step_id: z.string().optional().describe('Insert after this formation of the group (default: at the end)') }),
    label: (i) => `Adding “${i.step.name}” to a group`,
    run: async (i, ctx) => {
      const f = findGroup(doc(), i.group_id)
      if (!f) throw new ToolError(`No group with id "${i.group_id}". Call get_show for current ids.`)
      const sub = groupDoc(doc(), f.parent, f.index)
      if (!sub.droneCount) throw new ToolError('That group has no drones.')
      const k = i.after_step_id ? f.group.steps.findIndex((s) => s.id === i.after_step_id) : f.group.steps.length - 1
      const prev = f.group.steps[k] ?? null
      const spot = prev ? prev.position : groupSpots(f.parent, f.parent.groups!, doc().droneCount)[f.index]!.out
      const { customs, note } = await customsFor([i.step], sub.droneCount, ctx.signal)
      const step = stepFromInput(sub, i.step, spot, customs)
      getState().update((d) => {
        const g = findGroup(d as ShowDoc, i.group_id)
        if (g) g.group.steps.splice(k + 1, 0, step)
      }, `Add ${step.name} to ${f.group.name}`)
      return ok(`Added “${step.name}” to ${f.group.name}`, `Added [${step.id}] "${step.name}" (${sub.droneCount} drones) to group "${f.group.name}".${note}`)
    },
  }),
  tool({
    name: 'edit_group',
    description: 'Rename a group, change when it sets off after the split (delay), or remove it (its drones stay in the formation).',
    schema: z.object({ group_id: z.string(), name: z.string().optional(), delay_seconds: z.number().optional(), remove: z.boolean().optional() }),
    label: () => 'Editing a group',
    run: (i) => {
      const f = findGroup(doc(), i.group_id)
      if (!f) throw new ToolError(`No group with id "${i.group_id}". Call get_show for current ids.`)
      getState().update((d) => {
        const g = findGroup(d as ShowDoc, i.group_id)
        if (!g) return
        if (i.remove) { g.parent.groups!.splice(g.index, 1); if (!g.parent.groups!.length) delete g.parent.groups; return }
        if (i.name !== undefined) g.group.name = i.name.slice(0, 40)
        if (i.delay_seconds !== undefined) g.group.delay = Math.max(0, Math.min(120, i.delay_seconds))
      }, i.remove ? `Remove ${f.group.name}` : `Edit ${f.group.name}`)
      return ok(i.remove ? `Removed group “${f.group.name}”` : `Updated group “${i.name ?? f.group.name}”`)
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
        findScene(i.scene_id)
        const t = findSceneTime(compile(doc()), i.scene_id)!
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
    name: 'light_the_music',
    description: 'Automatically light the show from the music’s structure: breathing with the loudness in quiet parts, a sweep and beat flashes building into each drop, flashes on every accent in drops, sparkle in breaks, a fade in the outro. Re-running replaces the previous automatic cues; hand-made cues stay. style "remove" deletes them.',
    schema: z.object({ style: z.enum(['bold', 'subtle', 'remove']).describe('bold: big flashes and pulses; subtle: gentler; remove: delete the automatic music cues') }),
    label: (i) => (i.style === 'remove' ? 'Removing music lighting' : `Lighting the music (${i.style})`),
    run: (i) => {
      if (!doc().audio) throw new ToolError('No music is loaded.')
      if (i.style === 'remove') {
        const before = doc().cues.length
        getState().update((d) => { d.cues = d.cues.filter((q) => q.tag !== MUSIC_TAG) }, 'Remove music lighting')
        return ok(`Removed ${before - doc().cues.length} automatic music cue(s)`)
      }
      const { doc: next, added } = lightTheMusic(doc(), i.style)
      if (!added) throw new ToolError('The song has no detectable structure to light.')
      getState().replaceDoc(next, `Light the music (${i.style})`)
      return ok(`Added ${added} cues that follow the music (${i.style})`)
    },
  }),
  tool({
    name: 'fit_to_song',
    description: 'Fit the show to the song: every formation arrives on a bar line, holds are whole bars, and holds are stretched or tightened (bar by bar) so the final formation ends with the music. Flights never get faster than safe.',
    schema: z.object({}),
    label: () => 'Fitting the show to the song',
    run: () => {
      if (!doc().audio) throw new ToolError('No music is loaded.')
      const { doc: next, endGap } = fitToSong(doc())
      getState().replaceDoc(next, 'Fit show to song')
      return ok(Math.abs(endGap) < 2.5 ? 'The show now ends with the song' : endGap > 0 ? `Fitted; the song continues ${Math.round(endGap)} s after the finale (add a scene or longer holds)` : `The show still runs ${Math.round(-endGap)} s past the song (remove a scene or shorten flights' extra time)`)
    },
  }),
  tool({
    name: 'compose_score',
    description: 'Compose an original score to the show (when the client has no song, or for a preview): every arrival moves onto a bar line, and the music builds up and drops exactly as each hero formation arrives, goes quiet on breaks, and ends with the landing. Replaces any loaded music (the user can undo). Automatic music lighting is refreshed if present. Call again after changing scenes so the score follows the show.',
    schema: z.object({
      drops_at: z.array(sceneRef).optional().describe('Hero formations the music drops on (2–5; default every other formation)'),
      breaks_at: z.array(sceneRef).optional().describe('Tender, quiet moments'),
      bpm: z.number().optional().describe('Tempo 80–140 (default 120)'),
    }),
    label: () => 'Composing a score to the show',
    run: (i) => {
      if (!doc().scenes.length) throw new ToolError('The show has no formations yet.')
      const before = doc()
      const idx = (ids?: string[]) => ids?.map((id) => findMainScene(id).index)
      const { doc: next, plan } = composeScore(before, { bpm: i.bpm, heroes: i.drops_at?.length ? idx(i.drops_at) : undefined, breaks: idx(i.breaks_at) })
      if (!plan) throw new ToolError('Nothing to compose to.')
      const relit = before.cues.some((q) => q.tag === MUSIC_TAG) ? lightTheMusic(next, 'subtle').doc : next
      getState().replaceDoc(relit, 'Compose a score')
      const drops = plan.sections.filter((s) => s.label === 'drop').length
      return ok(`Composed ${formatTime(plan.duration)} at ${plan.bpm} BPM: ${plan.sections.map((s) => s.label).join(' → ')} (${drops} drop${drops === 1 ? '' : 's'}); every arrival is on a bar${before.audio && !before.audio.generated ? `; replaced “${before.audio.name}”` : ''}`)
    },
  }),
  tool({
    name: 'land_on_music',
    description: 'Make a formation arrive exactly at a moment in the music: the start of a section (1-based index from get_music), a bar (1-based), or a show time. Adjusts the previous formation’s hold (and this flight’s length if needed, never faster than safe); later formations shift with it. Reports the arrival actually achieved.',
    schema: z.object({
      scene_id: sceneRef,
      section: z.number().optional().describe('1-based section index from get_music'),
      bar: z.number().optional().describe('1-based bar number'),
      time: z.number().optional().describe('Show time in seconds'),
    }),
    label: () => 'Landing a formation on the music',
    run: (i) => {
      const { index, scene } = findMainScene(i.scene_id)
      const t = musicMoment(doc(), { section: i.section !== undefined ? Math.round(i.section) - 1 : undefined, bar: i.bar, time: i.time })
      if (t === null) throw new ToolError('That section or bar does not exist (call get_music for the list).')
      const { doc: next, arrival } = arriveAt(doc(), index, t)
      getState().replaceDoc(next, `Land ${scene.name} on the music`)
      const off = arrival - t
      return ok(Math.abs(off) < 0.05 ? `“${scene.name}” now arrives at ${t.toFixed(1)} s` : `“${scene.name}” arrives at ${arrival.toFixed(1)} s — ${off.toFixed(1)} s ${off > 0 ? 'late (its flight cannot be faster safely; move it to a later moment or shorten earlier holds)' : 'early'}`)
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
    description: 'Show-wide settings: name, number of drones, where the audience stands, when the music starts, the fleet’s safety limits (spacing, speeds, acceleration, jerk, battery), the airspace (floor, ceiling, radius), takeoff (pad spacing, climb height), landing (nearest pad or own pad) and the flight home (transition, dimming, duration). Change limits only when the user gives their fleet’s real values. Every formation re-checks; run fix_safety afterwards if issues appear.',
    schema: z.object({
      name: z.string().optional(),
      drone_count: z.number().optional(),
      audience_distance: z.number().optional().describe('Metres from the show centre to the audience'),
      music_offset_seconds: z.number().optional().describe('Show time at which the music starts'),
      limits: z.object({
        min_spacing: z.number().optional().describe('Minimum distance between drones (m)'),
        max_speed: z.number().optional().describe('Horizontal m/s'),
        max_climb: z.number().optional().describe('m/s'),
        max_descent: z.number().optional().describe('m/s'),
        max_accel: z.number().optional().describe('m/s²'),
        max_jerk: z.number().optional().describe('m/s³'),
        floor: z.number().optional().describe('Lowest altitude for formations (m)'),
        ceiling: z.number().optional().describe('Highest altitude (m)'),
        radius: z.number().optional().describe('Horizontal limit from the centre (m)'),
        battery_minutes: z.number().optional().describe('Total flight time budget'),
      }).optional(),
      takeoff: z.object({
        pad_spacing: z.number().optional().describe('Distance between takeoff pads (m)'),
        climb_height: z.number().optional().describe('Height drones climb to before the first flight (m)'),
        landing: z.enum(['any', 'home']).optional().describe('any: each drone lands on the nearest free pad; home: its own pad'),
      }).optional(),
      return_flight: z.object({
        transition: TransitionInput.optional(),
        dim: z.boolean().optional(),
        seconds: z.union([z.literal('auto'), z.number()]).optional(),
      }).optional(),
    }),
    label: () => 'Updating show settings',
    run: (i) => {
      const changes: string[] = []
      const c = (lo: number, hi: number, v: number) => Math.max(lo, Math.min(hi, v))
      getState().update((d) => {
        if (i.name) { d.name = i.name.slice(0, 120); changes.push(`name “${d.name}”`) }
        if (i.drone_count) { d.droneCount = Math.round(c(1, 2000, i.drone_count)); changes.push(`${d.droneCount} drones`) }
        if (i.audience_distance !== undefined) { d.site.audienceDistance = c(10, 5000, i.audience_distance); changes.push(`audience at ${d.site.audienceDistance} m`) }
        if (i.music_offset_seconds !== undefined && d.audio) { d.audio.offset = c(0, 3600, i.music_offset_seconds); changes.push(`music starts at ${formatTime(d.audio.offset)}`) }
        const L = i.limits
        if (L) {
          const set = (k: keyof typeof d.limits, v: number | undefined, lo: number, hi: number, label: string, scale = 1) => {
            if (v === undefined) return
            ;(d.limits as unknown as Record<string, number>)[k] = c(lo, hi, v) * scale
            changes.push(`${label} ${v}`)
          }
          set('minSpacing', L.min_spacing, 0.3, 50, 'min spacing')
          set('maxSpeedH', L.max_speed, 0.5, 50, 'max speed')
          set('maxSpeedUp', L.max_climb, 0.5, 50, 'max climb')
          set('maxSpeedDown', L.max_descent, 0.5, 50, 'max descent')
          set('maxAccel', L.max_accel, 0.5, 50, 'max accel')
          set('maxJerk', L.max_jerk, 0.5, 500, 'max jerk')
          set('minAltitude', L.floor, 0, 1000, 'floor')
          set('maxAltitude', L.ceiling, 5, 5000, 'ceiling')
          set('maxRadius', L.radius, 10, 10000, 'radius')
          set('maxFlightTime', L.battery_minutes, 1, 600, 'battery (min)', 60)
        }
        if (i.takeoff) {
          if (i.takeoff.pad_spacing !== undefined) { d.site.gridSpacing = c(0.5, 100, i.takeoff.pad_spacing); changes.push(`pads ${d.site.gridSpacing} m apart`) }
          if (i.takeoff.climb_height !== undefined) { d.site.takeoffAltitude = c(0.5, 200, i.takeoff.climb_height); changes.push(`takeoff climb ${d.site.takeoffAltitude} m`) }
          if (i.takeoff.landing) { d.site.landing = i.takeoff.landing; changes.push(`landing on ${i.takeoff.landing === 'any' ? 'the nearest pad' : 'own pads'}`) }
        }
        if (i.return_flight) {
          const r = i.return_flight
          if (r.transition) { const st = transitionFromInput(r.transition); if (st) d.site.returnFlight.style = st; else delete d.site.returnFlight.style; changes.push(`home flight ${r.transition.style}`) }
          if (r.dim !== undefined) { d.site.returnFlight.dim = r.dim; changes.push(r.dim ? 'dimmed home flight' : 'lit home flight') }
          if (r.seconds !== undefined) { d.site.returnFlight.duration = r.seconds === 'auto' ? null : c(0, 600, r.seconds); changes.push(`home flight ${r.seconds === 'auto' ? 'auto' : `${r.seconds} s`}`) }
        }
      }, 'Show settings')
      if (i.music_offset_seconds !== undefined && !doc().audio) changes.push('(no music loaded: music start not set)')
      return ok(`Updated show: ${changes.join(', ') || 'no change'}`)
    },
  }),
  tool({
    name: 'set_site',
    description: 'The real site: positioning accuracy (spacing and every clearance widen by it), the location and the compass heading the audience faces, keep-out zones (audience areas, obstacles with a height, no-fly areas) and the permitted flight area. Zones and areas are in show metres: x across (+ = audience’s right), z toward the audience (the audience stands at z = audience distance). Only set a location from coordinates the user gave. Every drone is checked against zones for the whole show.',
    schema: z.object({
      accuracy: z.object({ preset: z.enum(['exact', 'rtk', 'rtk_plus', 'gps']).optional().describe('exact: plan positions; rtk: ±0.1/±0.15 m; rtk_plus: ±0.3/±0.5 m; gps: ±1.5/±3 m'), across: z.number().optional(), vertical: z.number().optional() }).optional(),
      location: z.object({ lat: z.number(), lon: z.number() }).optional().describe('Centre of the takeoff grid'),
      heading: z.number().optional().describe('Compass bearing the audience faces, degrees (0 = north)'),
      add_zones: z.array(z.object({
        name: z.string(),
        kind: z.enum(['audience', 'building', 'no-fly']),
        x: z.number().describe('Centre across (m)'),
        z: z.number().describe('Centre toward the audience (m)'),
        width: z.number().describe('Across (m)'),
        depth: z.number().describe('Toward the audience (m)'),
        top: z.number().optional().describe('Height of an obstacle (m); omit for no ceiling'),
        buffer: z.number().optional().describe('Extra distance to keep (m); default by kind'),
      })).optional(),
      remove_zones: z.array(z.string()).optional().describe('Zone names or ids to remove'),
      flight_area: z.union([z.literal('clear'), z.object({ x: z.number(), z: z.number(), width: z.number(), depth: z.number() })]).optional().describe('Rectangle drones must stay inside, or "clear"'),
      map_in_view: z.boolean().optional().describe('Show the street map under the show in 3D (needs a location)'),
    }),
    label: () => 'Updating the site',
    run: (i) => {
      const changes: string[] = []
      let next = doc()
      if (i.accuracy) {
        const p = i.accuracy.preset ? ACCURACY_PRESETS.find((x) => x.label.toLowerCase().replace('+', '_plus') === i.accuracy!.preset) : undefined
        const h = Math.max(0, Math.min(20, i.accuracy.across ?? p?.h ?? 0)), v = Math.max(0, Math.min(20, i.accuracy.vertical ?? p?.v ?? h))
        next = { ...next, limits: { ...next.limits, ...(h || v ? { accuracy: { h, v } } : {}) } }
        if (!h && !v) { const { accuracy: _a, ...rest } = next.limits; void _a; next = { ...next, limits: rest } }
        changes.push(h || v ? `accuracy ±${h} m across, ±${v} m vertical (drones now ${safeSpacing(next.limits).toFixed(2)} m apart)` : 'exact positions')
      }
      if (i.location || i.heading !== undefined) {
        const g = next.site.geo
        const lat = i.location?.lat ?? g?.lat, lon = i.location?.lon ?? g?.lon
        if (lat === undefined || lon === undefined || Math.abs(lat) > 90 || Math.abs(lon) > 180) throw new ToolError('Give a location (lat, lon) before a heading.')
        const heading = (((i.heading ?? g?.heading ?? 0) % 360) + 360) % 360
        next = { ...next, site: reanchorSite(next.site, { lat, lon, heading }) }
        changes.push(`site at ${lat.toFixed(5)}, ${lon.toFixed(5)}, audience facing ${Math.round(heading)}°`)
      }
      const zones = [...(next.site.zones ?? [])]
      for (const r of i.remove_zones ?? []) {
        const k = zones.findIndex((z) => z.id === r || z.name.toLowerCase() === r.toLowerCase())
        if (k >= 0) { changes.push(`removed zone “${zones[k]!.name}”`); zones.splice(k, 1) }
      }
      for (const z of i.add_zones ?? []) {
        const def = ZONE_KINDS.find((k) => k.kind === z.kind)!
        const hw = Math.max(0.5, Math.abs(z.width) / 2), hd = Math.max(0.5, Math.abs(z.depth) / 2)
        zones.push({ id: newId('zone'), name: z.name.slice(0, 80), kind: z.kind, points: [[z.x - hw, z.z - hd], [z.x + hw, z.z - hd], [z.x + hw, z.z + hd], [z.x - hw, z.z + hd]], top: z.top ?? (z.kind === 'building' ? def.top : null), buffer: Math.max(0, z.buffer ?? def.buffer) })
        changes.push(`zone “${z.name}”`)
      }
      if (i.add_zones?.length || i.remove_zones?.length) next = { ...next, site: { ...next.site, zones: zones.length ? zones : undefined } }
      if (i.flight_area === 'clear') { const { area: _a, ...rest } = next.site; void _a; next = { ...next, site: rest }; changes.push('flight area cleared') }
      else if (i.flight_area) {
        const a = i.flight_area, hw = Math.abs(a.width) / 2, hd = Math.abs(a.depth) / 2
        next = { ...next, site: { ...next.site, area: [[a.x - hw, a.z - hd], [a.x + hw, a.z - hd], [a.x + hw, a.z + hd], [a.x - hw, a.z + hd]] } }
        changes.push(`flight area ${a.width}×${a.depth} m`)
      }
      if (i.map_in_view !== undefined) { next = { ...next, site: { ...next.site, mapInView: i.map_in_view } }; changes.push(i.map_in_view ? 'map under the show' : 'no map') }
      getState().replaceDoc(next, 'Site')
      return ok(`Site: ${changes.join(', ') || 'no change'}`)
    },
  }),
  tool({
    name: 'add_shape',
    description: 'Add another shape to an existing formation, sharing its drones (e.g. a name under a logo, a heart beside text). It is sized to safe spacing; use across/up to place it beside the others.',
    schema: z.object({ scene_id: sceneRef, shape: ShapeInput, light: LightInput, across: z.number().optional().describe('Offset from the formation centre (m, + right)'), up: z.number().optional().describe('Offset from the formation centre (m, + up)'), share: z.number().optional().describe('Fraction of the formation’s drones for this shape (0.1–0.7, default an equal share)') }),
    label: (i) => `Adding a ${i.shape.kind} shape`,
    run: async (i, ctx) => {
      const { scene, sub } = findScene(i.scene_id)
      if (i.shape.kind === 'led_sign') throw new ToolError('An LED sign is a formation of its own: use add_scene with shape kind "led_sign".')
      const main = scene.layers.filter((l) => !l.role)
      const share = Math.max(0.05, Math.min(0.8, i.share ?? 1 / (main.length + 1)))
      const total = main.reduce((a, l) => a + l.weight, 0)
      const custom = await resolveCustom(i.shape, ctx.signal, Math.round(sub.droneCount * share))
      const shape = custom ?? shapeFromInput(i.shape)
      const effect = custom && (i.light.effect === 'image' || (i.light.effect === 'solid' && !i.light.color)) ? effectFromInput({ ...i.light, effect: 'image' }) : effectFromInput(i.light.effect === 'image' ? { ...i.light, effect: 'solid' } : i.light)
      const layer = { ...newLayer(shape, effect), weight: (total * share) / (1 - share), offset: [i.across ?? 0, i.up ?? 0, 0] as [number, number, number] }
      const roles = scene.layers.filter((l) => l.role)
      let s: Scene = { ...scene, layers: [...main, layer, ...roles] }
      s = fitToAirspace(fitScene(s, sub.droneCount, comfortableSpacing(safeSpacing(sub.limits)), 'grow'), sub)
      replaceScene(scene.id, s, `Add a shape to ${scene.name}`)
      return ok(`Added a ${shape.kind} to “${scene.name}”`, `"${scene.name}" now has ${s.layers.length} layer(s); the new one is layer ${s.layers.indexOf(s.layers.find((l) => l.id === layer.id)!)}.`)
    },
  }),
  tool({
    name: 'remove_shape',
    description: 'Remove one shape (layer) from a formation; its drones go to the remaining shapes.',
    schema: z.object({ scene_id: sceneRef, layer_index: z.number() }),
    label: () => 'Removing a shape',
    run: (i) => {
      const { scene } = findScene(i.scene_id)
      const li = Math.round(i.layer_index)
      if (scene.layers.length < 2 || !scene.layers[li]) throw new ToolError(`“${scene.name}” has ${scene.layers.length} layer(s); can’t remove layer ${li}.`)
      replaceScene(scene.id, pruneGroups({ ...scene, layers: scene.layers.filter((_, k) => k !== li) }), `Remove a shape from ${scene.name}`)
      return ok(`Removed layer ${li} from “${scene.name}”`)
    },
  }),
  tool({
    name: 'wind_test',
    description: 'Fly the whole show through a physical simulation with wind, gusts and turbulence, and report how close drones really come, how far they drift from the plan and how often they hit their control limits. Takes a little while on long shows.',
    schema: z.object({ wind_speed: z.number().describe('Mean wind at 10 m (m/s), e.g. 3 light, 6 moderate, 9 strong'), from_degrees: z.number().optional().describe('Compass direction the wind blows from (default 270, west)'), gusts: z.number().optional().describe('Gust strength (m/s, default 40% of the wind)') }),
    label: (i) => `Wind test at ${i.wind_speed} m/s`,
    run: async (i) => {
      const speed = Math.max(0, Math.min(25, i.wind_speed))
      const r = await runSimAsync({ speed, from: i.from_degrees ?? 270, gust: i.gusts ?? speed * 0.4, turbulence: 0.6, seed: 1 })
      const L = doc().limits
      const verdict = simVerdict(r, L.minSpacing)
      const planned = validate(doc(), compile(doc())).stats.minDistance
      return ok(`Wind test (${speed} m/s): ${verdict.text}`, `Wind ${speed} m/s from ${i.from_degrees ?? 270}°. ${verdict.text} Closest approach in the wind ${r.minDistance === null ? `above ${r.checkRadius.toFixed(1)} m` : `${r.minDistance.toFixed(2)} m at ${formatTime(r.minDistanceTime)}`} (planned ${planned.toFixed(2)} m, limit ${L.minSpacing} m); ${r.closePairs} pair(s) closer than the limit. Largest drift ${r.maxDeviation.toFixed(2)} m (typical ${r.rmsDeviation.toFixed(2)} m); ${(r.saturated * 100).toFixed(1)}% of drone-time at the control limits. The user can watch it via Wind test → Watch in viewport.`)
    },
  }),
  tool({
    name: 'show_moment',
    description: 'Show the user a moment: select a formation (or group formation) and move the playhead to it, or to a time; optionally switch the camera and start playing. Use after edits so the user sees the result.',
    schema: z.object({ scene_id: z.string().optional(), time_seconds: z.number().optional(), camera: z.enum(['audience', 'orbit', 'top']).optional(), play: z.boolean().optional() }),
    label: () => 'Showing the moment',
    run: (i) => {
      const st = getState()
      if (i.scene_id) {
        findScene(i.scene_id)
        st.select({ kind: 'scene', id: i.scene_id })
        const c = st.compiled ?? compile(doc())
        const t = findSceneTime(c, i.scene_id)
        if (t) seek(t.holdStart + Math.min(0.5, (t.holdEnd - t.holdStart) / 2))
      }
      if (i.time_seconds !== undefined) seek(Math.max(0, i.time_seconds))
      if (i.camera) st.setCamera(i.camera)
      if (i.play) play()
      return { summary: `Showing ${i.scene_id ? findScene(i.scene_id).scene.name : formatTime(getState().time)}`, content: `Playhead at ${formatTime(getState().time)}${i.camera ? `, ${i.camera} view` : ''}${i.play ? ', playing' : ''}.` }
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
