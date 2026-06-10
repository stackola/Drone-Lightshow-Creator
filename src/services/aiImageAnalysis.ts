// ============================================================================
// S32-01 to S32-03: AI Image Analysis via Claude Vision
// ============================================================================
// Sends an image to Claude's vision API to analyze content and suggest
// optimal formation parameters (drone count, threshold, scale).
// ============================================================================

import { useAIChatStore } from '../stores/aiChatStore'

// S32-02: Analysis result type
export interface ImageAnalysisResult {
  suggestedDroneCount: number
  suggestedThreshold: number
  suggestedScale: number
  contentDescription: string
  complexity: 'simple' | 'moderate' | 'complex'
}

// S32-01: Send image to Claude Vision API
export async function analyzeImageForFormation(imageBase64: string): Promise<ImageAnalysisResult> {
  const { settings } = useAIChatStore.getState()
  if (!settings.enabled || !settings.apiKey) {
    throw new Error('AI not configured. Set your API key in the AI chat settings.')
  }

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
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: 'image/png',
              data: imageBase64.replace(/^data:image\/\w+;base64,/, ''),
            },
          },
          {
            type: 'text',
            text: `Analyze this image for creating a drone formation. Respond with ONLY valid JSON (no markdown, no explanation) in this exact format:
{
  "suggestedDroneCount": <number 50-500 based on image complexity>,
  "suggestedThreshold": <number 50-200 for dark pixel threshold>,
  "suggestedScale": <number 20-60 for world-space scale in meters>,
  "contentDescription": "<brief description of what the image shows>",
  "complexity": "<simple|moderate|complex>"
}

Guidelines:
- Simple images (logos, text, basic shapes): 50-150 drones, threshold 128, scale 25-35
- Moderate images (detailed logos, multi-element scenes): 150-300 drones, threshold 100-150, scale 30-45
- Complex images (photos, detailed art): 300-500 drones, threshold 80-130, scale 40-60
- Lower threshold = more detail captured (more pixels pass)
- Higher scale = larger formation in sky`,
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

  // S32-02: Parse response
  try {
    // Try to extract JSON from the response (Claude might wrap it in backticks)
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) throw new Error('No JSON found in response')
    const parsed = JSON.parse(jsonMatch[0]) as ImageAnalysisResult

    return {
      suggestedDroneCount: Math.max(50, Math.min(500, parsed.suggestedDroneCount ?? 100)),
      suggestedThreshold: Math.max(50, Math.min(200, parsed.suggestedThreshold ?? 128)),
      suggestedScale: Math.max(20, Math.min(60, parsed.suggestedScale ?? 30)),
      contentDescription: parsed.contentDescription ?? 'Image',
      complexity: ['simple', 'moderate', 'complex'].includes(parsed.complexity) ? parsed.complexity : 'moderate',
    }
  } catch {
    // Fallback if parsing fails
    return {
      suggestedDroneCount: 100,
      suggestedThreshold: 128,
      suggestedScale: 30,
      contentDescription: 'Image (analysis parsing failed)',
      complexity: 'moderate',
    }
  }
}

// S32-01: Convert File to base64
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}
