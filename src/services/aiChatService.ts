// ============================================================================
// S28-06 to S28-20: AI Chat Service — Claude API + Agentic Tool Loop
// ============================================================================
// Manages the full conversation loop:
//   User message → System prompt + tools → Claude API (streaming)
//   → Parse response → If tool_use → execute tools → feed results back
//   → Repeat until text-only response → Done
// ============================================================================

import { useAIChatStore, genMsgId, type ChatMessage, type ToolCallResult } from '../stores/aiChatStore'
import { executeToolAsync, getToolDefinitions, generateShowSummary, type ToolResult } from './aiToolEngine'
import { useAudioStore } from '../stores/audioStore'

// Eagerly register all write tools (side-effect imports)
// This ensures generate_custom_formation, generate_animated_formation, etc. are available
import './aiWriteTools'

// ── S28-06: System Prompt ───────────────────────────────────────────────────

export function buildSystemPrompt(): string {
  const showSummary = generateShowSummary()

  return `You are an expert drone show choreographer and co-designer. You help users create stunning aerial light shows using the Drone Show Designer tool. You have direct control over the show through tools.

Key domain concepts:
- A show is a directed graph: Launch → Formation(s) → Transition(s) → Land
- Formations define where drones are positioned (shapes like rings, grids, hearts, text)
- Transitions define how drones move between formations (shortest-path, spiral, explosion, etc.)
- Each drone has a position (x,y,z in meters) and color (RGB)
- Physics constraints limit velocity, acceleration, spacing between drones
- Typical shows: 50-500 drones, 1-5 minutes, 15-120m altitude

Design principles:
- Variety: alternate between different formation shapes and transition types
- Pacing: start gentle, build intensity, spectacular finale
- Color: use color programs to add visual interest (gradients, rainbows, pulses)
- Physics: always validate and fix violations before declaring done (call fix_all_violations)
- Altitude: vary altitude between formations for visual depth (15-25m base, vary by ±5m)

Workflow:
1. When creating a show, use create_show_from_outline with a full ShowOutline — this is the fastest approach
2. When editing: get_graph to understand current state → make targeted changes → get_violations to check
3. Always call fix_all_violations after making structural changes
4. Use get_show_summary or get_graph to understand the current state before making changes

Natural language editing (S31-04 to S31-07):
When the user asks to edit the show using natural language:
1. ALWAYS call get_graph or get_show_summary first to understand current state
2. Use the "Node label index" in the show summary to resolve vague references:
   - "the star formation" → look up node ID by formation name containing "star"
   - "act 2" → look up node ID for "act 2" in the index
   - "the transition at the end" → find the last transition by time range
   - "the big sphere" → search formations for name/generator containing "sphere"
   - "the middle part" → find nodes in the middle 33% of the show duration
3. Make minimal, targeted changes — don't rebuild the whole show
4. After changes, call get_violations to verify no new issues

Relative adjustments (S31-06):
- "make it faster" / "speed up" → reduce duration by ~30%: update_node_timing with duration * 0.7
- "make it slower" / "slow down" → increase duration by ~50%: update_node_timing with duration * 1.5
- "make it bigger" / "scale up" → update_node_transform with scale * 1.3
- "make it smaller" → update_node_transform with scale * 0.7
- "raise it higher" / "move up" → update_node_transform with position.y + 5
- "lower it" → update_node_transform with position.y - 5
- "more dramatic" → change transition strategy to explosion/implosion/bounce

Multi-node operations (S31-07):
- "change all transitions to X" → get_graph, find all transition nodes, call set_transition_strategy on each
- "add rainbow to everything" → find all formation nodes, call set_color_program on each
- "double the show duration" → find all timed nodes, multiply each duration/startTime by 2
- "remove all idle behaviors" → find formation nodes with idleConfigs, remove them

Constraint resolution (S31-15/16):
When fixing violations, prefer creative solutions over brute force:
- Transition too short → try a faster strategy (shortest-path) before extending duration
- Velocity too high → add intermediate keyframes to smooth the path rather than extending time
- Spacing too close → scale the formation up slightly rather than reducing drone count
- Altitude violation → shift the formation rather than removing it
Always explain WHY you chose a particular fix approach.

Formation generator routing — pick the right tool:
- Named primitive shape ("7-pointed star", "ring of 60", "fibonacci sphere", "heart", "spiral", "grid", "line") → call create_formation with the matching generatorId (star/ring/sphere/heart/spiral/grid/line). These are mathematically perfect and cheap.
- Text / letters / numbers ("the word LOVE", "2026") → create_formation_from_text.
- Concept / object / scene / logo ("Eiffel tower", "red sports car", "dolphin", "company logo X") → create_formation_from_svg. You write a clean black-fill SVG silhouette; the system rasterizes and samples it. Prefer this over generate_custom_formation for any recognizable object — LLMs are far better at SVG than at raw 3D coordinates for semantic content.
- Math-derived custom point clouds that aren't covered above → generate_custom_formation.
- Animated formations (spinning, pulsing, morphing) → generate_animated_formation.

Quality control for SVG-generated concepts:
- After create_formation_from_svg, you may call critique_formation (formationId from the previous call) to get a 0–10 recognizability score plus a suggestion.
- If the user explicitly asked for high quality, OR if the concept is complex (vehicles, buildings, animals), critique once.
- If the score is below 7, regenerate with create_formation_from_svg incorporating the suggestion. Cap yourself at 3 total SVG attempts to control cost.

Custom formation generation (Class A feature):
When users describe a custom shape (logo, symbol, artistic pattern), use generate_custom_formation or generate_animated_formation:

generate_custom_formation: For static shapes. YOU compute the {x, y, z} points:
- Think of the shape in 2D first (x=horizontal, z=depth, y=0 for flat)
- Sample points along the outline of the shape
- Space points ~1.5m apart minimum
- Center the shape at origin, typical span 10-25m
- For a circle: x=cos(angle)*radius, z=sin(angle)*radius for N drones
- For letters: trace the strokes of each character
- For logos: break into geometric primitives (circles, lines, arcs)

IMPORTANT: Keep drone counts manageable in generate_animated_formation. Each drone needs a full track with keyframes.
- For complex animated shapes: use 20-40 drones (you must output every track)
- For simple animations: up to 60 drones
- If the user asks for 200+ drone animated formations, use generate_custom_formation for the static shape and then let the formation node's keyframes handle the animation (rotation, scale, position) — this is much more efficient.

generate_animated_formation: For animated shapes (spinning, pulsing, morphing). YOU compute per-drone keyframes:
- Each drone gets independent position + color tracks
- For SPINNING: at t=0 place drones in shape, at t=duration rotate each point around Y axis by 2π
  x_new = x*cos(angle) + z*sin(angle), z_new = -x*sin(angle) + z*cos(angle)
- For COLOR WAVES: stagger color keyframe times across drones (drone_i starts at t=i*delay)
- For PULSING: scale positions at mid-time: multiply all coords by 1.3, then back to 1.0
- For MORPHING: keyframe 1 = shape A positions, keyframe 2 = shape B positions
- Use "loop" playback for continuous animation (spinning, pulsing)
- Use "boomerang" for back-and-forth (breathing, scale pulse)
- Duration: 5-15s typical. 2-4 keyframes per track for smooth motion.

Example — spinning ring of 20 drones:
tracks: 20 drones, each with position keyframes:
  t=0: {x: cos(i/20*2π)*10, y: 0, z: sin(i/20*2π)*10}
  t=10: {x: cos(i/20*2π + 2π)*10, y: 0, z: sin(i/20*2π + 2π)*10}
With loop playback, this spins forever.

Example — color wave across 30 drones:
Each drone i gets color keyframes:
  t=i*0.1: {r:1, g:0, b:0}
  t=i*0.1+0.5: {r:0, g:0, b:1}
  t=i*0.1+1.0: {r:1, g:0, b:0}
This creates a red→blue→red wave propagating across the formation.

Show creation guidelines (for create_show_from_outline):
- 50-100 drones: 3-4 acts, simpler shapes (ring, grid, heart)
- 100-200 drones: 4-6 acts, mix of shapes including text and sphere
- 200-500 drones: 5-8 acts, full variety of generators
- Each formation: 5-15 seconds duration
- Each transition: 2-5 seconds duration
- Altitude: base 15m, vary between 12-25m across acts for visual depth
- Colors: use at least 2-3 different color programs across the show
- Transitions: vary strategies — don't use the same one twice in a row
- Add keyframes for movement: rotation around Y axis, slight position shifts, scale pulses
- Add idle behaviors (orbit, sparkle, breathe) when drone count exceeds formation point count

Example: For "2-minute celebration show with 150 drones":
{
  "name": "Celebration Show",
  "droneCount": 150,
  "acts": [
    {"label": "Act 1 — Opening", "formations": [{"name": "Opening Ring", "generator": {"type": "ring", "params": {"count": 150, "radius": 12}}, "duration": 10, "altitude": 15, "colorProgramId": "gradient-blue-red", "keyframes": [{"time": 5, "rotation": {"y": 3.14}, "easing": "ease-in-out"}]}], "transition": {"strategyId": "spiral", "duration": 4}},
    {"label": "Act 2 — Star", "formations": [{"name": "Star", "generator": {"type": "star", "params": {"count": 150, "points_n": 5, "outerRadius": 15, "innerRadius": 6}}, "duration": 12, "altitude": 20, "colorProgramId": "rainbow", "idleBehavior": {"behavior": "sparkle", "radius": 5, "speed": 1}}], "transition": {"strategyId": "explosion", "duration": 3}},
    {"label": "Act 3 — Finale", "formations": [{"name": "Grand Sphere", "generator": {"type": "sphere", "params": {"count": 150, "radius": 18}}, "duration": 15, "altitude": 22, "colorProgramId": "chase-rgb", "keyframes": [{"time": 7, "scale": {"x": 1.3, "y": 1.3, "z": 1.3}, "easing": "ease-in-out-cubic"}, {"time": 14, "scale": {"x": 0.8, "y": 0.8, "z": 0.8}, "position": {"y": 18}, "easing": "ease-in-out"}]}]}
  ]
}

${showSummary}

${buildAudioContext()}`
}

// ── S28-07: Messages Array Builder ──────────────────────────────────────────

interface ClaudeMessage {
  role: 'user' | 'assistant'
  content: string | ClaudeContentBlock[]
}

interface ClaudeContentBlock {
  type: 'text' | 'tool_use' | 'tool_result'
  text?: string
  id?: string
  name?: string
  input?: Record<string, unknown>
  tool_use_id?: string
  content?: string
}

// S28-20: Estimate tokens (~4 chars per token)
// S32-05: Audio context for music-aware choreography
function buildAudioContext(): string {
  const audio = useAudioStore.getState()
  if (!audio.isAudioLoaded) return ''

  const regionText = audio.regions.length > 0
    ? '\nAudio sections: ' + audio.regions.map((r) => `"${r.label}" ${r.start.toFixed(1)}s–${r.end.toFixed(1)}s`).join(', ')
    : ''

  return `Audio loaded:
- File: ${audio.audioFileName ?? 'unknown'}
- Duration: ${audio.duration.toFixed(1)}s
- BPM: ${audio.bpm}
- Beat markers: ${audio.beatMarkers.length} (${audio.beatMarkers.filter((m) => m.type === 'detected').length} detected, ${audio.beatMarkers.filter((m) => m.type === 'manual').length} manual)
- Beat subdivision: 1/${audio.beatSubdivision}${regionText}
- Use generate_music_synced_show to create a show synced to this music.`
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

export function buildMessagesArray(history: ChatMessage[], maxTokens: number = 150000): ClaudeMessage[] {
  const messages: ClaudeMessage[] = []

  // Convert chat history to Claude format, trimming from front if too large
  const eligible = [...history]

  // Trim from front if too large
  while (eligible.length > 2) {
    const estimate = eligible.reduce((sum, m) => sum + estimateTokens(m.content) + (m.toolCalls?.length ?? 0) * 200, 0)
    if (estimate < maxTokens) break
    eligible.shift()
  }

  for (const msg of eligible) {
    if (msg.role === 'user') {
      messages.push({ role: 'user', content: msg.content })
    } else if (msg.role === 'assistant') {
      // If the assistant message had tool calls, we need to reconstruct the content blocks
      if (msg.toolCalls && msg.toolCalls.length > 0) {
        const blocks: ClaudeContentBlock[] = []
        if (msg.content) blocks.push({ type: 'text', text: msg.content })
        for (const tc of msg.toolCalls) {
          blocks.push({ type: 'tool_use', id: tc.toolCallId, name: tc.toolName, input: tc.input })
        }
        messages.push({ role: 'assistant', content: blocks })
        // Add tool results as user message
        const resultBlocks: ClaudeContentBlock[] = msg.toolCalls.map((tc) => ({
          type: 'tool_result' as const,
          tool_use_id: tc.toolCallId,
          content: JSON.stringify(tc.output.data ?? tc.output.error ?? ''),
        }))
        messages.push({ role: 'user', content: resultBlocks })
      } else {
        messages.push({ role: 'assistant', content: msg.content })
      }
    }
  }

  return messages
}

// ── S28-08: Claude API Call ──────────────────────────────────────────────────

export async function callClaudeAPI(
  systemPrompt: string,
  messages: ClaudeMessage[],
  settings: { apiKey: string; model: string },
  signal?: AbortSignal,
): Promise<Response> {
  const tools = getToolDefinitions()

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': settings.apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: settings.model,
      max_tokens: 16384,
      system: systemPrompt,
      messages,
      tools,
      stream: true,
    }),
    signal,
  })

  if (!response.ok) {
    const errorText = await response.text().catch(() => '')
    if (response.status === 401) throw new Error('Invalid API key. Check your Claude API key in settings.')
    if (response.status === 429) throw new Error('Rate limited. Please wait a moment and try again.')
    if (response.status === 529) throw new Error('Claude is overloaded. Please try again in a moment.')
    throw new Error(`API error ${response.status}: ${errorText.slice(0, 200)}`)
  }

  return response
}

// ── S28-09/10: Stream Parser ────────────────────────────────────────────────

interface ParsedStreamEvent {
  type: 'text' | 'tool_use_start' | 'tool_input_delta' | 'tool_use_end' | 'message_stop' | 'usage'
  text?: string
  toolCallId?: string
  toolName?: string
  inputDelta?: string
  usage?: { input_tokens: number; output_tokens: number }
}

export async function* parseStream(response: Response): AsyncGenerator<ParsedStreamEvent> {
  const reader = response.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let currentToolId = ''
  let currentToolName = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop()! // Keep incomplete line

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        const data = line.slice(6).trim()
        if (data === '[DONE]') return

        try {
          const event = JSON.parse(data)

          if (event.type === 'content_block_start') {
            if (event.content_block?.type === 'tool_use') {
              currentToolId = event.content_block.id ?? ''
              currentToolName = event.content_block.name ?? ''
              yield { type: 'tool_use_start', toolCallId: currentToolId, toolName: currentToolName }
            }
          } else if (event.type === 'content_block_delta') {
            if (event.delta?.type === 'text_delta') {
              yield { type: 'text', text: event.delta.text }
            } else if (event.delta?.type === 'input_json_delta') {
              yield { type: 'tool_input_delta', inputDelta: event.delta.partial_json }
            }
          } else if (event.type === 'content_block_stop') {
            if (currentToolId) {
              yield { type: 'tool_use_end', toolCallId: currentToolId, toolName: currentToolName }
              currentToolId = ''
              currentToolName = ''
            }
          } else if (event.type === 'message_stop') {
            yield { type: 'message_stop' }
          } else if (event.type === 'message_delta' && event.usage) {
            yield { type: 'usage', usage: event.usage }
          }
        } catch { /* ignore unparseable lines */ }
      }
    }
  } finally {
    reader.releaseLock()
  }
}

// ── S28-19: Rate Limiter ────────────────────────────────────────────────────

const apiCallTimestamps: number[] = []
const MAX_CALLS_PER_MINUTE = 10

function checkRateLimit(): boolean {
  const now = Date.now()
  // Remove timestamps older than 1 minute
  while (apiCallTimestamps.length > 0 && apiCallTimestamps[0]! < now - 60000) {
    apiCallTimestamps.shift()
  }
  if (apiCallTimestamps.length >= MAX_CALLS_PER_MINUTE) return false
  apiCallTimestamps.push(now)
  return true
}

// ── S28-11 to S28-18: Agentic Loop (sendMessage) ───────────────────────────

export interface SendMessageCallbacks {
  onStream?: (chunk: string) => void
  onToolCall?: (result: ToolCallResult) => void
}

export async function sendMessage(
  userMessage: string,
  callbacks: SendMessageCallbacks = {},
): Promise<void> {
  const store = useAIChatStore.getState()

  // S28-19: Rate limit check
  if (!checkRateLimit()) {
    store.setError('Rate limited: max 10 API calls per minute. Please wait.')
    return
  }

  if (!store.settings.enabled || !store.settings.apiKey) {
    store.setError('AI not configured. Set your API key in the AI settings.')
    return
  }

  // Add user message
  store.addMessage({
    id: genMsgId(),
    role: 'user',
    content: userMessage,
    timestamp: Date.now(),
  })

  store.setGenerating(true)
  store.setError(null)

  // S28-16: AbortController for cancellation
  const abortController = new AbortController()
  const unsubscribe = useAIChatStore.subscribe((state) => {
    if (!state.isGenerating) abortController.abort()
  })

  try {
    // S28-13: Multi-turn tool loop (max 10 rounds)
    let toolRound = 0
    const MAX_TOOL_ROUNDS = 10

    while (toolRound < MAX_TOOL_ROUNDS) {
      toolRound++

      const systemPrompt = buildSystemPrompt()
      const messages = buildMessagesArray(useAIChatStore.getState().messages)

      if (messages.length === 0) break

      // S28-08: Call Claude API
      const response = await callClaudeAPI(systemPrompt, messages, store.settings, abortController.signal)

      // Parse streaming response
      let textContent = ''
      const toolCalls: { id: string; name: string; inputJson: string }[] = []
      let currentToolInputJson = ''

      // Create placeholder assistant message
      const assistantMsgId = genMsgId()
      useAIChatStore.getState().addMessage({
        id: assistantMsgId,
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
      })

      for await (const event of parseStream(response)) {
        if (abortController.signal.aborted) break

        if (event.type === 'text') {
          textContent += event.text!
          // S28-14: Streaming text callback
          callbacks.onStream?.(event.text!)
          useAIChatStore.getState().updateLastAssistantMessage(textContent)
        } else if (event.type === 'tool_use_start') {
          currentToolInputJson = ''
        } else if (event.type === 'tool_input_delta') {
          currentToolInputJson += event.inputDelta!
        } else if (event.type === 'tool_use_end') {
          toolCalls.push({
            id: event.toolCallId!,
            name: event.toolName!,
            inputJson: currentToolInputJson,
          })
        } else if (event.type === 'usage' && event.usage) {
          // S28-18: Token usage tracking
          useAIChatStore.getState().addTokenUsage(event.usage.input_tokens, event.usage.output_tokens)
        }
      }

      if (abortController.signal.aborted) {
        console.log('[AI] Generation aborted by user')
        break
      }

      // Check for incomplete tool calls (truncated by max_tokens)
      if (currentToolInputJson && toolCalls.length === 0) {
        console.warn(`[AI] Tool call started but never completed (input was ${currentToolInputJson.length} chars). Response likely truncated by max_tokens.`)
        // Try to salvage — the AI started a tool call but ran out of tokens
        useAIChatStore.getState().updateLastAssistantMessage(
          textContent + '\n\n*[Response was truncated. The formation data was too large for a single response. Try asking for fewer drones or a simpler shape.]*'
        )
      }

      console.log(`[AI] Round ${toolRound}: ${toolCalls.length} tool call(s), ${textContent.length} chars text`)

      // If no tool calls, we're done — finalize message
      if (toolCalls.length === 0) {
        break
      }

      // S28-12: Execute tool calls
      const toolCallResults: ToolCallResult[] = []
      for (const tc of toolCalls) {
        let input: Record<string, unknown> = {}
        let parseError: string | null = null
        try {
          input = tc.inputJson ? JSON.parse(tc.inputJson) : {}
        } catch (e) {
          parseError = `Failed to parse tool input JSON: ${(e as Error).message}. Input was ${tc.inputJson.length} chars (possibly truncated by max_tokens).`
          console.error(`[AI] Tool ${tc.name} JSON parse error:`, parseError)
          console.error(`[AI] Raw JSON (first 500 chars):`, tc.inputJson.slice(0, 500))
        }

        let output: ToolResult
        if (parseError) {
          output = { success: false, error: parseError }
        } else {
          const startTime = performance.now()
          output = await executeToolAsync(tc.name, input)
          const durationMs = Math.round(performance.now() - startTime)
          console.log(`[AI] Tool ${tc.name}: ${output.success ? 'OK' : 'FAIL'} (${durationMs}ms)`, output.success ? '' : output.error)
        }

        const result: ToolCallResult = {
          toolName: tc.name,
          toolCallId: tc.id,
          input,
          output,
          durationMs: 0,
        }
        toolCallResults.push(result)

        // S28-15: Tool call callback
        callbacks.onToolCall?.(result)
      }

      // Update the assistant message with tool calls
      useAIChatStore.getState().updateLastAssistantMessage(textContent, toolCallResults)

      // Tool results are embedded in the message history via toolCalls on the assistant message.
      // buildMessagesArray will reconstruct them as tool_use + tool_result blocks.
      // Continue the loop — Claude will see the results and continue reasoning.
    }
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      // User cancelled — not an error
    } else {
      // S28-17: Error handling
      const errorMsg = (err as Error).message
      useAIChatStore.getState().setError(errorMsg)
      useAIChatStore.getState().addMessage({
        id: genMsgId(),
        role: 'system',
        content: `Error: ${errorMsg}`,
        timestamp: Date.now(),
      })
    }
  } finally {
    unsubscribe()
    useAIChatStore.getState().setGenerating(false)
  }
}

/**
 * Cancel the current generation.
 */
export function cancelGeneration(): void {
  useAIChatStore.getState().setGenerating(false)
}
