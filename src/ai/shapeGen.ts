// "Describe a formation": Claude draws a bold SVG silhouette, which is
// rasterised and sampled into drone positions with the drawing's colours.

import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import type { BetaContentBlockParam } from '@anthropic-ai/sdk/resources/beta/messages/messages'
import type { ShapeSpec } from '@/core/types'
import { SvgShape } from './schemas'
import { RefusalError, baseParams, getClient, recordUsage } from './client'
import { imageShape } from '@/ui/content'

const SYSTEM = `You draw formations for drone light shows: hundreds of drones, each a single point of coloured light about 3 metres from its neighbours, seen from far away against a night sky. You draw each formation as an SVG silhouette that is then filled evenly with drones.

Rules for the SVG:
- <svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400"> with a transparent background (no background rectangle).
- Only filled shapes: path, polygon, circle, ellipse, rect, g. No text elements, strokes, gradients, filters, masks, clip paths, images, scripts or external references.
- One bold, instantly recognisable silhouette that fills most of the canvas. Every part at least 24 units thick: thin lines, small details and gaps under 20 units disappear when drawn with drones.
- 1–4 bright, saturated fill colours; they become the drones' light colours. Never black, grey or very dark fills.
- Prefer a clean side or front view with a distinctive outline over perspective.`

export interface DrawnFormation {
  name: string
  svg: string
}

function checkSvg(svg: string): string {
  const s = svg.trim()
  if (!/^<svg[\s>]/i.test(s) || !/<\/svg>\s*$/i.test(s)) throw new Error('The drawing was not a complete SVG. Try again.')
  if (s.length > 80000) throw new Error('The drawing was too detailed. Try a simpler description.')
  if (/<script|<foreignObject|\bon\w+\s*=|(?:href|src)\s*=\s*["']\s*(?:https?:|javascript:|data:)/i.test(s)) throw new Error('The drawing used features that aren’t allowed. Try again.')
  return s
}

export async function drawFormation(description: string, opts: { feedback?: string; previous?: DrawnFormation; previewPng?: string; signal?: AbortSignal } = {}): Promise<DrawnFormation> {
  const client = getClient()
  const content: BetaContentBlockParam[] = [{ type: 'text', text: `Draw this formation: ${description.trim()}` }]
  if (opts.previous) {
    content.push({ type: 'text', text: `Your previous drawing:\n${opts.previous.svg}` })
    if (opts.previewPng) {
      content.push({ type: 'text', text: 'This is how it came out as drones (front view):' })
      content.push({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: opts.previewPng } })
    }
    content.push({ type: 'text', text: `Improve it. ${opts.feedback?.trim() ? `The designer says: ${opts.feedback.trim()}` : 'Make it bolder and easier to recognise as drones.'}` })
  }
  const stream = client.beta.messages.stream(
    {
      ...baseParams(),
      max_tokens: 16000,
      system: SYSTEM,
      output_config: { effort: 'medium', format: zodOutputFormat(SvgShape) },
      messages: [{ role: 'user', content }],
    },
    { signal: opts.signal },
  )
  const msg = await stream.finalMessage()
  recordUsage(msg.usage)
  if (msg.stop_reason === 'refusal') throw new RefusalError('Claude declined to draw that. Try describing it differently.')
  if (msg.stop_reason === 'max_tokens') throw new Error('The drawing got too long. Try a simpler description.')
  const text = msg.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('')
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new Error('Couldn’t read the drawing. Try again.')
  }
  const parsed = SvgShape.safeParse(raw)
  if (!parsed.success) throw new Error('Couldn’t read the drawing. Try again.')
  return { name: parsed.data.name.slice(0, 40) || 'Custom', svg: checkSvg(parsed.data.svg) }
}

/** Rasterise an SVG drawing into an image shape (browser only). */
export async function formationFromSvg(drawn: DrawnFormation, size = 40): Promise<Extract<ShapeSpec, { kind: 'image' }>> {
  const file = new File([drawn.svg], `${drawn.name.replace(/[^\w-]+/g, '-').toLowerCase() || 'custom'}.svg`, { type: 'image/svg+xml' })
  const shape = await imageShape(file, size)
  return { ...shape, name: drawn.name }
}

/** Describe → draw → shape, in one call. */
export async function describeToShape(description: string, signal?: AbortSignal): Promise<{ drawn: DrawnFormation; shape: Extract<ShapeSpec, { kind: 'image' }> }> {
  const drawn = await drawFormation(description, { signal })
  return { drawn, shape: await formationFromSvg(drawn) }
}
