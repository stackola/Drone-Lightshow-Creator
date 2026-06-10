// Chat Service — Claude API streaming + agentic tool loop

import { useChatStore, msgId, type ChatMessage, type ToolCallResult } from '../stores/chatStore'
import { executeTool, getToolDefinitions, getSystemPrompt } from './aiEngine'

export async function sendMessage(userMessage: string): Promise<void> {
  const store = useChatStore.getState()
  if (!store.apiKey) { store.setError('Set your API key first.'); return }

  store.addMessage({ id: msgId(), role: 'user', content: userMessage, timestamp: Date.now() })
  store.setGenerating(true)
  store.setError(null)

  const abort = new AbortController()
  const unsub = useChatStore.subscribe((s) => { if (!s.isGenerating) abort.abort() })

  try {
    for (let round = 0; round < 10; round++) {
      const msgs = buildMessages(useChatStore.getState().messages)
      const resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': store.apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model: store.model,
          max_tokens: 16384,
          system: getSystemPrompt(),
          messages: msgs,
          tools: getToolDefinitions(),
          stream: true,
        }),
        signal: abort.signal,
      })

      if (!resp.ok) {
        const txt = await resp.text().catch(() => '')
        throw new Error(resp.status === 401 ? 'Invalid API key' : resp.status === 429 ? 'Rate limited — wait a moment' : `API error ${resp.status}: ${txt.slice(0, 200)}`)
      }

      // Parse streaming response
      let text = ''
      const toolCalls: { id: string; name: string; json: string }[] = []
      let curJson = ''

      useChatStore.getState().addMessage({ id: msgId(), role: 'assistant', content: '', timestamp: Date.now() })

      const reader = resp.body!.getReader()
      const decoder = new TextDecoder()
      let buf = ''
      let curToolId = '', curToolName = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const lines = buf.split('\n')
        buf = lines.pop()!

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const data = line.slice(6).trim()
          if (data === '[DONE]') continue
          try {
            const ev = JSON.parse(data)
            if (ev.type === 'content_block_start' && ev.content_block?.type === 'tool_use') {
              curToolId = ev.content_block.id ?? ''; curToolName = ev.content_block.name ?? ''; curJson = ''
            } else if (ev.type === 'content_block_delta') {
              if (ev.delta?.type === 'text_delta') {
                text += ev.delta.text
                useChatStore.getState().updateLastAssistant(text)
              } else if (ev.delta?.type === 'input_json_delta') {
                curJson += ev.delta.partial_json
              }
            } else if (ev.type === 'content_block_stop' && curToolId) {
              toolCalls.push({ id: curToolId, name: curToolName, json: curJson })
              curToolId = ''; curToolName = ''
            }
          } catch { /* skip */ }
        }
      }
      reader.releaseLock()

      if (abort.signal.aborted) break

      // Detect truncated tool call
      if (curJson && toolCalls.length === 0) {
        console.warn(`[AI] Tool call truncated (${curJson.length} chars). max_tokens may be too low.`)
        useChatStore.getState().updateLastAssistant(text + '\n\n*[Response truncated — try fewer drones or a simpler shape]*')
        break
      }

      if (toolCalls.length === 0) break

      // Execute tools
      const results: ToolCallResult[] = []
      for (const tc of toolCalls) {
        let input: Record<string, unknown> = {}
        try { input = tc.json ? JSON.parse(tc.json) : {} }
        catch (e) {
          console.error(`[AI] JSON parse error for ${tc.name}:`, (e as Error).message)
          results.push({ toolName: tc.name, toolCallId: tc.id, input: {}, output: { success: false, error: `JSON parse failed (${tc.json.length} chars)` }, durationMs: 0 })
          continue
        }

        const t0 = performance.now()
        const output = executeTool(tc.name, input)
        const ms = Math.round(performance.now() - t0)
        console.log(`[AI] ${tc.name}: ${output.success ? 'OK' : 'FAIL'} (${ms}ms)`)
        results.push({ toolName: tc.name, toolCallId: tc.id, input, output, durationMs: ms })
      }

      useChatStore.getState().updateLastAssistant(text, results)
      // Loop continues — Claude sees tool results and can respond
    }
  } catch (e) {
    if ((e as Error).name !== 'AbortError') {
      useChatStore.getState().setError((e as Error).message)
    }
  } finally {
    unsub()
    useChatStore.getState().setGenerating(false)
  }
}

export function cancelGeneration() { useChatStore.getState().setGenerating(false) }

function buildMessages(history: ChatMessage[]) {
  const msgs: Array<{ role: string; content: unknown }> = []
  for (const m of history.slice(-20)) {
    if (m.role === 'user') {
      msgs.push({ role: 'user', content: m.content })
    } else if (m.role === 'assistant') {
      if (m.toolCalls?.length) {
        const blocks: unknown[] = []
        if (m.content) blocks.push({ type: 'text', text: m.content })
        for (const tc of m.toolCalls) blocks.push({ type: 'tool_use', id: tc.toolCallId, name: tc.toolName, input: tc.input })
        msgs.push({ role: 'assistant', content: blocks })
        const resultBlocks = m.toolCalls.map((tc) => ({ type: 'tool_result', tool_use_id: tc.toolCallId, content: JSON.stringify(tc.output.data ?? tc.output.error ?? '') }))
        msgs.push({ role: 'user', content: resultBlocks })
      } else {
        msgs.push({ role: 'assistant', content: m.content })
      }
    }
  }
  return msgs
}
