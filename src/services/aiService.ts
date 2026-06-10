// ============================================================================
// S23: AI Service — LLM integration for text-to-formation and suggestions
// S23-01: AIService module, S23-02: Settings, S23-03: Prompt templates
// S23-04: Code sandbox, S23-05: Text-to-formation, S23-06: Refinement
// S23-07: Transition suggestion
// ============================================================================

import type { Vec3 } from '../graph/types'

export interface AISettings {
  apiKey: string
  model: string
  enabled: boolean
}

export interface AIGenerationResult {
  points: Vec3[]
  name: string
  description: string
}

// S23-01: API integration layer
let settings: AISettings = {
  apiKey: '',
  model: 'claude-sonnet-4-6',
  enabled: false,
}

export function configureAI(config: Partial<AISettings>): void {
  settings = { ...settings, ...config }
}

export function getAISettings(): AISettings {
  return { ...settings }
}

export function isAIEnabled(): boolean {
  return settings.enabled && settings.apiKey.length > 0
}

// S23-03: Prompt templates
const FORMATION_PROMPT = `You are a drone show formation generator. Given a description, output a JavaScript function that returns an array of {x, y, z} points.
The function signature is: function generate(count) { ... return points; }
Only output the function body. No explanation.

Description: {{description}}
Target drone count: {{count}}`

// S23-05: AI text-to-formation
export async function aiTextToFormation(description: string, count: number): Promise<AIGenerationResult> {
  if (!isAIEnabled()) {
    throw new Error('AI is not configured. Please set your API key in Settings.')
  }

  const prompt = FORMATION_PROMPT
    .replace('{{description}}', description)
    .replace('{{count}}', String(count))

  // Call Claude API
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
      max_tokens: 2048,
      messages: [{ role: 'user', content: prompt }],
    }),
  })

  if (!response.ok) {
    throw new Error(`AI API error: ${response.status} ${response.statusText}`)
  }

  const data = await response.json()
  const code = data.content?.[0]?.text ?? ''

  // S23-04: Execute in sandboxed Web Worker
  const points = await executeSandboxed(code, count)

  return {
    points,
    name: `AI: ${description.slice(0, 30)}`,
    description,
  }
}

// S23-04: Code sandbox — execute LLM-generated code in isolated context
function executeSandboxed(code: string, count: number): Promise<Vec3[]> {
  return new Promise((resolve, reject) => {
    const workerCode = `
      self.onmessage = function(e) {
        try {
          const count = e.data.count;
          const fn = new Function('count', e.data.code);
          const result = fn(count);
          if (!Array.isArray(result)) throw new Error('Generator must return an array');
          const validated = result.map(p => ({
            x: Number(p.x) || 0,
            y: Number(p.y) || 0,
            z: Number(p.z) || 0,
          }));
          self.postMessage({ success: true, points: validated });
        } catch (err) {
          self.postMessage({ success: false, error: err.message });
        }
      };
    `
    const blob = new Blob([workerCode], { type: 'application/javascript' })
    const url = URL.createObjectURL(blob)
    const worker = new Worker(url)

    const timeout = setTimeout(() => {
      worker.terminate()
      URL.revokeObjectURL(url)
      reject(new Error('AI code execution timed out (5s limit)'))
    }, 5000)

    worker.onmessage = (e) => {
      clearTimeout(timeout)
      worker.terminate()
      URL.revokeObjectURL(url)
      if (e.data.success) resolve(e.data.points)
      else reject(new Error(`AI code error: ${e.data.error}`))
    }

    worker.onerror = () => {
      clearTimeout(timeout)
      worker.terminate()
      URL.revokeObjectURL(url)
      reject(new Error('AI code execution failed'))
    }

    worker.postMessage({ code, count })
  })
}

// S23-07: AI transition suggestion
export async function aiSuggestTransition(
  sourceDescription: string,
  targetDescription: string,
): Promise<{ strategyId: string; reason: string }> {
  if (!isAIEnabled()) {
    // Fallback heuristic
    return { strategyId: 'shortest-path', reason: 'Default: shortest path (AI not configured)' }
  }

  const prompt = `Given a drone show transitioning from "${sourceDescription}" to "${targetDescription}", which transition type would look best?
Options: shortest-path, ant-walk, stagger, spiral, explosion, implosion, cascade, morph, bounce
Respond with just the strategy ID and a one-sentence reason, formatted as: STRATEGY: reason`

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
      max_tokens: 256,
      messages: [{ role: 'user', content: prompt }],
    }),
  })

  if (!response.ok) throw new Error(`AI API error: ${response.status}`)
  const data = await response.json()
  const text = data.content?.[0]?.text ?? ''
  const [strategyId, ...reasonParts] = text.split(':')
  return {
    strategyId: (strategyId ?? 'shortest-path').trim().toLowerCase(),
    reason: reasonParts.join(':').trim() || 'AI suggested',
  }
}
