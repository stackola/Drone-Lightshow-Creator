// Getting one structured result from Claude through a tool call.
//
// Grammar-constrained structured outputs (output_config.format, strict tools)
// are capped at 24 optional fields and 16 union fields per request, plus a
// limit on the compiled grammar's size; a whole show plan has well over a
// hundred optional fields. A regular (non-strict) tool has no such limits:
// Claude submits the result by calling the tool, the input is validated here
// against the same zod schema, and any problems are sent back as a tool error
// for Claude to correct (a couple of times at most).

import { z } from 'zod'
import type { BetaContentBlockParam, BetaMessageParam, BetaTextBlockParam, BetaToolUnion } from '@anthropic-ai/sdk/resources/beta/messages/messages'
import { RefusalError, baseParams, eagerStreaming, getClient, recordUsage } from './client'
import { tracked } from './costs'

export interface SubmitOptions<T extends z.ZodType> {
  schema: T
  /** The tool Claude calls to hand over the result. */
  tool: { name: string; description: string }
  system: string | BetaTextBlockParam[]
  content: BetaContentBlockParam[]
  maxTokens: number
  effort: 'low' | 'medium' | 'high' | 'xhigh'
  signal?: AbortSignal
  /** The partially streamed input, as it arrives (best effort). */
  onPartial?: (snapshot: unknown) => void
  /** Error messages for the user. */
  messages: { refusal: string; tooLong: string; unreadable: string }
  /** Attempts to correct an invalid result (default 2). */
  retries?: number
  /** What the call is for, in the cost tracker (default: the tool's name). */
  label?: string
}

/** JSON schema for a tool's input, from a zod schema. */
export function toolInputSchema(schema: z.ZodType): { type: 'object'; [k: string]: unknown } {
  const { $schema: _drop, ...json } = z.toJSONSchema(schema) as Record<string, unknown>
  void _drop
  return json as { type: 'object'; [k: string]: unknown }
}

/** A short list of what's wrong with an input, for Claude to fix. */
export function describeIssues(error: z.ZodError): string {
  return error.issues.slice(0, 20).map((i) => `- ${i.path.length ? i.path.join('.') : '(top level)'}: ${i.message}`).join('\n')
}

export async function submitObject<T extends z.ZodType>(o: SubmitOptions<T>): Promise<z.infer<T>> {
  const tool: BetaToolUnion = {
    name: o.tool.name,
    description: o.tool.description,
    input_schema: toolInputSchema(o.schema),
    ...(eagerStreaming() ? { eager_input_streaming: true } : {}),
  }
  const instruction = `Hand over your result by calling the \`${o.tool.name}\` tool once.`
  const messages: BetaMessageParam[] = [{ role: 'user', content: [...o.content, { type: 'text', text: instruction }] }]
  const retries = o.retries ?? 2
  for (let attempt = 0; ; attempt++) {
    const stream = getClient().beta.messages.stream(
      {
        ...baseParams(),
        max_tokens: o.maxTokens,
        system: o.system,
        tools: [tool],
        tool_choice: { type: 'auto' },
        output_config: { effort: o.effort },
        messages,
      },
      { signal: o.signal },
    )
    if (o.onPartial) stream.on('inputJson', (_delta, snapshot) => o.onPartial!(snapshot))
    const msg = await tracked(stream.finalMessage())
    recordUsage(msg.usage, { model: msg.model, label: o.label ?? o.tool.name })
    if (msg.stop_reason === 'refusal') throw new RefusalError(o.messages.refusal)
    if (msg.stop_reason === 'max_tokens') throw new Error(o.messages.tooLong)
    const call = msg.content.find((b): b is Extract<typeof b, { type: 'tool_use' }> => b.type === 'tool_use' && b.name === o.tool.name)
    if (call) {
      const parsed = o.schema.safeParse(call.input)
      if (parsed.success) return parsed.data
      if (attempt >= retries) throw new Error(o.messages.unreadable)
      messages.push({ role: 'assistant', content: msg.content })
      messages.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: call.id, is_error: true, content: `That input doesn't match the schema. Fix these and call \`${o.tool.name}\` again with the complete result:\n${describeIssues(parsed.error)}` }] })
      continue
    }
    // No tool call (an answer in plain text): ask once more.
    if (attempt >= retries) throw new Error(o.messages.unreadable)
    messages.push({ role: 'assistant', content: msg.content })
    messages.push({ role: 'user', content: [{ type: 'text', text: instruction }] })
  }
}
