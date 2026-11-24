// Client pitch: a client-facing proposal written from the actual show — its
// scenes (seen as images), timing, music and exact safety figures.

import type { BetaContentBlockParam } from '@anthropic-ai/sdk/resources/beta/messages/messages'
import { RefusalError, baseParams, getClient, recordUsage } from './client'
import { summarizeShow } from './context'
import { contactSheet } from './render'
import { getState } from '@/state/store'
import { compile } from '@/core/compile'
import { validate } from '@/core/validate'

export const PITCH_SYSTEM = `You write client proposals for a drone light show studio. From the show data and images you are given, write a proposal the studio can send to its client.

Write in Markdown with these parts: a title line (# …), a short opening that sells the idea, "The show" (the experience moment by moment, with mm:ss times, written for a non-technical reader — describe what the audience sees and feels), "Music" (only if there is music), "Safety and logistics" (drone count, show length, airspace, and the safety figures exactly as given, explained plainly), and "Next steps".

Use only facts from the show data. Where the proposal needs something you don't have — dates, venue, prices, permits, contact names — write a placeholder in square brackets, like [venue]. Don't invent figures. Aim for 350–600 words.`

export interface PitchRequest {
  client: string
  occasion: string
  tone: string
  language: string
  notes: string
}

export async function writePitch(req: PitchRequest, onText: (snapshot: string) => void, signal?: AbortSignal): Promise<string> {
  const client = getClient()
  const doc = getState().doc
  const compiled = compile(doc)
  const validation = validate(doc, compiled)
  const content: BetaContentBlockParam[] = []
  const sheet = contactSheet(doc, compiled)
  if (sheet) {
    content.push({ type: 'text', text: 'The formations, as the audience sees them (opening colours):' })
    content.push({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: sheet.data } })
  }
  content.push({ type: 'text', text: `Show data:\n${summarizeShow(doc, compiled, validation)}` })
  content.push({
    type: 'text',
    text: [
      `Client: ${req.client.trim() || '[client]'}`,
      `Occasion: ${req.occasion.trim() || '[occasion]'}`,
      `Tone: ${req.tone}`,
      `Write in: ${req.language.trim() || 'English'}`,
      req.notes.trim() ? `Studio notes: ${req.notes.trim()}` : '',
      validation.issues.length ? 'Note: the show still has open safety issues; describe the safety section as "to be finalised" rather than stating it is verified.' : 'The show passes every safety check in the editor.',
    ].filter(Boolean).join('\n'),
  })
  const stream = client.beta.messages.stream(
    { ...baseParams(), max_tokens: 16000, system: PITCH_SYSTEM, output_config: { effort: 'medium' }, messages: [{ role: 'user', content }] },
    { signal },
  )
  stream.on('text', (_d, snapshot) => onText(snapshot))
  const msg = await stream.finalMessage()
  recordUsage(msg.usage)
  if (msg.stop_reason === 'refusal') throw new RefusalError('Claude declined to write this pitch.')
  return msg.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('')
}
