// ============================================================================
// S28-01 to S28-05: AI Chat Store — conversation state management
// ============================================================================

import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import type { ToolResult } from '../services/aiToolEngine'

// ── S28-02: ChatMessage type ────────────────────────────────────────────────

export interface ToolCallResult {
  toolName: string
  toolCallId: string
  input: Record<string, unknown>
  output: ToolResult
  durationMs: number
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  toolCalls?: ToolCallResult[]
  timestamp: number
  tokenCount?: number
}

// ── S28-01: Store interface ─────────────────────────────────────────────────

export interface AIChatSettings {
  apiKey: string
  model: string
  enabled: boolean
}

export interface TokenUsage {
  input: number
  output: number
  total: number
}

interface AIChatStoreState {
  messages: ChatMessage[]
  isGenerating: boolean
  error: string | null
  settings: AIChatSettings
  tokenUsage: TokenUsage

  // S28-04: Actions
  addMessage: (msg: ChatMessage) => void
  updateLastAssistantMessage: (content: string, toolCalls?: ToolCallResult[]) => void
  clearHistory: () => void
  setGenerating: (val: boolean) => void
  setError: (err: string | null) => void
  updateSettings: (patch: Partial<AIChatSettings>) => void
  addTokenUsage: (input: number, output: number) => void
}

// ── S28-05: Session storage persistence for settings ────────────────────────

const SESSION_KEY = 'ai-chat-settings'

function loadSettings(): AIChatSettings {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<AIChatSettings>
      return {
        apiKey: parsed.apiKey ?? '',
        model: parsed.model ?? 'claude-sonnet-4-6',
        enabled: (parsed.apiKey?.length ?? 0) > 0,
      }
    }
  } catch { /* ignore */ }
  return { apiKey: '', model: 'claude-sonnet-4-6', enabled: false }
}

function saveSettings(settings: AIChatSettings): void {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({ apiKey: settings.apiKey, model: settings.model }))
  } catch { /* ignore */ }
}

// ── Store ───────────────────────────────────────────────────────────────────

let msgIdCounter = 0
export function genMsgId(): string {
  return `msg-${Date.now().toString(36)}-${(++msgIdCounter).toString(36)}`
}

export const useAIChatStore = create<AIChatStoreState>()(
  immer((set) => ({
    messages: [],
    isGenerating: false,
    error: null,
    settings: loadSettings(),
    tokenUsage: { input: 0, output: 0, total: 0 },

    addMessage(msg) {
      set((s) => { s.messages.push(msg) })
    },

    updateLastAssistantMessage(content, toolCalls) {
      set((s) => {
        const last = s.messages[s.messages.length - 1]
        if (last && last.role === 'assistant') {
          last.content = content
          if (toolCalls) last.toolCalls = toolCalls
        }
      })
    },

    clearHistory() {
      set((s) => { s.messages = []; s.tokenUsage = { input: 0, output: 0, total: 0 } })
    },

    setGenerating(val) {
      set((s) => { s.isGenerating = val })
    },

    setError(err) {
      set((s) => { s.error = err })
    },

    updateSettings(patch) {
      set((s) => {
        Object.assign(s.settings, patch)
        s.settings.enabled = s.settings.apiKey.length > 0
        saveSettings(s.settings)
      })
    },

    addTokenUsage(input, output) {
      set((s) => {
        s.tokenUsage.input += input
        s.tokenUsage.output += output
        s.tokenUsage.total += input + output
      })
    },
  })),
)
