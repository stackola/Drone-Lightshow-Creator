// ============================================================================
// S29: AI Chat Panel — full chat interface for the AI co-designer
// ============================================================================

import { useState, useRef, useEffect, useCallback } from 'react'
import { Send, Square, Trash2, Settings, Copy, Sparkles, CheckCheck, Eye, EyeOff, ExternalLink } from 'lucide-react'
import { useAIChatStore, type ChatMessage } from '../stores/aiChatStore'
import { sendMessage, cancelGeneration } from '../services/aiChatService'
import { AIToolCard } from './AIToolCard'
import { Tooltip } from './Tooltip'

// ── S29-04: Lightweight markdown renderer ───────────────────────────────────

function renderMarkdown(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code class="bg-white/10 px-1 rounded text-caption">$1</code>')
    .replace(/^### (.+)$/gm, '<div class="text-sm font-semibold text-white/80 mt-2">$1</div>')
    .replace(/^## (.+)$/gm, '<div class="text-sm font-bold text-white/90 mt-2">$1</div>')
    .replace(/^- (.+)$/gm, '<div class="pl-3">• $1</div>')
    .replace(/^(\d+)\. (.+)$/gm, '<div class="pl-3">$1. $2</div>')
    .replace(/\n/g, '<br/>')
}

// ── S29-13: Quick action suggestions ────────────────────────────────────────

const QUICK_ACTIONS = [
  { label: 'Create a show', prompt: 'Create a 2-minute show with 100 drones. Include a variety of formations and transitions.' },
  { label: 'Fix violations', prompt: 'Check for physics violations and fix them all.' },
  { label: 'Critique this show', prompt: 'Analyze the current show and suggest improvements for pacing, variety, and visual impact.' },
  { label: 'Add a formation', prompt: 'Add a new heart formation with 100 drones after the current last formation.' },
]

// ── S29-01: Main Chat Panel ─────────────────────────────────────────────────

export function AIChatPanel() {
  const messages = useAIChatStore((s) => s.messages)
  const isGenerating = useAIChatStore((s) => s.isGenerating)
  const error = useAIChatStore((s) => s.error)
  const settings = useAIChatStore((s) => s.settings)
  const tokenUsage = useAIChatStore((s) => s.tokenUsage)

  const [input, setInput] = useState('')
  const [showSettings, setShowSettings] = useState(false)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const userScrolledUp = useRef(false)

  // ── S29-05: Auto-scroll ───────────────────────────────────────────────
  useEffect(() => {
    if (!userScrolledUp.current && listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight
    }
  }, [messages])

  const handleScroll = useCallback(() => {
    if (!listRef.current) return
    const { scrollTop, scrollHeight, clientHeight } = listRef.current
    userScrolledUp.current = scrollHeight - scrollTop - clientHeight > 50
  }, [])

  // ── S29-11: Send message ──────────────────────────────────────────────
  const handleSend = useCallback(() => {
    const msg = input.trim()
    if (!msg || isGenerating) return
    setInput('')
    userScrolledUp.current = false

    sendMessage(msg, {
      onStream: () => {
        // Auto-scroll on new chunks
        if (!userScrolledUp.current && listRef.current) {
          listRef.current.scrollTop = listRef.current.scrollHeight
        }
      },
    })
  }, [input, isGenerating])

  // S29-11: Enter to send, Shift+Enter for newline
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }, [handleSend])

  // S29-12: Stop generation
  const handleStop = useCallback(() => {
    cancelGeneration()
  }, [])

  // S29-13: Quick action
  const handleQuickAction = useCallback((prompt: string) => {
    setInput('')
    userScrolledUp.current = false
    sendMessage(prompt)
  }, [])

  // S29-21: Clear history
  const handleClear = useCallback(() => {
    if (messages.length === 0 || window.confirm('Clear conversation history?')) {
      useAIChatStore.getState().clearHistory()
    }
  }, [messages.length])

  // S29-22: Copy message
  const handleCopy = useCallback((msgId: string, content: string) => {
    navigator.clipboard.writeText(content).then(() => {
      setCopiedId(msgId)
      setTimeout(() => setCopiedId(null), 2000)
    })
  }, [])

  // ── S29-19: Not configured state ──────────────────────────────────────
  if (!settings.enabled && !showSettings) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-4 text-center">
        <Sparkles size={32} className="text-purple-400/50 mb-3" />
        <div className="text-sm font-medium text-white/60 mb-1">AI Co-Designer</div>
        <p className="text-xs text-white/30 mb-4 max-w-[200px]">
          Set your Claude API key to start designing with AI assistance.
        </p>
        <button onClick={() => setShowSettings(true)}
          className="px-4 py-2 text-xs bg-purple-600/30 hover:bg-purple-600/50 text-purple-300 rounded transition-colors">
          Configure API Key
        </button>
      </div>
    )
  }

  // ── S29-14: Inline settings ───────────────────────────────────────────
  if (showSettings) {
    return <InlineSettings onClose={() => setShowSettings(false)} />
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-3 py-1.5 border-b border-white/10 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-1.5">
          <Sparkles size={13} className="text-purple-400" />
          <span className="text-caption font-semibold text-white/60">AI Co-Designer</span>
          {isGenerating && <span className="text-[9px] text-purple-400 animate-pulse">thinking...</span>}
        </div>
        <div className="flex items-center gap-1">
          <Tooltip label="Clear chat history" side="bottom">
            <button onClick={handleClear} className="text-white/20 hover:text-white/50 p-1" aria-label="Clear history">
              <Trash2 size={12} />
            </button>
          </Tooltip>
          <Tooltip label="AI settings" side="bottom">
            <button onClick={() => setShowSettings(true)} className="text-white/20 hover:text-white/50 p-1" aria-label="AI settings">
              <Settings size={12} />
            </button>
          </Tooltip>
        </div>
      </div>

      {/* S29-02: Message list */}
      <div ref={listRef} onScroll={handleScroll} className="flex-1 overflow-y-auto px-3 py-2 space-y-3">
        {/* S29-17: Welcome message */}
        {messages.length === 0 && (
          <div className="py-4 text-center">
            <Sparkles size={24} className="text-purple-400/30 mx-auto mb-2" />
            <p className="text-xs text-white/40 mb-1">I can help you design drone shows.</p>
            <p className="text-micro text-white/25">Describe what you want to create, or try a quick action below.</p>
          </div>
        )}

        {messages.map((msg) => (
          <MessageBubble
            key={msg.id}
            message={msg}
            isCopied={copiedId === msg.id}
            onCopy={handleCopy}
          />
        ))}

        {/* S29-03: Streaming cursor */}
        {isGenerating && messages.length > 0 && messages[messages.length - 1]?.role === 'assistant' && (
          <span className="inline-block w-1.5 h-3 bg-purple-400 animate-pulse rounded-sm ml-1" />
        )}
      </div>

      {/* S29-13: Quick actions (show when no messages) */}
      {messages.length === 0 && !isGenerating && (
        <div className="px-3 pb-2 flex flex-wrap gap-1">
          {QUICK_ACTIONS.map((qa) => (
            <button key={qa.label} onClick={() => handleQuickAction(qa.prompt)}
              className="px-2 py-1 text-micro bg-purple-500/10 hover:bg-purple-500/20 text-purple-300/70 rounded-full transition-colors">
              {qa.label}
            </button>
          ))}
        </div>
      )}

      {/* S29-20: Error display */}
      {error && (
        <div className="mx-3 mb-2 p-2 bg-red-900/20 border border-red-500/20 rounded text-micro text-red-300">
          {error}
        </div>
      )}

      {/* S29-11/12: Input bar */}
      <div className="px-3 pb-2 pt-1 border-t border-white/10 flex-shrink-0">
        <div className="flex items-end gap-1.5">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isGenerating}
            placeholder={isGenerating ? 'Generating...' : 'Describe what you want...'}
            rows={1}
            className="flex-1 bg-white/5 text-white text-xs px-3 py-2 rounded-lg border border-white/10 outline-none focus:border-purple-500/50 resize-none min-h-[34px] max-h-20 disabled:opacity-40 placeholder:text-white/20"
            style={{ height: 'auto', overflow: 'hidden' }}
            onInput={(e) => {
              const el = e.currentTarget
              el.style.height = 'auto'
              el.style.height = Math.min(el.scrollHeight, 80) + 'px'
            }}
          />
          {isGenerating ? (
            <Tooltip label="Stop generation" shortcut="Esc" side="top">
              <button onClick={handleStop}
                className="p-2 bg-red-500/20 hover:bg-red-500/30 text-red-300 rounded-lg transition-colors flex-shrink-0"
                aria-label="Stop generation">
                <Square size={14} />
              </button>
            </Tooltip>
          ) : (
            <Tooltip label="Send message" shortcut="Enter" side="top">
              <button onClick={handleSend} disabled={!input.trim()}
                className="p-2 bg-purple-600/30 hover:bg-purple-600/50 text-purple-300 rounded-lg transition-colors flex-shrink-0 disabled:opacity-30"
                aria-label="Send">
                <Send size={14} />
              </button>
            </Tooltip>
          )}
        </div>
      </div>

      {/* S29-18: Token usage footer */}
      {tokenUsage.total > 0 && (
        <div className="px-3 pb-1 text-[9px] text-white/15 text-right">
          ~{(tokenUsage.total / 1000).toFixed(1)}k tokens (~${(tokenUsage.total * 0.000003).toFixed(3)})
        </div>
      )}
    </div>
  )
}

// ── S29-02: Message Bubble ──────────────────────────────────────────────────

function MessageBubble({ message, isCopied, onCopy }: {
  message: ChatMessage
  isCopied: boolean
  onCopy: (id: string, content: string) => void
}) {
  if (message.role === 'system') {
    return (
      <div className="text-micro text-red-300/60 bg-red-900/10 rounded px-2 py-1 border border-red-500/10">
        {message.content}
      </div>
    )
  }

  if (message.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] bg-purple-600/20 text-white/80 text-xs px-3 py-2 rounded-lg rounded-br-none">
          {message.content}
        </div>
      </div>
    )
  }

  // Assistant message
  return (
    <div className="max-w-[95%] group">
      {/* Text content with markdown */}
      {message.content && (
        <div className="relative">
          <div
            className="text-xs text-white/70 leading-relaxed"
            dangerouslySetInnerHTML={{ __html: renderMarkdown(message.content) }}
          />
          {/* S29-22: Copy button */}
          <Tooltip label={isCopied ? 'Copied!' : 'Copy message'} side="left">
            <button
              onClick={() => onCopy(message.id, message.content)}
              className="absolute -right-1 top-0 opacity-0 group-hover:opacity-100 text-white/20 hover:text-white/50 p-0.5 transition-opacity"
              aria-label="Copy message"
            >
              {isCopied ? <CheckCheck size={11} className="text-green-400" /> : <Copy size={11} />}
            </button>
          </Tooltip>
        </div>
      )}

      {/* S29-09: Tool call cards sequence */}
      {message.toolCalls && message.toolCalls.length > 0 && (
        <div className="mt-1">
          {message.toolCalls.map((tc, i) => (
            <AIToolCard key={`${tc.toolCallId}-${i}`} toolCall={tc} />
          ))}
        </div>
      )}
    </div>
  )
}

// ── S29-14: Inline Settings Panel ───────────────────────────────────────────

function InlineSettings({ onClose }: { onClose: () => void }) {
  const settings = useAIChatStore((s) => s.settings)
  const updateSettings = useAIChatStore((s) => s.updateSettings)
  const [apiKey, setApiKey] = useState(settings.apiKey)
  const [model, setModel] = useState(settings.model)
  // N-05: show/hide toggle for the API key. Defaults to hidden; the eye
  // icon reveals briefly so the user can verify their paste.
  const [showKey, setShowKey] = useState(false)

  const handleSave = () => {
    updateSettings({ apiKey, model })
    onClose()
  }

  return (
    <div className="h-full flex flex-col p-3 space-y-3">
      <div className="text-xs font-semibold text-white/60">AI Settings</div>
      <div>
        <label className="text-micro text-white/40 block mb-1">Claude API Key</label>
        <div className="relative">
          <input
            type={showKey ? 'text' : 'password'}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="sk-ant-..."
            className="w-full bg-white/5 text-white text-xs pl-3 pr-8 py-2 rounded border border-white/10 outline-none focus:border-purple-500/50"
          />
          <button
            type="button"
            onClick={() => setShowKey((v) => !v)}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1 text-white/40 hover:text-white/80 transition-colors"
            aria-label={showKey ? 'Hide API key' : 'Show API key'}
            title={showKey ? 'Hide' : 'Show'}
          >
            {showKey ? <EyeOff size={12} /> : <Eye size={12} />}
          </button>
        </div>
        <p className="text-[9px] text-white/20 mt-0.5">Stored in session only. Never saved to disk.</p>
      </div>
      <div>
        <label className="text-micro text-white/40 block mb-1">Model</label>
        <select value={model} onChange={(e) => setModel(e.target.value)}
          className="w-full bg-white/5 text-white text-xs px-3 py-2 rounded border border-white/10 outline-none">
          <option value="claude-sonnet-4-6">Claude Sonnet 4.6 (fast)</option>
          <option value="claude-opus-4-6">Claude Opus 4.6 (best)</option>
          <option value="claude-haiku-4-5-20251001">Claude Haiku 4.5 (cheapest)</option>
        </select>
      </div>
      <div className="flex gap-2 pt-2">
        <button onClick={handleSave}
          className="flex-1 px-3 py-1.5 text-xs bg-purple-600 hover:bg-purple-500 text-white rounded transition-colors">
          Save
        </button>
        <button onClick={onClose}
          className="px-3 py-1.5 text-xs text-white/40 hover:text-white/60 bg-white/5 rounded transition-colors">
          Cancel
        </button>
      </div>
      {/* N-05: where-to-get-a-key footer. Single inline link instead of a
          docs section since the dialog is small. */}
      <div className="text-micro text-white/30 pt-1 border-t border-white/5 flex items-center gap-1">
        <a
          href="https://console.anthropic.com/settings/keys"
          target="_blank"
          rel="noopener noreferrer"
          className="hover:text-white/60 inline-flex items-center gap-0.5"
        >
          Get an API key <ExternalLink size={9} />
        </a>
      </div>
    </div>
  )
}
