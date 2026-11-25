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
//      approves, adjusts detail / sensitivity, or asks for a new picture.
//
// Every stage keeps its inputs (the picture is stored with the shape), so the
// drone count, detail and sensitivity can change later without a new picture.

import { z } from 'zod'
import type { BetaContentBlockParam } from '@anthropic-ai/sdk/resources/beta/messages/messages'
import type { Limits, PictureSource, ShapeSpec } from '@/core/types'
import { safeSpacing } from '@/core/site'
import { comfortableSpacing } from '@/core/separation'
import { minPairDistance } from '@/core/math'
import { DEFAULT_TRACE, traceDetail, traceImage } from '@/core/trace'
import { generateShape } from '@/core/shapes'
import { generateImage, type ImageFormat } from './openai'
import { submitObject } from './submit'
import { dronesPng } from './render'

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
})

const EXPAND_SYSTEM = `You turn short, vague requests into picture descriptions for an image model. The picture becomes a drone light show formation: every bright line of it becomes a line of lights, so it is drawn as glowing line art on black (the style is added for you — describe only the content).

Write one concrete description (40–120 words):
- the subject, its pose or arrangement and the view (front or side, centred, a clear silhouette that reads from far away);
- the few defining features, drawn as lines (eyes, petals, folds, a ribbon, rays…), and what to leave out;
- colours: a harmonious palette of 2–5 vivid colours plus one accent, saying which part is which colour; never black or grey;
- the level of detail the light count allows (you are told it), with lines well separated.
Don't mention drones, dots, lights or LEDs — the image model would draw dotted lines. No text in the picture unless asked.`

/** Claude expands a short request into a full picture description for a drone count. */
export async function expandPrompt(description: string, drones: number, signal?: AbortSignal): Promise<{ name: string; prompt: string; format: ImageFormat }> {
  const out = await submitObject({
    schema: ExpandedPrompt,
    tool: { name: 'submit_description', description: 'Submit the picture description and a short name.' },
    system: EXPAND_SYSTEM,
    content: [{ type: 'text', text: `Request: ${description.trim()}\nLights available: ${drones} — ${detailFor(drones)}\nThe formation can be up to about 240 m wide and 100 m tall.` }],
    maxTokens: 2000,
    effort: 'low',
    signal,
    messages: { refusal: 'Claude declined that request. Try describing it differently.', tooLong: 'The description got too long.', unreadable: 'Couldn’t read the description. Try again.' },
  })
  return { name: out.name.slice(0, 40) || description.slice(0, 40), prompt: out.prompt.trim(), format: out.format }
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
}

export const PictureReview = z.object({
  critique: z.string().describe('What reads well and what doesn’t, in one to three sentences, for the designer'),
  done: z.boolean().describe('true if the drones already read clearly as the subject'),
  detail: z.number().optional().describe('New detail 0–1 (lower: fewer, bolder lines — fixes clutter where lines blur together; higher: more of the picture’s lines — brings back missing features)'),
  sensitivity: z.number().optional().describe('New line sensitivity 0–1 (higher picks up fainter lines; lower ignores faint glow and background specks)'),
  format: z.enum(['square', 'landscape', 'portrait']).optional().describe('Shape for a new picture (landscape suits wide subjects and the usually wide sky)'),
  new_picture: z.string().optional().describe('If the picture itself is the problem (too intricate for the drone count, filled areas, dotted lines, a background, text, wrong subject): a complete new description of the picture’s content — subject, pose, defining features as lines, colours, level of detail (the line-art style is added automatically; don’t mention drones or dots)'),
})

/** Threshold for a 0–1 sensitivity (null = automatic). */
export function thresholdFor(sensitivity: number | undefined): number | null {
  return sensitivity === undefined ? null : Math.max(0.05, Math.min(0.7, 0.7 - 0.6 * sensitivity))
}

const SYSTEM = `You check drone light show formations made from pictures. A picture (glowing line art on black) is traced into drones: every bright line becomes one evenly spaced line of drones, in the picture's colours. With fewer drones, lines that would blur together at their spacing are left out (lower detail leaves out more). Judge the drones as an audience would at night, compared with the picture and the subject, and choose the smallest fix: approve, change detail or sensitivity, or (only when the picture itself is wrong or far too intricate for the drone count) describe a new picture.`

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
export async function createPicture(description: string, opts: { n: number; rounds: number; detail?: number; expand?: boolean; limits?: Limits; signal?: AbortSignal; onUpdate?: (attempts: PictureAttempt[], busy: 'writing' | 'drawing' | 'looking' | null) => void }): Promise<PictureAttempt[]> {
  const attempts: PictureAttempt[] = []
  const emit = (busy: 'writing' | 'drawing' | 'looking' | null) => opts.onUpdate?.(attempts.map((a) => ({ ...a })), busy)
  // A short request becomes a full picture description first.
  let name = description.trim().slice(0, 40), prompt = description.trim(), format: ImageFormat = 'square'
  if (opts.expand !== false) {
    emit('writing')
    const e = await expandPrompt(description, opts.n, opts.signal)
    name = e.name
    prompt = e.prompt
    format = e.format
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
    if (r.detail === undefined && r.sensitivity === undefined) { current.verdict = 'good'; break }
    current.verdict = 'adjusted'
    const source: PictureSource = { ...current.source, detail: Math.max(0, Math.min(1, r.detail ?? current.source.detail)), threshold: r.sensitivity === undefined ? current.source.threshold : thresholdFor(r.sensitivity) }
    attempts.push({ name: current.name, source, shape: await traceSource(source, current.name) })
  }
  emit(null)
  return attempts
}

/** A custom picture for the show generator and the copilot: expanded, drawn, traced and checked once. */
export async function pictureFor(description: string, n: number, limits: Limits | undefined, signal?: AbortSignal): Promise<PictureShape> {
  const attempts = await createPicture(description, { n, rounds: 1, limits, signal })
  return attempts[attempts.length - 1]!.shape
}
