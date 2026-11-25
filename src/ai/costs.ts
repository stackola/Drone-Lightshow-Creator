// What the AI features cost: every Claude call (priced by the model that
// actually answered, from the token usage in its response) and every picture
// from the image model (from the usage OpenAI returns). Prices are USD per
// million tokens, published list prices; the user can override them in AI
// settings. The ledger lives in this browser only.

import { create } from 'zustand'

export interface ClaudePrice { input: number; output: number; cacheRead: number; cacheWrite: number }
export interface ImagePrice { textInput: number; imageInput: number; output: number }

/** Anthropic list prices (USD per million tokens). Cache writes are 5-minute writes (1.25 × input). */
export const CLAUDE_PRICES: Record<string, ClaudePrice> = {
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  'claude-opus-5': { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  'claude-opus-4-8': { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  'claude-opus-4-7': { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  'claude-fable-5-2': { input: 8, output: 40, cacheRead: 0.2, cacheWrite: 10 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 },
  'claude-sonnet-5': { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  'claude-haiku-5-5': { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
}

/** OpenAI image-model list prices (USD per million tokens): text input, image input, output (image) tokens. */
export const IMAGE_PRICES: Record<string, ImagePrice> = {
  'gpt-image-2': { textInput: 5, imageInput: 8, output: 30 },
  'gpt-image-1.5': { textInput: 5, imageInput: 8, output: 32 },
  'gpt-image-1-mini': { textInput: 2, imageInput: 2.5, output: 8 },
  'gpt-image-1': { textInput: 5, imageInput: 10, output: 40 },
}

const DEFAULT_CLAUDE = CLAUDE_PRICES['claude-opus-5-5']!
const DEFAULT_IMAGE = IMAGE_PRICES['gpt-image-2']!

export interface CostEntry {
  id: number
  at: number
  service: 'claude' | 'openai'
  model: string
  /** What it was for, e.g. "Picture description", "Look & fix". */
  label: string
  usd: number
  input: number
  output: number
  /** Claude: cache reads / writes; OpenAI: image input tokens. */
  cacheRead?: number
  cacheWrite?: number
  imageInput?: number
}

interface Stored {
  entries: CostEntry[]
  /** All spending ever recorded in this browser (entries are capped; this isn't). */
  total: number
  since: number
  overrides: { claude: Record<string, ClaudePrice>; image: Record<string, ImagePrice> }
}

const KEY = 'dsd.costs.v1'
const MAX_ENTRIES = 500

function load(): Stored {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<Stored> | null
    if (raw && Array.isArray(raw.entries)) {
      return { entries: raw.entries, total: Number(raw.total) || 0, since: Number(raw.since) || Date.now(), overrides: { claude: raw.overrides?.claude ?? {}, image: raw.overrides?.image ?? {} } }
    }
  } catch { /* fall through */ }
  return { entries: [], total: 0, since: Date.now(), overrides: { claude: {}, image: {} } }
}

function save(s: Stored) {
  try { localStorage.setItem(KEY, JSON.stringify(s)) } catch { /* storage full or unavailable */ }
}

interface CostState extends Stored {
  /** When this page was opened (the browser session). */
  sessionStart: number
  /** AI requests in flight right now (Claude or pictures). */
  running: number
  record: (e: Omit<CostEntry, 'id' | 'at'>) => void
  reset: () => void
  setClaudePrice: (model: string, p: ClaudePrice | null) => void
  setImagePrice: (model: string, p: ImagePrice | null) => void
}

let seq = 0

export const useCosts = create<CostState>()((set, get) => ({
  ...load(),
  sessionStart: Date.now(),
  running: 0,
  record: (e) => {
    const entry: CostEntry = { ...e, id: Date.now() * 1000 + (seq++ % 1000), at: Date.now() }
    const next = { ...get(), entries: [...get().entries, entry].slice(-MAX_ENTRIES), total: get().total + entry.usd }
    set({ entries: next.entries, total: next.total })
    save({ entries: next.entries, total: next.total, since: next.since, overrides: next.overrides })
  },
  reset: () => {
    const s = { entries: [], total: 0, since: Date.now(), overrides: get().overrides }
    set(s)
    save(s)
  },
  setClaudePrice: (model, p) => {
    const claude = { ...get().overrides.claude }
    if (p) claude[model] = p
    else delete claude[model]
    const overrides = { ...get().overrides, claude }
    set({ overrides })
    save({ entries: get().entries, total: get().total, since: get().since, overrides })
  },
  setImagePrice: (model, p) => {
    const image = { ...get().overrides.image }
    if (p) image[model] = p
    else delete image[model]
    const overrides = { ...get().overrides, image }
    set({ overrides })
    save({ entries: get().entries, total: get().total, since: get().since, overrides })
  },
}))

/** Price per million tokens for a Claude model (override, list price, or the closest family's). */
export function claudePrice(model: string): ClaudePrice {
  const o = useCosts.getState().overrides.claude
  if (o[model]) return o[model]!
  if (CLAUDE_PRICES[model]) return CLAUDE_PRICES[model]!
  const family = Object.keys(CLAUDE_PRICES).find((k) => model.startsWith(k))
  return family ? CLAUDE_PRICES[family]! : DEFAULT_CLAUDE
}

export function imagePrice(model: string): ImagePrice {
  return useCosts.getState().overrides.image[model] ?? IMAGE_PRICES[model] ?? DEFAULT_IMAGE
}

export interface ClaudeUsage { input_tokens?: number | null; output_tokens?: number | null; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null }

/** Record one Claude response (call with the response's own `model`, which a refusal fallback may change). */
export function recordClaude(model: string, u: ClaudeUsage, label: string): void {
  const p = claudePrice(model)
  const input = u.input_tokens ?? 0, output = u.output_tokens ?? 0, cacheRead = u.cache_read_input_tokens ?? 0, cacheWrite = u.cache_creation_input_tokens ?? 0
  const usd = (input * p.input + output * p.output + cacheRead * p.cacheRead + cacheWrite * p.cacheWrite) / 1e6
  useCosts.getState().record({ service: 'claude', model, label, usd, input, output, cacheRead, cacheWrite })
}

export interface ImageUsage { input_tokens?: number; output_tokens?: number; input_tokens_details?: { text_tokens?: number; image_tokens?: number } }

/** Record one generated picture from OpenAI's usage block. */
export function recordImage(model: string, u: ImageUsage | undefined, label: string): void {
  const p = imagePrice(model)
  const text = u?.input_tokens_details?.text_tokens ?? u?.input_tokens ?? 0
  const image = u?.input_tokens_details?.image_tokens ?? 0
  const output = u?.output_tokens ?? 0
  const usd = (text * p.textInput + image * p.imageInput + output * p.output) / 1e6
  useCosts.getState().record({ service: 'openai', model, label, usd, input: text, output, imageInput: image })
}

/** Count a request as running until it settles (drives the "spending" pulse). */
export async function tracked<T>(p: Promise<T>): Promise<T> {
  useCosts.setState((s) => ({ running: s.running + 1 }))
  try {
    return await p
  } finally {
    useCosts.setState((s) => ({ running: Math.max(0, s.running - 1) }))
  }
}

/** Sum of entries since a time. */
export function spentSince(entries: CostEntry[], since: number): number {
  let s = 0
  for (const e of entries) if (e.at >= since) s += e.usd
  return s
}

export function startOfToday(): number {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** Typical cost of a kind of call: the median of the recent ones, else a fallback. */
export function typicalCost(entries: CostEntry[], label: string, fallback: number): number {
  const xs = entries.filter((e) => e.label === label).slice(-12).map((e) => e.usd).sort((a, b) => a - b)
  return xs.length ? xs[Math.floor(xs.length / 2)]! : fallback
}

/** $0.0042 → "$0.004", $0.153 → "$0.15", $12.3 → "$12.30"; `precise` keeps three decimals under $1 (single calls). */
export function formatUsd(v: number, precise = false): string {
  if (v === 0) return '$0.00'
  if (v < 0.01 || (precise && v < 1)) return `$${v.toFixed(3)}`
  return `$${v.toFixed(2)}`
}
