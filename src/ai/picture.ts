// Picture → drones, with look and fix.
//
//   1. picture: an image model draws the subject as glowing line art on black,
//      with as much detail as the drone count can show;
//   2. trace: its bright lines become strokes (one evenly spaced line of
//      drones each), wide areas become fills, colours come from the picture
//      (core/trace.ts) — instant, so detail and sensitivity can be re-run;
//   3. drones: the traced drawing at any drone count (core/shapes.ts), with
//      strokes left out that would blur together at that spacing;
//   4. look and fix: Claude compares the picture with the drones and either
//      approves, adjusts detail / sensitivity, or asks for a new picture;
//   5. motion (when asked for): Claude outlines the parts that move on the
//      picture and puts their hinges, then checks them at both ends of the
//      motion. The outlines are in picture coordinates, so they survive any
//      re-trace.
//
// Every stage keeps its inputs (the picture is stored with the shape), so the
// drone count, detail and sensitivity can change later without a new picture.

import { z } from 'zod'
import type { BetaContentBlockParam } from '@anthropic-ai/sdk/resources/beta/messages/messages'
import type { DrawingPart, JointKind, Limits, ModelJoint, PictureSource, ShapeSpec, Vec3 } from '@/core/types'
import { safeSpacing } from '@/core/site'
import { comfortableSpacing } from '@/core/separation'
import { minPairDistance } from '@/core/math'
import { DEFAULT_TRACE, traceDetail, traceImage } from '@/core/trace'
import { generateShape } from '@/core/shapes'
import { describeJoint, modelPoses } from '@/core/joints'
import { generateImage, type ImageFormat } from './openai'
import { submitObject } from './submit'
import { dronesPng, frontStrip } from './render'

export type PictureShape = Extract<ShapeSpec, { kind: 'image' }>

/**
 * How much detail a picture should have for a drone count. Drones keep a
 * few metres apart and a formation is at most about 100 m tall, so a line
 * drawing holds roughly one drone per 3 m of line, and neighbouring lines
 * need a gap of several metres: about 20 lines across the figure at most.
 */
export function detailFor(drones: number): string {
  const widths = Math.max(3, Math.round((drones * 3) / 100))
  const level =
    drones <= 150 ? 'Very simple: a bold outline and a handful of inner lines.'
    : drones <= 400 ? 'Simple: clean outlines plus the inner lines that make it recognisable.'
    : drones <= 900 ? 'Detailed: outlines plus inner contours (petals, folds, feathers) spread evenly over the whole figure.'
    : 'Rich: many inner lines and patterns spread evenly over the whole figure.'
  return `${level} Line budget: about ${widths} times the picture's width of line in total. Neighbouring lines never closer than a twentieth of the picture's width anywhere — bold, open line work, never fine engraving or hatching.`
}

export const ExpandedPrompt = z.object({
  name: z.string().describe('Short name for the formation, e.g. "Bridal bouquet"'),
  prompt: z.string().describe('The picture description for the image model (40–120 words)'),
  format: z.enum(['square', 'landscape', 'portrait']).describe('Shape of the picture: landscape (3:2) for wide subjects (spread wings, a skyline, a couple side by side) — the sky is usually wider than tall; portrait (2:3) for tall ones (a bottle, a tower); square otherwise'),
  motion: z.string().optional().describe('Only if the request implies motion (wings flapping, a hand waving, a wheel turning, a pendulum): what should move and how, e.g. "both wings flap slowly from the shoulders". Omit for a still picture'),
})

const EXPAND_SYSTEM = `You turn short, vague requests into picture descriptions for an image model. The picture becomes a drone light show formation: every bright line of it becomes a line of lights, so it is drawn as glowing line art on black (the style is added for you — describe only the content).

Write one concrete description (40–120 words):
- the subject, its pose or arrangement and the view (front or side, centred, a clear silhouette that reads from far away);
- the few defining features, drawn as lines (eyes, petals, folds, a ribbon, rays…), and what to leave out;
- colours: a harmonious palette of 2–5 vivid colours plus one accent, saying which part is which colour; never black or grey;
- the level of detail the light count allows (you are told it), with lines well separated.
Don't mention drones, dots, lights or LEDs — the image model would draw dotted lines. No text in the picture unless asked.
If the request implies motion (flapping, waving, turning), say what moves in "motion", and in the description draw the moving parts joined to the rest only at the hinge and clear of other lines everywhere else (wings spread wide, meeting the body at the shoulders; an arm held away from the body), so they can move without touching other lines.`

/** Claude expands a short request into a full picture description for a drone count. */
export async function expandPrompt(description: string, drones: number, signal?: AbortSignal): Promise<{ name: string; prompt: string; format: ImageFormat; motion?: string }> {
  const out = await submitObject({
    schema: ExpandedPrompt,
    tool: { name: 'submit_description', description: 'Submit the picture description and a short name.' },
    label: 'Picture description',
    system: EXPAND_SYSTEM,
    content: [{ type: 'text', text: `Request: ${description.trim()}\nLights available: ${drones} — ${detailFor(drones)}\nThe formation can be up to about 240 m wide and 100 m tall.` }],
    maxTokens: 2000,
    effort: 'low',
    signal,
    messages: { refusal: 'Claude declined that request. Try describing it differently.', tooLong: 'The description got too long.', unreadable: 'Couldn’t read the description. Try again.' },
  })
  return { name: out.name.slice(0, 40) || description.slice(0, 40), prompt: out.prompt.trim(), format: out.format, ...(out.motion?.trim() ? { motion: out.motion.trim() } : {}) }
}

/** The image prompt for a subject and drone count. */
export function picturePrompt(description: string, drones: number): string {
  return [
    `${description.trim()}.`,
    'Drawn as a glowing neon line drawing on a pure black background: thin, bright, smooth, continuous lines (not dotted), each part in its own vivid, saturated colour.',
    'No filled areas except very small accents, no shading, no glow haze, no gradients in the background, no text, no frame.',
    'Front view, centred, the subject filling about 85% of the square.',
    detailFor(drones),
  ].join(' ')
}

/** Decode a picture (base64 PNG/JPEG, or a data URL) to RGBA (browser only). */
export async function decodePicture(src: string): Promise<{ data: Uint8ClampedArray; w: number; h: number }> {
  const url = src.startsWith('data:') ? src : `data:image/png;base64,${src}`
  const blob = await (await fetch(url)).blob()
  const bmp = await createImageBitmap(blob)
  const canvas = document.createElement('canvas')
  canvas.width = bmp.width
  canvas.height = bmp.height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(bmp, 0, 0)
  return { data: ctx.getImageData(0, 0, bmp.width, bmp.height).data, w: bmp.width, h: bmp.height }
}

/** A compact JPEG of a picture to keep with the shape (browser only). */
export async function compactPicture(src: string, size = 640): Promise<string> {
  const url = src.startsWith('data:') ? src : `data:image/png;base64,${src}`
  const bmp = await createImageBitmap(await (await fetch(url)).blob())
  const canvas = document.createElement('canvas')
  const k = Math.min(1, size / Math.max(bmp.width, bmp.height))
  canvas.width = Math.round(bmp.width * k)
  canvas.height = Math.round(bmp.height * k)
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL('image/jpeg', 0.9)
}

/** Trace a stored picture into an image shape (browser only). */
export async function traceSource(source: PictureSource, name: string, size = 40): Promise<PictureShape> {
  const px = await decodePicture(source.image)
  const t = traceImage(px.data, px.w, px.h, { ...DEFAULT_TRACE, ...traceDetail(source.detail), threshold: source.threshold })
  return { kind: 'image', size, name: name.slice(0, 40) || 'Picture', mask: t.mask, colors: t.colors, cw: t.cw, ch: t.ch, lines: t.lines, detail: source.detail, picture: source }
}

export interface PictureFit {
  /** Size at the show's safe spacing (m). */
  width: number
  height: number
  /** Room in the airspace (m). */
  roomWidth: number
  roomHeight: number
  fits: boolean
  /** About how many drones this drawing can take and still fit (more lines would be needed beyond). */
  maxDrones: number
}

/**
 * How big a traced picture is with n drones at the show's comfortable
 * spacing, and whether that fits the airspace. A line drawing needs about
 * one spacing of line per drone, so more drones make it bigger unless the
 * picture has more lines.
 */
export function pictureFit(shape: PictureShape, n: number, limits: Limits): PictureFit {
  const spacing = comfortableSpacing(safeSpacing(limits))
  const g = generateShape({ ...shape, size: 1 }, n)
  const d = Math.max(1e-9, minPairDistance(g.points))
  const k = spacing / d
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  for (let i = 0; i < n; i++) { minX = Math.min(minX, g.points[i * 3]!); maxX = Math.max(maxX, g.points[i * 3]!); minY = Math.min(minY, g.points[i * 3 + 1]!); maxY = Math.max(maxY, g.points[i * 3 + 1]!) }
  const width = (maxX - minX) * k, height = (maxY - minY) * k
  const roomHeight = Math.max(10, limits.maxAltitude - limits.minAltitude - 10)
  const roomWidth = Math.max(10, 2 * limits.maxRadius * 0.8)
  const over = Math.max(width / roomWidth, height / roomHeight)
  return { width, height, roomWidth, roomHeight, fits: over <= 1, maxDrones: over <= 1 ? n : Math.floor(n / over) }
}

/** One line for people and Claude about the size. */
export function describeFit(f: PictureFit, n: number): string {
  const size = `${Math.round(f.width)} × ${Math.round(f.height)} m`
  if (f.fits) return `${n} drones at safe spacing: ${size}, fits the airspace.`
  return `${n} drones at safe spacing: ${size} — too big for the airspace (${Math.round(f.roomWidth)} × ${Math.round(f.roomHeight)} m). This drawing fits about ${f.maxDrones} drones; for ${n}, it needs more lines (more detail, or a more detailed picture).`
}

export interface PictureAttempt {
  name: string
  source: PictureSource
  shape: PictureShape
  /** Claude's verdict after looking at this attempt. */
  critique?: string
  verdict?: 'good' | 'adjusted' | 'redrawn'
  /** What should move (from the request), and Claude's note on the motion it marked. */
  motion?: string
  motionNote?: string
}

export const PictureReview = z.object({
  critique: z.string().describe('What reads well and what doesn’t, in one to three sentences, for the designer'),
  done: z.boolean().describe('true if the drones already read clearly as the subject'),
  style: z.enum(['lines', 'filled', 'adaptive']).optional().describe('Switch the drawing style: lines (every line a line of drones — usually best), filled (drones over the whole figure — when the lines can’t hold this many drones within the airspace, or for bold silhouettes), adaptive (lines if they fit, filled if not)'),
  detail: z.number().optional().describe('New detail 0–1 (lower: fewer, bolder lines — fixes clutter where lines blur together; higher: more of the picture’s lines — brings back missing features)'),
  sensitivity: z.number().optional().describe('New line sensitivity 0–1 (higher picks up fainter lines; lower ignores faint glow and background specks)'),
  format: z.enum(['square', 'landscape', 'portrait']).optional().describe('Shape for a new picture (landscape suits wide subjects and the usually wide sky)'),
  new_picture: z.string().optional().describe('If the picture itself is the problem (too intricate for the drone count, filled areas, dotted lines, a background, text, wrong subject): a complete new description of the picture’s content — subject, pose, defining features as lines, colours, level of detail (the line-art style is added automatically; don’t mention drones or dots)'),
})

/** Threshold for a 0–1 sensitivity (null = automatic). */
export function thresholdFor(sensitivity: number | undefined): number | null {
  return sensitivity === undefined ? null : Math.max(0.05, Math.min(0.7, 0.7 - 0.6 * sensitivity))
}

const SYSTEM = `You check drone light show formations made from pictures. A picture (glowing line art on black) is traced into drones: in the lines style every bright line becomes one evenly spaced line of drones, in the picture's colours (filled spreads them over the whole figure instead). With fewer drones, lines that would blur together at their spacing are left out (lower detail leaves out more). Judge the drones as an audience would at night, compared with the picture and the subject, and choose the smallest fix: approve, change detail, sensitivity or style, or (only when the picture itself is wrong or far too intricate for the drone count) describe a new picture.`

/** Claude compares the picture with the drones and decides (one look). */
export async function reviewPicture(description: string, attempt: PictureAttempt, n: number, signal?: AbortSignal, limits?: Limits) {
  const dots = generateShape({ ...attempt.shape, size: 10 }, n)
  const fit = limits ? describeFit(pictureFit(attempt.shape, n, limits), n) : ''
  const content: BetaContentBlockParam[] = [
    { type: 'text', text: `Subject: ${description.trim()}\nPicture description used: ${attempt.source.prompt}\nDrones: ${n}\nCurrent detail ${attempt.source.detail.toFixed(2)}, sensitivity ${attempt.source.threshold === null ? 'automatic' : (Math.round(((0.7 - attempt.source.threshold) / 0.6) * 100) / 100).toFixed(2)}.` },
    { type: 'text', text: 'The picture:' },
    { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: attempt.source.image.split(',')[1]! } },
    { type: 'text', text: `The drones (${n}), as the audience sees them:` },
    { type: 'image', source: { type: 'base64', media_type: 'image/png', data: dronesPng(dots.points, dots.colors) } },
    ...(fit ? [{ type: 'text' as const, text: `Size: ${fit}` }] : []),
    { type: 'text', text: 'Is it instantly recognisable, are its defining features there, are lines clean rather than cluttered, are the colours right? If it is too big for the airspace, it needs more lines for its drones: raise detail, or describe a more detailed picture. Approve, or give the smallest fix.' },
  ]
  return submitObject({
    schema: PictureReview,
    tool: { name: 'submit_review', description: 'Submit your verdict on the drones: approve, or the adjustment to make.' },
    label: 'Look & fix (picture)',
    system: SYSTEM,
    content,
    maxTokens: 4000,
    effort: 'medium',
    signal,
    messages: { refusal: 'Claude declined to review that picture.', tooLong: 'The review got too long.', unreadable: 'Couldn’t read the review. Try again.' },
  })
}

/** Generate a picture from a (full) description and trace it. `prompt` is the content; the style is added here. */
export async function newPicture(name: string, prompt: string, n: number, detail: number, signal?: AbortSignal, format: ImageFormat = 'square'): Promise<PictureAttempt> {
  const b64 = await generateImage(picturePrompt(prompt, n), { signal, format })
  const image = await compactPicture(b64)
  const source: PictureSource = { prompt, image, detail, threshold: null, format }
  return { name: name.trim().slice(0, 40), source, shape: await traceSource(source, name) }
}

/**
 * Describe → picture → drones → look and fix, up to `rounds` reviews.
 * `onUpdate` receives the attempts after every step.
 */
export async function createPicture(description: string, opts: { n: number; rounds: number; detail?: number; expand?: boolean; limits?: Limits; signal?: AbortSignal; onUpdate?: (attempts: PictureAttempt[], busy: 'writing' | 'drawing' | 'looking' | 'moving' | null) => void }): Promise<PictureAttempt[]> {
  const attempts: PictureAttempt[] = []
  const emit = (busy: 'writing' | 'drawing' | 'looking' | 'moving' | null) => opts.onUpdate?.(attempts.map((a) => ({ ...a })), busy)
  // A short request becomes a full picture description first (and says what moves, if anything).
  let name = description.trim().slice(0, 40), prompt = description.trim(), format: ImageFormat = 'square'
  let motion: string | undefined
  if (opts.expand !== false) {
    emit('writing')
    const e = await expandPrompt(description, opts.n, opts.signal)
    name = e.name
    prompt = e.prompt
    format = e.format
    motion = e.motion
  }
  emit('drawing')
  attempts.push(await newPicture(name, prompt, opts.n, opts.detail ?? 0.6, opts.signal, format))
  for (let round = 0; round < opts.rounds; round++) {
    emit('looking')
    const current = attempts[attempts.length - 1]!
    const r = await reviewPicture(description, current, opts.n, opts.signal, opts.limits)
    current.critique = r.critique
    if (r.done) { current.verdict = 'good'; break }
    if (r.new_picture?.trim()) {
      current.verdict = 'redrawn'
      emit('drawing')
      attempts.push(await newPicture(current.name, r.new_picture, opts.n, r.detail ?? current.source.detail, opts.signal, r.format ?? current.source.format ?? 'square'))
      continue
    }
    if (r.detail === undefined && r.sensitivity === undefined && !r.style) { current.verdict = 'good'; break }
    current.verdict = 'adjusted'
    const source: PictureSource = { ...current.source, detail: Math.max(0, Math.min(1, r.detail ?? current.source.detail)), threshold: r.sensitivity === undefined ? current.source.threshold : thresholdFor(r.sensitivity) }
    const style = r.style ?? current.shape.style
    attempts.push({ name: current.name, source, shape: { ...(await traceSource(source, current.name)), ...(style ? { style } : {}) } })
  }
  // Motion, when the request implies it: Claude marks the moving parts on the final picture.
  if (motion) {
    emit('moving')
    const last = attempts[attempts.length - 1]!
    const m = await animatePicture(last, motion, opts.n, opts.signal)
    attempts[attempts.length - 1] = { ...last, shape: m.shape, motion, motionNote: m.note }
  }
  emit(null)
  return attempts
}

/** A custom picture for the show generator and the copilot: expanded, drawn, traced and checked once. */
export async function pictureFor(description: string, n: number, limits: Limits | undefined, signal?: AbortSignal): Promise<PictureShape> {
  const attempts = await createPicture(description, { n, rounds: 1, limits, signal })
  return attempts[attempts.length - 1]!.shape
}

// --- Motion ------------------------------------------------------------------------------

const point = z.array(z.number()).describe('[x, y]: fractions of the picture’s width and height from its top-left (use the grid)')

export const PictureMotion = z.object({
  note: z.string().describe('One sentence for the designer: what moves and how'),
  done: z.boolean().optional().describe('When checking a motion: true if it already looks right (then leave parts out)'),
  parts: z.array(z.object({
    name: z.string().describe('e.g. "Left wing"'),
    outline: z.array(point).describe('A polygon of 4–24 points tightly around the part: every drone inside moves with it, everything outside stays still. Leave out lines near the hinge that belong to the still body'),
    pivot: point.describe('The hinge: exactly where the part attaches (a wing at the shoulder, an arm at the shoulder, a pendulum at its top) — never its middle'),
    motion: z.enum(['swing', 'turn', 'slide']).describe('swing: back and forth by ± amount degrees, once per period; turn: round and round at amount degrees per second; slide: back and forth by ± amount metres'),
    axis: z.enum(['picture', 'picture-reversed', 'vertical', 'horizontal']).optional().describe('swing/turn: picture = in the picture’s plane, counter-clockwise first as the audience sees it (the default); picture-reversed = clockwise first (the mirror-image partner of a pair, so both wings rise together); vertical = about the up axis (turning to show its side); horizontal = about the left-right axis (nodding). slide: vertical (up and down, the default) or horizontal (side to side)'),
    amount: z.number().describe('swing: degrees either way (10–25 reads well); turn: degrees per second; slide: metres either way'),
    period: z.number().optional().describe('Seconds per beat for swing and slide (8–16 reads well and is what the drones can fly)'),
    phase: z.number().optional().describe('0–1 offset in the beat: 0.5 moves the opposite way (walking legs); a small lag (−0.1) for a part hanging off another'),
    parent: z.string().optional().describe('Name of the part this one hangs off (a wingtip off its wing); list the parent first'),
  })).optional().describe('The moving parts (up to 8). Leave out when done'),
})
export type PictureMotionParts = NonNullable<z.infer<typeof PictureMotion>['parts']>

const MOTION_SYSTEM = `You animate drone light show formations made from pictures: the picture's bright lines become lines of drones, and parts of it can move on their own while the formation is held — wings flapping, a hand waving, a wheel turning, a pendulum swinging. You mark each moving part on the picture:
- an outline (polygon) tightly around the part: every drone inside it moves with the part as one rigid piece, everything outside stays still. Coordinates are fractions of the picture's width and height from its top-left — read them off the grid. Follow the part's shape; keep the outline clear of still lines (the body, the other wing) except right at the hinge.
- the pivot: exactly the hinge where the part attaches.
- its motion. Pairs move together: the left one with axis picture-reversed, the right with picture (or the other way round), same phase.
Physics: the formation is usually 100–250 m across, drones climb at most 3 m/s and descend at most 2 m/s, so a part far from its hinge can only move slowly. Gentle and slow reads best: 8–16 s per beat, 10–25°. The engine calms anything faster to what the drones can fly (keeping the beat), so choose the character of the motion, not its limit.`

/** The picture with a labelled coordinate grid every tenth, for outlining parts (PNG base64; browser only). */
export async function gridPicture(src: string, size = 768): Promise<string> {
  const bmp = await createImageBitmap(await (await fetch(src)).blob())
  const k = size / Math.max(bmp.width, bmp.height)
  const W = Math.round(bmp.width * k), H = Math.round(bmp.height * k), M = 26
  const canvas = document.createElement('canvas')
  canvas.width = W + M * 2
  canvas.height = H + M * 2
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(bmp, M, M, W, H)
  ctx.font = '11px sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  for (let i = 0; i <= 10; i++) {
    const x = M + (W * i) / 10, y = M + (H * i) / 10
    ctx.strokeStyle = i % 5 === 0 ? 'rgba(120,200,255,0.55)' : 'rgba(120,200,255,0.28)'
    ctx.lineWidth = 1
    ctx.beginPath(); ctx.moveTo(x, M); ctx.lineTo(x, M + H); ctx.stroke()
    ctx.beginPath(); ctx.moveTo(M, y); ctx.lineTo(M + W, y); ctx.stroke()
    ctx.fillStyle = '#9fd4ff'
    const t = (i / 10).toFixed(1)
    ctx.fillText(t, x, M / 2); ctx.fillText(t, x, M + H + M / 2)
    ctx.fillText(t, M / 2, y); ctx.fillText(t, M + W + M / 2, y)
  }
  return canvas.toDataURL('image/png').split(',')[1]!
}

const clamp = (v: number, lo: number, hi: number, d: number) => (Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d)
const AXES: Record<string, Vec3> = { picture: [0, 0, 1], 'picture-reversed': [0, 0, -1], vertical: [0, 1, 0], horizontal: [1, 0, 0] }

/** A picture shape with these moving parts (none: still). */
export function withMotion(shape: PictureShape, parts: PictureMotionParts | null): PictureShape {
  const { parts: _p, joints: _j, ...still } = shape
  if (!parts?.length) return still
  const list = parts.slice(0, 8)
  const ids = list.map((p, i) => `${p.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'part'}-${i}`)
  const joints: ModelJoint[] = list.map((p, i) => {
    const kind: JointKind = p.motion
    const axis = kind === 'slide' ? (p.axis === 'horizontal' ? [1, 0, 0] as Vec3 : [0, 1, 0] as Vec3) : AXES[p.axis ?? 'picture'] ?? [0, 0, 1]
    const parent = p.parent ? list.findIndex((q) => q.name.toLowerCase() === p.parent!.toLowerCase()) : -1
    return {
      id: ids[i]!, name: p.name.slice(0, 60) || `Part ${i + 1}`,
      pivot: [clamp(p.pivot[0]!, -0.5, 1.5, 0.5), clamp(p.pivot[1]!, -0.5, 1.5, 0.5), 0],
      kind, axis,
      amount: kind === 'turn' ? clamp(p.amount, -720, 720, 20) : kind === 'slide' ? clamp(p.amount, -100, 100, 2) : clamp(Math.abs(p.amount), 0, 180, 15),
      period: clamp(p.period ?? 10, 0.5, 120, 10), phase: clamp(p.phase ?? 0, -1, 1, 0),
      ...(parent >= 0 && parent !== i ? { parent: ids[parent]! } : {}),
    }
  })
  const dparts: DrawingPart[] = list.map((p, i) => ({
    name: joints[i]!.name, joint: ids[i]!,
    region: p.outline.filter((q) => q.length >= 2).slice(0, 40).map((q) => [clamp(q[0]!, -0.5, 1.5, 0.5), clamp(q[1]!, -0.5, 1.5, 0.5)] as [number, number]),
  })).map((p) => (p.region.length >= 3 ? p : { name: p.name, joint: p.joint }))
  return { ...still, parts: dparts, joints }
}

/** The moving parts of a picture shape, in the form Claude writes them (for a second look). */
function motionParts(shape: PictureShape): PictureMotionParts {
  return (shape.parts ?? []).map((p) => {
    const j = shape.joints?.find((x) => x.id === p.joint)
    const axis = !j ? undefined : j.kind === 'slide' ? (j.axis[0] ? 'horizontal' : 'vertical') : j.axis[2] < 0 ? 'picture-reversed' : j.axis[1] ? 'vertical' : j.axis[0] ? 'horizontal' : 'picture'
    return { name: p.name, outline: p.region ?? [], pivot: j ? [j.pivot[0], j.pivot[1]] : [0.5, 0.5], motion: j?.kind ?? 'swing', axis, amount: j?.amount ?? 0, period: j?.period, phase: j?.phase, parent: shape.joints?.find((x) => x.id === j?.parent)?.name }
  })
}

/** The same moving parts on a re-traced or adjusted shape of the same picture. */
export function keepMotion(from: PictureShape, to: PictureShape): PictureShape {
  if (!from.parts?.length || from.picture?.image !== to.picture?.image) return to
  return { ...to, parts: from.parts, ...(from.joints ? { joints: from.joints } : {}) }
}

/** Front view of the drones at rest and at both ends of the motion (PNG base64; browser only), or null when still. */
export function motionStrip(shape: PictureShape, n: number): string | null {
  if (!shape.joints?.length) return null
  const poses = modelPoses({ ...shape, size: 10 }, Math.max(20, n), generateShape)
  if (!poses) return null
  const g = generateShape({ ...shape, size: 10 }, Math.max(20, n))
  return frontStrip(poses, g.colors, `${shape.name}: moving parts`)
}

/**
 * Claude marks the parts of a picture that move (`request`: what should move, in words), then
 * looks at the drones at both ends of the motion and corrects it, up to `rounds` times.
 */
export async function animatePicture(attempt: PictureAttempt, request: string, n: number, signal?: AbortSignal, rounds = 1): Promise<{ shape: PictureShape; note: string }> {
  const grid = await gridPicture(attempt.source.image)
  const base: BetaContentBlockParam[] = [
    { type: 'text', text: `The formation: ${attempt.name} (${n} drones). Picture description: ${attempt.source.prompt}\nWhat should move: ${request.trim() || 'whatever would naturally move'}` },
    { type: 'text', text: 'The picture, with a grid every tenth of its width and height (0,0 is the top-left corner):' },
    { type: 'image', source: { type: 'base64', media_type: 'image/png', data: grid } },
  ]
  const ask = (content: BetaContentBlockParam[]) => submitObject({
    schema: PictureMotion,
    tool: { name: 'submit_motion', description: 'Submit the moving parts: each one’s outline on the picture, hinge and motion.' },
    label: 'Motion (picture)',
    system: MOTION_SYSTEM,
    content,
    maxTokens: 8000,
    effort: 'medium',
    signal,
    messages: { refusal: 'Claude declined to animate that picture.', tooLong: 'The motion got too long.', unreadable: 'Couldn’t read the motion. Try again.' },
  })
  const first = await ask([...base, { type: 'text', text: 'Mark the moving parts.' }])
  let shape = withMotion(attempt.shape, first.parts ?? null)
  let note = first.note
  for (let round = 0; round < rounds && shape.joints?.length; round++) {
    const strip = motionStrip(shape, n)
    if (!strip) break
    const review = await ask([
      ...base,
      { type: 'text', text: `Your moving parts: ${JSON.stringify(motionParts(shape))}\n(${shape.joints.map((j) => `${j.name} ${describeJoint(j)}`).join('; ')})` },
      { type: 'text', text: 'The drones, front view, at rest and at both ends of the motion:' },
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: strip } },
      { type: 'text', text: 'Check it: does each part move whole (no stray pieces left behind or dragged along), hinge where it attaches, and move the right way (pairs together)? If it looks right, set done. Otherwise give the corrected parts (all of them).' },
    ])
    note = review.note || note
    if (review.done || !review.parts?.length) break
    shape = withMotion(attempt.shape, review.parts)
  }
  return { shape, note }
}

/**
 * A picture of any drawing to mark moving parts on (data URL; browser only): a traced picture's
 * own picture, or a drawing's strokes and fills drawn in their colours on black.
 */
export async function pictureOf(shape: PictureShape): Promise<string> {
  if (shape.picture?.image) return shape.picture.image
  const W = 640, H = Math.max(64, Math.round((W * (shape.mask.h || 1)) / Math.max(1, shape.mask.w || 1)))
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, W, H)
  const rgb = shape.colors && shape.cw && shape.ch ? Uint8Array.from(atob(shape.colors), (c) => c.charCodeAt(0)) : null
  const colourAt = (u: number, v: number) => {
    if (!rgb) return '#ffffff'
    const x = Math.min(shape.cw - 1, Math.max(0, Math.floor(u * shape.cw))), y = Math.min(shape.ch - 1, Math.max(0, Math.floor(v * shape.ch)))
    const o = (y * shape.cw + x) * 3
    return `rgb(${rgb[o]},${rgb[o + 1]},${rgb[o + 2]})`
  }
  // Fills.
  if (shape.mask.bits && shape.mask.w && shape.mask.h) {
    const bits = Uint8Array.from(atob(shape.mask.bits), (c) => c.charCodeAt(0))
    const sx = W / shape.mask.w, sy = H / shape.mask.h
    for (let i = 0; i < shape.mask.w * shape.mask.h; i++) {
      if (!((bits[i >> 3]! >> (7 - (i & 7))) & 1)) continue
      const x = i % shape.mask.w, y = Math.floor(i / shape.mask.w)
      ctx.fillStyle = colourAt((x + 0.5) / shape.mask.w, (y + 0.5) / shape.mask.h)
      ctx.fillRect(x * sx, y * sy, sx + 0.5, sy + 0.5)
    }
  }
  // Strokes.
  ctx.lineWidth = 4
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  for (const l of shape.lines ?? []) {
    if (l.p.length < 4) continue
    ctx.strokeStyle = colourAt(l.p[0]!, l.p[1]!)
    ctx.beginPath()
    for (let i = 0; i + 1 < l.p.length; i += 2) { const x = l.p[i]! * W, y = l.p[i + 1]! * H; if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y) }
    if (l.closed) ctx.closePath()
    ctx.stroke()
  }
  return canvas.toDataURL('image/png')
}

/** Mark what moves on any drawing or traced picture (Claude); "none" or "" keeps it still. */
export async function animateShape(shape: PictureShape, request: string, n: number, signal?: AbortSignal): Promise<{ shape: PictureShape; note: string }> {
  if (!request.trim() || /^(none|still|no motion|stop)$/i.test(request.trim())) return { shape: withMotion(shape, null), note: 'Still.' }
  const image = await pictureOf(shape)
  const source: PictureSource = shape.picture ?? { prompt: shape.name, image, detail: shape.detail ?? 0.5, threshold: null }
  return animatePicture({ name: shape.name, source: { ...source, image }, shape }, request, n, signal)
}
