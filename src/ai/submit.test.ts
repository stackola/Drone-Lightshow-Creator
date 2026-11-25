import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

// Fake Claude: scripted replies, recording every request.
const script: unknown[][] = []
const requests: { messages: { role: string; content: unknown }[]; tools: { name: string; strict?: boolean; input_schema: unknown }[]; output_config?: { format?: unknown } }[] = []
vi.mock('./client', async (orig) => {
  const real = await orig<typeof import('./client')>()
  return {
    ...real,
    eagerStreaming: () => true,
    getClient: () => ({
      beta: {
        messages: {
          stream: (body: (typeof requests)[number]) => {
            requests.push(JSON.parse(JSON.stringify(body)))
            const content = script.shift()!
            return { on: () => {}, finalMessage: async () => ({ stop_reason: content.some((b) => (b as { type: string }).type === 'tool_use') ? 'tool_use' : 'end_turn', usage: {}, content }) }
          },
        },
      },
    }),
  }
})
const { submitObject } = await import('./submit')

const Thing = z.object({ name: z.string(), size: z.number(), colour: z.string().optional(), tags: z.array(z.string()).optional() })
const opts = { schema: Thing, tool: { name: 'submit_thing', description: 'Submit the thing.' }, system: 'sys', content: [{ type: 'text' as const, text: 'Make a thing' }], maxTokens: 1000, effort: 'low' as const, messages: { refusal: 'no', tooLong: 'long', unreadable: 'unreadable' } }

describe('results handed over as tool calls', () => {
  it('uses a plain (non-strict) tool, no grammar-constrained output', async () => {
    requests.length = 0
    script.push([{ type: 'tool_use', id: 't1', name: 'submit_thing', input: { name: 'A', size: 2 } }])
    expect(await submitObject(opts)).toEqual({ name: 'A', size: 2 })
    expect(requests[0]!.output_config?.format).toBeUndefined()
    expect(requests[0]!.tools[0]!.name).toBe('submit_thing')
    expect(requests[0]!.tools[0]!.strict).toBeUndefined()
    expect(JSON.stringify(requests[0]!.tools[0]!.input_schema)).toContain('"size"')
  })

  it('sends schema errors back and takes the corrected result', async () => {
    requests.length = 0
    script.push([{ type: 'tool_use', id: 't1', name: 'submit_thing', input: { name: 'A', size: 'big' } }])
    script.push([{ type: 'tool_use', id: 't2', name: 'submit_thing', input: { name: 'A', size: 3 } }])
    expect(await submitObject(opts)).toEqual({ name: 'A', size: 3 })
    const fix = requests[1]!.messages[2]!.content as { type: string; is_error?: boolean; content?: string; tool_use_id?: string }[]
    expect(fix[0]!.type).toBe('tool_result')
    expect(fix[0]!.is_error).toBe(true)
    expect(fix[0]!.tool_use_id).toBe('t1')
    expect(fix[0]!.content).toMatch(/size/)
  })

  it('asks again when Claude answers in text, and gives up after the retries', async () => {
    script.push([{ type: 'text', text: 'Here is a thing!' }])
    script.push([{ type: 'tool_use', id: 't3', name: 'submit_thing', input: { name: 'B', size: 1 } }])
    expect((await submitObject(opts)).name).toBe('B')
    script.push([{ type: 'text', text: 'no' }], [{ type: 'text', text: 'no' }], [{ type: 'text', text: 'no' }])
    await expect(submitObject(opts)).rejects.toThrow('unreadable')
  })
})
