// Copilot chat state, kept free of SDK imports so the main app can show the
// copilot's status without loading the AI code.

import { create } from 'zustand'
import type { BetaMessageParam } from '@anthropic-ai/sdk/resources/beta/messages/messages'

export type ChatItem =
  | { kind: 'user'; id: string; text: string }
  | { kind: 'assistant'; id: string; text: string; thinking: string; streaming: boolean }
  | { kind: 'tool'; id: string; label: string; summary?: string; status: 'running' | 'ok' | 'error' }
  | { kind: 'notice'; id: string; text: string; tone: 'error' | 'info' }
  | { kind: 'turn'; id: string; changed: boolean; historyLength: number }

interface CopilotState {
  items: ChatItem[]
  messages: BetaMessageParam[]
  running: boolean
  controller: AbortController | null
}

export const useCopilot = create<CopilotState>(() => ({ items: [], messages: [], running: false, controller: null }))


/** Prompts offered as one-click starters. */
export const STARTERS = [
  { label: 'Review my show', prompt: 'Review my show like a seasoned drone show director. Look at the scenes, the timing, the lights and the music, then give me your 3–5 most valuable suggestions, most important first. Don’t change anything yet.' },
  { label: 'Make the lights follow the music', prompt: 'Design light cues that follow the music: accents on the strongest moments, calmer light in quiet passages. Keep the formations as they are.' },
  { label: 'Land formations on the beat', prompt: 'Make every formation arrive on a downbeat and check the show is still safe.' },
  { label: 'Add a finale', prompt: 'Add a big, bright finale scene at the end that tops everything before it.' },
  { label: 'Fix safety issues', prompt: 'Fix all safety issues, changing as little of the design as possible, and tell me what you changed.' },
]
