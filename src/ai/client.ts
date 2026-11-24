// Claude API access for AI features.
//
// The editor is a static web app, so requests go straight from the browser to
// the Claude API with the user's own key (kept only in this browser's
// localStorage), or through a proxy the user runs that adds the key itself.

import Anthropic from '@anthropic-ai/sdk'
import type { BetaContentBlock, BetaContentBlockParam } from '@anthropic-ai/sdk/resources/beta/messages/messages'

export const MODEL = 'claude-opus-5-5'
export const MODEL_LABEL = 'Claude Opus 5.5'

/**
 * Server-side refusal fallback: if a safety classifier declines a request, the
 * API retries it on Anthropic's recommended fallback model within the same
 * call instead of returning the refusal.
 */
export const FALLBACK_BETA = 'server-side-fallback-2026-07-01'

export interface AiSettings {
  apiKey: string
  /** Optional proxy that forwards to the Claude API and adds the key server-side. */
  baseURL: string
}

const STORAGE_KEY = 'dsd.ai.settings.v1'

export function loadAiSettings(): AiSettings {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Partial<AiSettings>
    return { apiKey: typeof raw.apiKey === 'string' ? raw.apiKey : '', baseURL: typeof raw.baseURL === 'string' ? raw.baseURL : '' }
  } catch {
    return { apiKey: '', baseURL: '' }
  }
}

export function saveAiSettings(s: AiSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ apiKey: s.apiKey.trim(), baseURL: s.baseURL.trim() }))
  } catch {
    /* storage unavailable: settings last for this session only */
  }
  cached = null
}

export function aiConfigured(s = loadAiSettings()): boolean {
  return !!(s.apiKey || s.baseURL)
}

export function usingProxy(): boolean {
  return !!loadAiSettings().baseURL
}

export class AiNotConfigured extends Error {
  constructor() {
    super('Add a Claude API key in AI settings to use AI features.')
  }
}

let cached: { key: string; client: Anthropic } | null = null

export function getClient(): Anthropic {
  const s = loadAiSettings()
  if (!aiConfigured(s)) throw new AiNotConfigured()
  const key = `${s.apiKey}|${s.baseURL}`
  if (cached?.key === key) return cached.client
  const client = new Anthropic({
    // With a proxy the key is added server-side; the SDK still needs a value to send.
    apiKey: s.apiKey || 'set-by-proxy',
    baseURL: s.baseURL || undefined,
    // The key is the user's own and stays in their browser; see the AI settings dialog.
    dangerouslyAllowBrowser: true,
    maxRetries: 2,
  })
  cached = { key, client }
  return client
}

/** Parameters shared by every request. */
export function baseParams() {
  return {
    model: MODEL,
    betas: [FALLBACK_BETA],
    fallbacks: 'default' as const,
  }
}

/**
 * Eager input streaming makes long tool inputs stream as they are generated.
 * A proxy in front of the API may reject the field, so only send it direct.
 */
export function eagerStreaming(): boolean {
  return !usingProxy()
}

/** A short, human explanation for any error from an AI request. */
export function describeError(err: unknown): string {
  if (err instanceof AiNotConfigured) return err.message
  if (err instanceof Anthropic.APIUserAbortError) return 'Stopped.'
  if (err instanceof Anthropic.AuthenticationError) return 'The API key was rejected. Check it in AI settings.'
  if (err instanceof Anthropic.PermissionDeniedError) return 'This API key doesn’t have access to the model. Check your Claude Console account.'
  if (err instanceof Anthropic.RateLimitError) return 'Rate limited by the Claude API — wait a moment and try again.'
  if (err instanceof Anthropic.BadRequestError) return `The request was rejected: ${err.message}`
  if (err instanceof Anthropic.InternalServerError) return 'The Claude API had a problem. Try again in a moment.'
  if (err instanceof Anthropic.APIConnectionError) return 'Couldn’t reach the Claude API. Check your connection (or the proxy URL in AI settings).'
  if (err instanceof Anthropic.APIError) return `Claude API error ${err.status ?? ''}: ${err.message}`
  return err instanceof Error ? err.message : String(err)
}

export class RefusalError extends Error {}

/**
 * Content to send back in history. After a mid-output fallback, blocks the
 * declining model produced before the last `fallback` boundary must not be
 * replayed except text: drop thinking, tool_use and other model-internal
 * blocks there, and keep every `fallback` block where it is.
 */
export function echoContent(content: BetaContentBlock[]): BetaContentBlock[] {
  let last = -1
  content.forEach((b, i) => { if (b.type === 'fallback') last = i })
  if (last < 0) return content
  return content.filter((b, i) => i >= last || b.type === 'text' || b.type === 'fallback')
}

export function asParams(content: BetaContentBlock[]): BetaContentBlockParam[] {
  return content as unknown as BetaContentBlockParam[]
}

// --- Usage ------------------------------------------------------------------------

export interface Usage {
  input: number
  output: number
  cacheRead: number
  requests: number
}

type UsageListener = (u: Usage) => void
const usage: Usage = { input: 0, output: 0, cacheRead: 0, requests: 0 }
const listeners = new Set<UsageListener>()

export function recordUsage(u: { input_tokens?: number | null; output_tokens?: number | null; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null } | null | undefined): void {
  if (!u) return
  usage.input += (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0)
  usage.cacheRead += u.cache_read_input_tokens ?? 0
  usage.output += u.output_tokens ?? 0
  usage.requests++
  listeners.forEach((l) => l({ ...usage }))
}

export function onUsage(l: UsageListener): () => void {
  listeners.add(l)
  l({ ...usage })
  return () => listeners.delete(l)
}
