// Chat Store — conversation state + API settings

import { create } from 'zustand'

export interface ToolCallResult {
  toolName: string
  toolCallId: string
  input: Record<string, unknown>
  output: { success: boolean; data?: unknown; error?: string }
  durationMs: number
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  toolCalls?: ToolCallResult[]
  timestamp: number
}

interface ChatState {
  messages: ChatMessage[]
  isGenerating: boolean
  error: string | null
  apiKey: string
  model: string

  addMessage: (msg: ChatMessage) => void
  updateLastAssistant: (content: string, toolCalls?: ToolCallResult[]) => void
  clearHistory: () => void
  setGenerating: (v: boolean) => void
  setError: (e: string | null) => void
  setApiKey: (key: string) => void
  setModel: (model: string) => void
}

let _id = 0
export const msgId = () => `m${Date.now().toString(36)}-${(++_id).toString(36)}`

export const useChatStore = create<ChatState>()((set) => ({
  messages: [],
  isGenerating: false,
  error: null,
  apiKey: sessionStorage.getItem('fg-api-key') ?? '',
  model: 'claude-sonnet-4-6',

  addMessage: (msg) => set((s) => ({ messages: [...s.messages, msg] })),
  updateLastAssistant: (content, toolCalls) => set((s) => {
    const msgs = [...s.messages]
    const last = msgs[msgs.length - 1]
    if (last?.role === 'assistant') {
      msgs[msgs.length - 1] = { ...last, content, toolCalls: toolCalls ?? last.toolCalls }
    }
    return { messages: msgs }
  }),
  clearHistory: () => set({ messages: [] }),
  setGenerating: (v) => set({ isGenerating: v }),
  setError: (e) => set({ error: e }),
  setApiKey: (key) => { sessionStorage.setItem('fg-api-key', key); set({ apiKey: key }) },
  setModel: (model) => set({ model }),
}))
