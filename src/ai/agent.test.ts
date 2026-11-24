import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BetaContentBlock, BetaMessage } from '@anthropic-ai/sdk/resources/beta/messages/messages'

// --- A fake Claude client: each stream() call pops the next scripted message. ---
const script: Partial<BetaMessage>[] = []
const requests: Record<string, unknown>[] = []
vi.mock('./client', async (orig) => {
  const real = await orig<typeof import('./client')>()
  return {
    ...real,
    getClient: () => ({
      beta: {
        messages: {
          stream: (body: Record<string, unknown>) => {
            requests.push(JSON.parse(JSON.stringify(body)))
            const next = script.shift() ?? { content: [{ type: 'text', text: 'done', citations: null }], stop_reason: 'end_turn' }
            return {
              on: () => undefined,
              finalMessage: async () => ({ id: 'msg', type: 'message', role: 'assistant', model: 'claude-opus-5-5', usage: { input_tokens: 1, output_tokens: 1 }, ...next }),
            }
          },
        },
      },
    }),
  }
})

const { getState } = await import('@/state/store')
const { newScene, newShow } = await import('@/core/defaults')
const { sendToCopilot, useCopilot, newChat } = await import('./copilot')
const { runTool, toolDefinitions, safetyLine } = await import('./tools')
const { echoContent } = await import('./client')
const { summarizeShow } = await import('./context')

function freshShow() {
  const doc = newShow(60, 'Test show')
  doc.scenes.push(newScene(doc, 'circle'), newScene(doc, 'heart'))
  getState().loadDoc(doc)
  newChat()
  script.length = 0
  requests.length = 0
}

const toolUse = (id: string, name: string, input: unknown) => ({ type: 'tool_use', id, name, input }) as BetaContentBlock

describe('tools', () => {
  beforeEach(freshShow)

  it('definitions are valid JSON-schema objects with eager streaming when requested', () => {
    const defs = toolDefinitions(true) as { name: string; input_schema: { type: string; $schema?: string }; eager_input_streaming?: boolean }[]
    expect(defs.length).toBeGreaterThan(12)
    for (const d of defs) {
      expect(d.input_schema.type).toBe('object')
      expect(d.input_schema.$schema).toBeUndefined()
      expect(d.eager_input_streaming).toBe(true)
    }
    expect((toolDefinitions(false)[0] as { eager_input_streaming?: boolean }).eager_input_streaming).toBeUndefined()
  })

  it('add_scene builds a safe formation and reports safety', async () => {
    const out = await runTool('add_scene', { scene: { name: 'Finale', shape: { kind: 'star', fill: 'outline' }, light: { effect: 'twinkle', color: '#ffcc00' } } })
    expect(out.error).toBeUndefined()
    expect(getState().doc.scenes[getState().doc.scenes.length - 1]!.name).toBe('Finale')
    expect(String(out.content)).toMatch(/Safety: all checks pass/)
  })

  it('rejects invalid input without running anything', async () => {
    const before = getState().doc
    const out = await runTool('set_light', { scene_id: before.scenes[0]!.id, light: { effect: 'lava' } })
    expect(out.error).toBe(true)
    expect(String(out.content)).toMatch(/INVALID_JSON/)
    expect(getState().doc).toBe(before)
  })

  it('reports unknown ids as recoverable errors', async () => {
    const out = await runTool('remove_scene', { scene_id: 'nope' })
    expect(out.error).toBe(true)
    expect(String(out.content)).toMatch(/get_show/)
  })

  it('places cues relative to a scene arrival', async () => {
    const id = getState().doc.scenes[1]!.id
    await runTool('add_cue', { scene_id: id, offset_seconds: 1, light: { effect: 'flash' }, duration_seconds: 2, blend: 'add' })
    const cue = getState().doc.cues[0]!
    expect(cue.effect.kind).toBe('flash')
    expect(cue.start).toBeGreaterThan(10)
  })

  it('summaries carry ids and the safety status', () => {
    const s = summarizeShow(getState().doc)
    expect(s).toContain(getState().doc.scenes[0]!.id)
    expect(s).toMatch(/Safety: all checks pass/)
    expect(safetyLine()).toMatch(/all checks pass/)
  })
})

describe('copilot loop', () => {
  beforeEach(freshShow)

  it('runs tools, sends results back, and squashes edits into one undo step', async () => {
    const past = getState().past.length
    script.push(
      { content: [{ type: 'thinking', thinking: '', signature: 'sig' } as BetaContentBlock, toolUse('t1', 'add_scene', { scene: { name: 'Rocket', shape: { kind: 'cone' }, light: { effect: 'solid', color: '#ff5500' } } }), toolUse('t2', 'set_light', { scene_id: getState().doc.scenes[0]!.id, light: { effect: 'rainbow' } })], stop_reason: 'tool_use' },
      { content: [{ type: 'text', text: 'Added a rocket and a rainbow.', citations: null }], stop_reason: 'end_turn' },
    )
    await sendToCopilot('add a rocket and make the first scene a rainbow')
    expect(getState().doc.scenes.map((s) => s.name)).toContain('Rocket')
    expect(getState().doc.scenes[0]!.layers[0]!.effect.kind).toBe('rainbow')
    // One undo step for both edits.
    expect(getState().past.length).toBe(past + 1)
    expect(getState().past[getState().past.length - 1]!.label).toMatch(/^AI: /)
    // Second request: history is append-only, thinking passed back, both results in one user message.
    const msgs = requests[1]!.messages as { role: string; content: { type: string; tool_use_id?: string }[] }[]
    expect(msgs[1]!.content[0]!.type).toBe('thinking')
    expect(msgs[2]!.content.map((b) => b.tool_use_id)).toEqual(['t1', 't2'])
    // Request shape.
    expect(requests[0]).toMatchObject({ model: 'claude-opus-5-5', fallbacks: 'default', betas: ['server-side-fallback-2026-07-01'], thinking: { type: 'adaptive' } })
    getState().undo()
    expect(getState().doc.scenes.map((s) => s.name)).not.toContain('Rocket')
  })

  it('never runs a tool from a turn cut off by max_tokens', async () => {
    const before = getState().doc
    script.push({ content: [toolUse('t1', 'remove_scene', { scene_id: before.scenes[0]!.id })], stop_reason: 'max_tokens' })
    await sendToCopilot('delete the first scene')
    expect(getState().doc.scenes).toHaveLength(2)
    const last = useCopilot.getState().messages[useCopilot.getState().messages.length - 1]!
    expect(last.role).toBe('user')
    expect(JSON.stringify(last.content)).toMatch(/"is_error":true/)
    expect(useCopilot.getState().items.some((i) => i.kind === 'notice' && /cut off/.test(i.text))).toBe(true)
  })

  it('stops on a refusal without running tools', async () => {
    script.push({ content: [toolUse('t1', 'remove_scene', { scene_id: getState().doc.scenes[0]!.id })], stop_reason: 'refusal' })
    await sendToCopilot('do something')
    expect(getState().doc.scenes).toHaveLength(2)
    expect(useCopilot.getState().items.some((i) => i.kind === 'notice' && /declined/.test(i.text))).toBe(true)
  })

  it('includes a fresh show snapshot with each user message', async () => {
    script.push({ content: [{ type: 'text', text: 'ok', citations: null }], stop_reason: 'end_turn' })
    await sendToCopilot('hello')
    const first = (requests[0]!.messages as { content: { text: string }[] }[])[0]!
    expect(first.content[0]!.text).toMatch(/^<show_state>/)
    expect(first.content[1]!.text).toBe('hello')
  })
})

describe('fallback echo', () => {
  it('drops non-text blocks before the last fallback boundary', () => {
    const content = [
      { type: 'thinking', thinking: '', signature: 'a' },
      { type: 'text', text: 'partial', citations: null },
      toolUse('x', 'get_show', {}),
      { type: 'fallback', from: { model: 'claude-opus-5-5' }, to: { model: 'claude-opus-5' } },
      { type: 'thinking', thinking: '', signature: 'b' },
      toolUse('y', 'get_show', {}),
    ] as BetaContentBlock[]
    expect(echoContent(content).map((b) => b.type)).toEqual(['text', 'fallback', 'thinking', 'tool_use'])
    expect(echoContent(content.slice(0, 3))).toHaveLength(3)
  })
})
