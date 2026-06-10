// ============================================================================
// S28 Tests: AI Chat Service — store, messages, system prompt
// ============================================================================

import { describe, it, expect, beforeEach } from 'vitest'
import { useAIChatStore, genMsgId } from '../stores/aiChatStore'
import { buildSystemPrompt, buildMessagesArray } from './aiChatService'
import { useGraphStore } from '../stores/graphStore'
import { useProjectStore } from '../stores/projectStore'
import { useFormationStore } from '../stores/formationStore'
import { initRegistries } from '../registries/init'

initRegistries()

function reset() {
  useAIChatStore.getState().clearHistory()
  useAIChatStore.getState().setError(null)
  useAIChatStore.getState().setGenerating(false)
  useGraphStore.getState().loadGraph({ nodes: [], edges: [] })
  useFormationStore.getState().loadFormations([], new Map())
  useProjectStore.getState().setDroneCount(100)
}

// ── S28-01/02/03: Chat Store ────────────────────────────────────────────────

describe('AIChatStore', () => {
  beforeEach(reset)

  it('S28-01: initializes with empty state', () => {
    const state = useAIChatStore.getState()
    expect(state.messages).toEqual([])
    expect(state.isGenerating).toBe(false)
    expect(state.error).toBeNull()
    expect(state.tokenUsage.total).toBe(0)
  })

  it('S28-04: addMessage adds to history', () => {
    const store = useAIChatStore.getState()
    store.addMessage({ id: genMsgId(), role: 'user', content: 'Hello', timestamp: Date.now() })
    expect(useAIChatStore.getState().messages.length).toBe(1)
    expect(useAIChatStore.getState().messages[0]!.content).toBe('Hello')
  })

  it('S28-04: updateLastAssistantMessage updates content', () => {
    const store = useAIChatStore.getState()
    store.addMessage({ id: genMsgId(), role: 'assistant', content: 'Hi', timestamp: Date.now() })
    store.updateLastAssistantMessage('Hello there!')
    expect(useAIChatStore.getState().messages[0]!.content).toBe('Hello there!')
  })

  it('S28-04: clearHistory resets messages and tokens', () => {
    const store = useAIChatStore.getState()
    store.addMessage({ id: genMsgId(), role: 'user', content: 'test', timestamp: Date.now() })
    store.addTokenUsage(100, 50)
    store.clearHistory()
    expect(useAIChatStore.getState().messages.length).toBe(0)
    expect(useAIChatStore.getState().tokenUsage.total).toBe(0)
  })

  it('S28-04: setGenerating/setError', () => {
    useAIChatStore.getState().setGenerating(true)
    expect(useAIChatStore.getState().isGenerating).toBe(true)
    useAIChatStore.getState().setError('test error')
    expect(useAIChatStore.getState().error).toBe('test error')
  })

  it('S28-04: updateSettings + enabled flag', () => {
    useAIChatStore.getState().updateSettings({ apiKey: 'sk-test-123', model: 'claude-opus-4-6' })
    const s = useAIChatStore.getState().settings
    expect(s.apiKey).toBe('sk-test-123')
    expect(s.model).toBe('claude-opus-4-6')
    expect(s.enabled).toBe(true)
  })

  it('S28-18: addTokenUsage accumulates', () => {
    const store = useAIChatStore.getState()
    store.addTokenUsage(100, 50)
    store.addTokenUsage(200, 100)
    expect(useAIChatStore.getState().tokenUsage).toEqual({ input: 300, output: 150, total: 450 })
  })
})

// ── S28-06: System Prompt ───────────────────────────────────────────────────

describe('buildSystemPrompt', () => {
  beforeEach(reset)

  it('S28-06: includes domain knowledge', () => {
    const prompt = buildSystemPrompt()
    expect(prompt).toContain('drone show')
    expect(prompt).toContain('Launch')
    expect(prompt).toContain('Formation')
    expect(prompt).toContain('Transition')
  })

  it('S28-06: includes current show summary', () => {
    const prompt = buildSystemPrompt()
    expect(prompt).toContain('Current show state')
    expect(prompt).toContain('Drones: 100')
  })
})

// ── S28-07: Messages Array Builder ──────────────────────────────────────────

describe('buildMessagesArray', () => {
  it('S28-07: converts simple chat history', () => {
    const history: import('../stores/aiChatStore').ChatMessage[] = [
      { id: '1', role: 'user', content: 'Create a show', timestamp: 1 },
      { id: '2', role: 'assistant', content: 'Sure, I\'ll create one.', timestamp: 2 },
      { id: '3', role: 'user', content: 'Make it bigger', timestamp: 3 },
    ]
    const msgs = buildMessagesArray(history)
    expect(msgs.length).toBe(3)
    expect(msgs[0]!.role).toBe('user')
    expect(msgs[1]!.role).toBe('assistant')
    expect(msgs[2]!.role).toBe('user')
  })

  it('S28-07: reconstructs tool call messages', () => {
    const history: import('../stores/aiChatStore').ChatMessage[] = [
      { id: '1', role: 'user', content: 'Create a ring', timestamp: 1 },
      {
        id: '2', role: 'assistant', content: 'Creating...', timestamp: 2,
        toolCalls: [{
          toolName: 'create_formation',
          toolCallId: 'tc-1',
          input: { name: 'Ring', generatorId: 'ring', params: { count: 50, radius: 10 } },
          output: { success: true, data: { formationId: 'f1', pointCount: 50 } },
          durationMs: 5,
        }],
      },
    ]
    const msgs = buildMessagesArray(history)
    // user + assistant(with tool_use) + user(with tool_result)
    expect(msgs.length).toBe(3)
    expect(msgs[1]!.role).toBe('assistant')
    expect(Array.isArray(msgs[1]!.content)).toBe(true)
    expect(msgs[2]!.role).toBe('user')
  })

  it('S28-20: trims old messages if too large', () => {
    const history: import('../stores/aiChatStore').ChatMessage[] = []
    for (let i = 0; i < 100; i++) {
      history.push({ id: `${i}`, role: i % 2 === 0 ? 'user' : 'assistant', content: 'A'.repeat(10000), timestamp: i })
    }
    // With a low max, should trim
    const msgs = buildMessagesArray(history, 5000)
    expect(msgs.length).toBeLessThan(100)
    expect(msgs.length).toBeGreaterThan(0)
  })
})
