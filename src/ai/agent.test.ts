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

  it('splits a scene into groups, edits a group formation, and adds another', async () => {
    const heart = getState().doc.scenes[1]!
    const out = await runTool('split_scene', {
      scene_id: heart.id, mode: 'halves',
      groups: [
        { name: 'West', steps: [{ name: 'Ring', shape: { kind: 'circle', fill: 'outline' }, light: { effect: 'solid', color: '#ff0000' }, hold_seconds: 4 }] },
        { name: 'East', delay_seconds: 2, steps: [{ name: 'Spark', shape: { kind: 'star' }, light: { effect: 'twinkle' } }, { name: 'Dot', shape: { kind: 'circle' }, light: { effect: 'solid' } }] },
      ],
    })
    expect(out.error, String(out.content)).toBeUndefined()
    const groups = getState().doc.scenes[1]!.groups!
    expect(groups.map((g) => g.name)).toEqual(['West', 'East'])
    expect(groups[1]!.delay).toBe(2)
    expect(groups[1]!.steps.map((s) => s.name)).toEqual(['Spark', 'Dot'])
    // West keeps to the left, East to the right.
    expect(groups[0]!.steps[0]!.position[0]).toBeLessThan(groups[1]!.steps[0]!.position[0])
    expect(String(out.content)).toMatch(/Safety: all checks pass/)
    // Group formations are scenes: the scene tools work on them.
    const ring = groups[0]!.steps[0]!
    expect((await runTool('edit_scene', { scene_id: ring.id, hold_seconds: 9, spin: 5 })).error).toBeUndefined()
    expect(getState().doc.scenes[1]!.groups![0]!.steps[0]!.hold).toBe(9)
    expect((await runTool('add_group_step', { group_id: groups[0]!.id, step: { name: 'Heart', shape: { kind: 'heart' }, light: { effect: 'solid' } } })).error).toBeUndefined()
    expect(getState().doc.scenes[1]!.groups![0]!.steps.map((s) => s.name)).toEqual(['Ring', 'Heart'])
    // The summary shows the groups, their sizes and formations.
    const s = summarizeShow(getState().doc)
    expect(s).toMatch(/group \[group_[^\]]+\] "West": slice 1 of 2 left→right, 30 drones/)
    expect(s).toContain(ring.id)
    // Merge back.
    expect((await runTool('split_scene', { scene_id: heart.id, mode: 'merge' })).error).toBeUndefined()
    expect(getState().doc.scenes[1]!.groups).toBeUndefined()
  })

  it('reaches every editor feature: settings, site, multi-shape formations, LED signs, the preview', async () => {
    const first = getState().doc.scenes[0]!
    // Show-wide settings, limits, takeoff and the flight home.
    let out = await runTool('set_show', { audience_distance: 220, limits: { max_speed: 8, battery_minutes: 12 }, takeoff: { landing: 'home' }, return_flight: { transition: { style: 'rain' }, dim: true } })
    expect(out.error, String(out.content)).toBeUndefined()
    const d = getState().doc
    expect(d.site.audienceDistance).toBe(220)
    expect(d.limits.maxSpeedH).toBe(8)
    expect(d.limits.maxFlightTime).toBe(720)
    expect(d.site.landing).toBe('home')
    expect(d.site.returnFlight.style?.kind).toBe('rain')
    expect(d.site.returnFlight.dim).toBe(true)
    // The site: accuracy, a keep-out zone and the flight area.
    out = await runTool('set_site', { accuracy: { preset: 'rtk' }, add_zones: [{ name: 'Stage', kind: 'building', x: 0, z: 120, width: 30, depth: 10, top: 12 }], flight_area: { x: 0, z: 0, width: 400, depth: 300 } })
    expect(out.error, String(out.content)).toBeUndefined()
    expect(getState().doc.limits.accuracy).toEqual({ h: 0.1, v: 0.15 })
    expect(getState().doc.site.zones?.[0]?.name).toBe('Stage')
    expect(getState().doc.site.area?.length).toBe(4)
    expect(summarizeShow(getState().doc)).toMatch(/"Stage" \(obstacle\)/)
    // A second shape in a formation, then removing it.
    out = await runTool('add_shape', { scene_id: first.id, shape: { kind: 'text', text: 'HI' }, light: { effect: 'solid', color: '#ffffff' }, up: -30, share: 0.4 })
    expect(out.error, String(out.content)).toBeUndefined()
    expect(getState().doc.scenes[0]!.layers.filter((l) => !l.role).length).toBe(2)
    expect((await runTool('remove_shape', { scene_id: first.id, layer_index: 1 })).error).toBeUndefined()
    expect(getState().doc.scenes[0]!.layers.filter((l) => !l.role).length).toBe(1)
    // An LED sign, and a formation with an extra shape from the start.
    out = await runTool('add_scene', { scene: { name: 'Marquee', shape: { kind: 'led_sign', text: 'WELCOME', columns: 20 }, light: { effect: 'matrix', color: '#ffcc00' } } })
    expect(out.error, String(out.content)).toBeUndefined()
    const sign = getState().doc.scenes.find((s) => s.name === 'Marquee')!
    expect(sign.layers[0]!.effect.kind).toBe('matrix')
    expect(sign.layers[0]!.shape.kind).toBe('grid')
    out = await runTool('add_scene', { scene: { name: 'Love', shape: { kind: 'heart' }, light: { effect: 'solid', color: '#ff3366' }, extra_shapes: [{ shape: { kind: 'text', text: 'A+B' }, light: { effect: 'solid', color: '#ffffff' }, up: -35 }] } })
    expect(out.error, String(out.content)).toBeUndefined()
    expect(getState().doc.scenes.find((s) => s.name === 'Love')!.layers.length).toBeGreaterThanOrEqual(2)
    // The preview follows.
    out = await runTool('show_moment', { scene_id: sign.id, camera: 'orbit' })
    expect(out.error).toBeUndefined()
    expect(getState().selection).toEqual({ kind: 'scene', id: sign.id })
    expect(getState().camera).toBe('orbit')
  })

  it('sets and clears keyframes; the summary shows them', async () => {
    const id = getState().doc.scenes[0]!.id
    let out = await runTool('edit_scene', { scene_id: id, hold_seconds: 16, keyframes: [{ at_seconds: 12, up: 12, turn: 45, scale: 1.1 }] })
    expect(out.error, String(out.content)).toBeUndefined()
    expect(getState().doc.scenes[0]!.keys).toEqual([{ t: 12, move: [0, 12, 0], rotate: [0, 45, 0], scale: 1.1 }])
    expect(summarizeShow(getState().doc)).toMatch(/keyframes while held: at 12 s move \(0, 12, 0\) m rotate tilt 0° turn 45° roll 0° size 110%/)
    expect(String(out.content)).toMatch(/Safety: all checks pass/)
    out = await runTool('edit_scene', { scene_id: id, keyframes: 'clear' })
    expect(getState().doc.scenes[0]!.keys).toBeUndefined()
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
