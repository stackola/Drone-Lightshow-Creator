// OpenAI image generation, straight from the browser (the API allows it).
// The key is stored only in this browser, like the Claude key.

const STORAGE_KEY = 'dsd.openai.v1'

export interface ImageSettings {
  apiKey: string
  /** Image model, e.g. gpt-image-2. */
  model: string
  quality: 'low' | 'medium' | 'high'
}

export const IMAGE_MODELS = ['gpt-image-2', 'gpt-image-1.5', 'gpt-image-1-mini'] as const
const DEFAULTS: ImageSettings = { apiKey: '', model: 'gpt-image-2', quality: 'medium' }

export function loadImageSettings(): ImageSettings {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Partial<ImageSettings>
    return { ...DEFAULTS, ...raw, apiKey: typeof raw.apiKey === 'string' ? raw.apiKey : '' }
  } catch {
    return { ...DEFAULTS }
  }
}

export function saveImageSettings(s: ImageSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...s, apiKey: s.apiKey.trim() }))
  } catch { /* private mode: not saved */ }
}

export function imagesConfigured(s = loadImageSettings()): boolean {
  return !!s.apiKey.trim()
}

export class ImageError extends Error {}

export type ImageFormat = 'square' | 'landscape' | 'portrait'
const SIZES: Record<ImageFormat, string> = { square: '1024x1024', landscape: '1536x1024', portrait: '1024x1536' }

/** Generate one picture; resolves to PNG base64 (no data: prefix). */
export async function generateImage(prompt: string, opts: { signal?: AbortSignal; settings?: ImageSettings; format?: ImageFormat } = {}): Promise<string> {
  const s = opts.settings ?? loadImageSettings()
  if (!s.apiKey.trim()) throw new ImageError('Add an OpenAI API key in AI settings to generate pictures.')
  let res: Response
  try {
    res = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { Authorization: `Bearer ${s.apiKey.trim()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: s.model, prompt, size: SIZES[opts.format ?? 'square'], quality: s.quality, n: 1 }),
      signal: opts.signal,
    })
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err
    throw new ImageError('Couldn’t reach OpenAI. Check your connection and try again.')
  }
  if (!res.ok) {
    let message = ''
    try { message = ((await res.json()) as { error?: { message?: string } }).error?.message ?? '' } catch { /* not JSON */ }
    if (res.status === 401) throw new ImageError('OpenAI rejected the API key. Check it in AI settings.')
    if (res.status === 429) throw new ImageError('OpenAI rate limit or quota reached. Wait a moment, or check your OpenAI billing.')
    if (res.status === 400 && /safety|policy|moderation/i.test(message)) throw new ImageError('OpenAI declined that picture. Try describing it differently.')
    throw new ImageError(`OpenAI error ${res.status}${message ? `: ${message}` : ''}`)
  }
  const body = (await res.json()) as { data?: { b64_json?: string }[] }
  const b64 = body.data?.[0]?.b64_json
  if (!b64) throw new ImageError('OpenAI returned no picture. Try again.')
  return b64
}

/** Free check that the key works (lists models). */
export async function testImageKey(apiKey: string): Promise<void> {
  const res = await fetch('https://api.openai.com/v1/models', { headers: { Authorization: `Bearer ${apiKey.trim()}` } })
  if (res.status === 401) throw new ImageError('OpenAI rejected the API key.')
  if (!res.ok) throw new ImageError(`OpenAI error ${res.status}`)
}
