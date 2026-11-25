// "Describe a formation": Claude draws an SVG — strokes for outlines and
// details, fills for solid areas — which becomes drones: every stroke one
// evenly spaced line of drones along its path, every filled area filled
// evenly, each drone in the drawing's colour there. Then Claude compares its
// drawing with the drones and fixes what got lost.

import type { BetaContentBlockParam } from '@anthropic-ai/sdk/resources/beta/messages/messages'
import { z } from 'zod'
import type { ShapeSpec } from '@/core/types'
import { SvgShape } from './schemas'
import { submitObject } from './submit'
import { svgShape } from '@/ui/content'
import { generateShape } from '@/core/shapes'
import { modelPoses, describeJoint } from '@/core/joints'
import { frontStrip, shapePreview } from './render'

const SYSTEM = `You draw formations for drone light shows: a few hundred drones, each a single point of coloured light metres from its neighbours, seen from far away against a night sky. You draw in SVG; the engine turns the drawing into drones:
- every STROKE becomes one line of drones evenly spaced along its path (crisp, single file) — use strokes for outlines, contours and details (eyes, feathers, rays, lettering lines, the edge of a petal);
- every FILLED area is filled evenly with drones — use fills for solid masses that should glow as a patch (a sun, a heart, a body), sparingly;
- each drone takes the colour of the drawing where it sits (gradients included).

Rules for the SVG:
- <svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400">, transparent background (no background rectangle).
- Elements: path, line, polyline, polygon, circle, ellipse, rect, g, plus linearGradient/radialGradient in <defs>. No text elements, filters, masks, clip paths, images, scripts or external references.
- Strokes: stroke-width 4–10, stroke-linecap and stroke-linejoin "round"; give stroke-only elements fill="none". A stroke is one line of drones however wide it is drawn.
- The subject fills most of the canvas. Keep separate lines at least two drone spacings apart, or they merge.
- Design for the drone budget you are given: one drone every S units along a stroke, one per about 0.87·S² units of filled area. Spend drones on what makes the subject recognisable; detail smaller than about 2·S vanishes.
- Line art reads best: a clean outline plus the few inner lines that make it unmistakable, with fills only where a solid glow helps.

Colour (the drones are lights in the dark):
- Bright, saturated colours; never black, grey or very dark (they vanish — dark ink becomes white light).
- 2–6 colours that belong together, with a contrasting accent where the eye should go. Gradients (e.g. a flame from deep orange to yellow, a sky from violet to blue) look rich in drones.
- Neighbouring parts in contrasting colours read as separate.

Moving parts — only when the description implies motion (wings flapping, a hand waving, a tail wagging, a pendulum, a wheel or windmill turning, a heart beating up and down):
- Wrap each moving part in <g data-part="Left wing" data-motion="swing" data-pivot="x y" data-amount="15" data-period="10">…</g>. Every stroke and fill inside moves with it as one rigid piece; everything else stays still.
- data-motion: swing (back and forth by ± data-amount degrees, once per data-period seconds), turn (round and round at data-amount degrees per second) or slide (± data-amount metres, along data-axis "0 1 0" = up and down).
- data-pivot is the hinge in the canvas's coordinates (inside a transformed group, the group's own): exactly where the part attaches — a wing at the shoulder, an arm at the elbow or shoulder, a pendulum at its top — never its middle. Swings and turns happen in the drawing's plane.
- Mirrored pairs (left and right wings) move together with data-axis="0 0 -1" on the left one and "0 0 1" on the right, same phase; data-phase="0.5" makes a part move the opposite way (walking legs, waving in turn).
- A part can hang off another: nest its <g data-part> inside the other's (a hand inside an arm, a wingtip inside a wing) — a little lag (data-phase="-0.1") makes it fluid.
- Join each moving part to the still drawing at one point — its pivot: a wing meets the body at the shoulder, a pendulum hangs from its pin. Near the pivot drones barely move, so touching there is fine; what collides is a moving edge running alongside a still line (a wing root drawn along the body's side). Everywhere else keep at least 2·S of clear sky between the part and the still lines it swings toward. The figure should still look whole and connected at rest.
- Gentle and slow reads best and is all the drones can fly: the whole drawing is often 100–250 m across, and drones climb at most 3 m/s and descend 2 m/s, so a wing tip far from its shoulder can only rise a little per beat. Prefer 8–16 s per beat and 10–25° (the engine calms anything faster to what the drones can fly, keeping the beat).`

export interface DrawnFormation {
  name: string
  svg: string
}

export const DrawingReview = z.object({
  critique: z.string().describe('What reads well and what is wrong, in one to three sentences'),
  done: z.boolean().describe('true only if the drones already read clearly as the description; then the drawing is kept as is'),
  name: z.string().optional().describe('Name for the improved drawing'),
  svg: z.string().optional().describe('The complete improved SVG (required when done is false)'),
})

/** Drone spacing in canvas units for a budget of n drones (a typical mix of strokes and fills). */
function budget(n: number): string {
  const S = Math.round(400 / (1.25 * Math.sqrt(Math.max(1, n))))
  return `Drone budget: ${n} drones, about S = ${S} units apart on the 400-unit canvas (≈ ${Math.round(n * S)} units of stroke if it were all lines, or a filled area of about ${Math.round(0.87 * S * S * n)} square units if it were all fill).`
}

function checkSvg(svg: string): string {
  const s = svg.trim()
  if (!/^<svg[\s>]/i.test(s) || !/<\/svg>\s*$/i.test(s)) throw new Error('The drawing was not a complete SVG. Try again.')
  if (s.length > 120000) throw new Error('The drawing was too detailed. Try a simpler description.')
  if (/<script|<foreignObject|<image|\bon\w+\s*=|(?:href|src)\s*=\s*["']\s*(?:https?:|javascript:|data:)/i.test(s)) throw new Error('The drawing used features that aren’t allowed. Try again.')
  return s
}

const MESSAGES = { refusal: 'Claude declined to draw that. Try describing it differently.', tooLong: 'The drawing got too long. Try a simpler description.', unreadable: 'Couldn’t read the drawing. Try again.' }

export async function drawFormation(description: string, opts: { n?: number; feedback?: string; previous?: DrawnFormation; previewPng?: string; drawingPng?: string; signal?: AbortSignal } = {}): Promise<DrawnFormation> {
  const content: BetaContentBlockParam[] = [{ type: 'text', text: `Draw this formation: ${description.trim()}${opts.n ? `\n${budget(opts.n)}` : ''}` }]
  if (opts.previous) {
    content.push({ type: 'text', text: `Your previous drawing:\n${opts.previous.svg}` })
    if (opts.drawingPng) {
      content.push({ type: 'text', text: 'Your drawing:' })
      content.push({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: opts.drawingPng } })
    }
    if (opts.previewPng) {
      content.push({ type: 'text', text: 'How it came out as drones (front view):' })
      content.push({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: opts.previewPng } })
    }
    content.push({ type: 'text', text: `Improve it. ${opts.feedback?.trim() ? `The designer says: ${opts.feedback.trim()}` : 'Make it read more clearly as drones.'}` })
  }
  const out = await submitObject({
    schema: SvgShape,
    tool: { name: 'submit_drawing', description: 'Submit the finished formation drawing: a short name and the complete SVG document.' },
    label: 'Drawing',
    system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
    content,
    maxTokens: 24000,
    effort: 'high',
    signal: opts.signal,
    messages: MESSAGES,
  })
  return { name: out.name.slice(0, 40) || 'Custom', svg: checkSvg(out.svg) }
}

/** An SVG drawing as a formation (browser only). */
export async function formationFromSvg(drawn: DrawnFormation, size = 40): Promise<Extract<ShapeSpec, { kind: 'image' }>> {
  return svgShape(drawn.svg, size, drawn.name)
}

/** The drawing itself on a night sky, as Claude drew it (PNG base64; browser only). */
export async function drawingPng(svg: string): Promise<string> {
  const img = new Image()
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))
  try {
    img.src = url
    await img.decode()
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  const canvas = document.createElement('canvas')
  canvas.width = 360
  canvas.height = 360
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#04060b'
  ctx.fillRect(0, 0, 360, 360)
  ctx.drawImage(img, 0, 0, 360, 360)
  return canvas.toDataURL('image/png').split(',')[1]!
}

/**
 * Describe → draw → compare the drawing with its drones → fix, up to `rounds`
 * times or until Claude is satisfied.
 */
export async function drawAndCheck(description: string, n: number, signal?: AbortSignal, rounds = 2): Promise<{ drawn: DrawnFormation; shape: Extract<ShapeSpec, { kind: 'image' }>; critique?: string }> {
  let drawn = await drawFormation(description, { n, signal })
  let shape = await formationFromSvg(drawn)
  let critique: string | undefined
  for (let round = 0; round < rounds; round++) {
    const dots = generateShape({ ...shape, size: 10 }, Math.max(20, n))
    // With moving parts: the drones at rest and at both ends of the motion, front view.
    const poses = shape.joints?.length ? modelPoses({ ...shape, size: 10 }, Math.max(20, n), generateShape) : null
    const motion: BetaContentBlockParam[] = poses
      ? [
          { type: 'text', text: `Its moving parts (${shape.joints!.map((j) => `${j.name} ${describeJoint(j)}`).join('; ')}) — the drones at rest and at both ends of the motion, before the engine calms it to what the drones can fly:` },
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: frontStrip(poses, dots.colors, `${drawn.name}: moving parts`) } },
        ]
      : []
    const content: BetaContentBlockParam[] = [
      { type: 'text', text: `The formation should depict: ${description.trim()}\n${budget(n)}` },
      { type: 'text', text: `Your drawing:\n${drawn.svg}` },
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: await drawingPng(drawn.svg) } },
      { type: 'text', text: `How it actually comes out as ${n} drones (strokes become lines of drones, fills are filled evenly):` },
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: shapePreview(dots.points, dots.colors, drawn.name) } },
      ...motion,
      {
        type: 'text',
        text: [
          'Compare them as the audience would see the drones:',
          '- Instantly recognisable? Outline and proportions right?',
          '- Did the defining details survive, or did lines merge, vanish or get too few drones? Too many lines for the budget makes every line coarse: simplify.',
          '- Are fills earning their drones, or would an outline read better? Are the colours bright, separated and pleasing?',
          ...(poses ? ['- The motion: does each part hinge where it attaches (not tearing away from or crashing through the still lines), move the right way (pairs together), and read as the motion described? Anything that should move but stays still (outside its data-part group)?'] : []),
          'If it already reads clearly, set done = true. Otherwise return an improved complete SVG.',
        ].join('\n'),
      },
    ]
    const review = await submitObject({
      schema: DrawingReview,
      tool: { name: 'submit_review', description: 'Submit your review of the drones as drawn: the critique, whether it is done, and (if not) the improved SVG.' },
      label: 'Look & fix (drawing)',
      system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
      content,
      maxTokens: 24000,
      effort: 'high',
      signal,
      messages: MESSAGES,
    })
    critique = review.critique
    if (review.done || !review.svg) break
    drawn = { name: (review.name ?? drawn.name).slice(0, 40) || drawn.name, svg: checkSvg(review.svg) }
    shape = await formationFromSvg(drawn)
  }
  return { drawn, shape, critique }
}

/** Describe → draw → shape, in one call. */
export async function describeToShape(description: string, signal?: AbortSignal): Promise<{ drawn: DrawnFormation; shape: Extract<ShapeSpec, { kind: 'image' }> }> {
  const drawn = await drawFormation(description, { signal })
  return { drawn, shape: await formationFromSvg(drawn) }
}
