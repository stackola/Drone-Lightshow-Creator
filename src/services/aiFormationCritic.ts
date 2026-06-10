// ============================================================================
// AI Formation Critic — Tier 4 vision feedback for AI-generated SVG formations
// ============================================================================
// Renders the AI-authored SVG to PNG, asks Claude Vision how well it depicts
// the requested concept, and returns a 0–10 score plus a concrete suggestion
// for improvement. The Tier 2 generator uses this in a bounded retry loop.
// ============================================================================

import { useAIChatStore } from '../stores/aiChatStore'

export interface CritiqueResult {
  score: number              // 0–10 recognizability rating
  suggestion: string         // one concrete change suggestion (used to re-prompt)
  rationale: string          // short reasoning, for debugging
}

export async function critiqueSvgFormation(
  concept: string,
  rasterPngDataUrl: string,
): Promise<CritiqueResult> {
  const { settings } = useAIChatStore.getState()
  if (!settings.enabled || !settings.apiKey) {
    throw new Error('AI not configured. Set your API key in the AI chat settings.')
  }

  const base64 = rasterPngDataUrl.replace(/^data:image\/\w+;base64,/, '')

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': settings.apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: settings.model,
      max_tokens: 512,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: 'image/png', data: base64 },
          },
          {
            type: 'text',
            text: `This is a silhouette intended to depict: "${concept}".
It will be reproduced by a drone formation (each black region becomes a cluster of drones).
Rate how clearly it reads as the intended subject from 0 (unrecognizable) to 10 (instantly recognizable).
If the score is below 7, give ONE concrete change that would most improve recognizability (e.g. "thicken the spire", "add a clearer base", "simplify the wheels").

Respond with ONLY valid JSON (no markdown):
{
  "score": <0-10 integer>,
  "suggestion": "<one concrete change, or empty string if score >= 7>",
  "rationale": "<one short sentence>"
}`,
          },
        ],
      }],
    }),
  })

  if (!response.ok) {
    const errText = await response.text().catch(() => '')
    throw new Error(`Vision API error ${response.status}: ${errText.slice(0, 200)}`)
  }

  const data = await response.json()
  const text = data.content?.[0]?.text ?? ''

  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) throw new Error('No JSON in critic response')
    const parsed = JSON.parse(jsonMatch[0]) as Partial<CritiqueResult>
    const rawScore = typeof parsed.score === 'number' ? parsed.score : 5
    return {
      score: Math.max(0, Math.min(10, Math.round(rawScore))),
      suggestion: typeof parsed.suggestion === 'string' ? parsed.suggestion : '',
      rationale: typeof parsed.rationale === 'string' ? parsed.rationale : '',
    }
  } catch (err) {
    // L5-toast: the previous behaviour silently returned a misleading score of
    // 5/10 when JSON parsing failed. Surface the real failure instead of lying.
    console.warn('[critic] parse failed:', err, '\nraw text:', text.slice(0, 200))
    throw new Error(`Formation critic returned unparseable JSON: ${(err as Error).message}`)
  }
}
