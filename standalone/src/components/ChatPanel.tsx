import { useState, useRef, useEffect, useCallback } from 'react'
import { Send, Square, Trash2, Settings, Wrench, Check, X, ChevronRight, ChevronDown } from 'lucide-react'
import { useChatStore, msgId, type ChatMessage, type ToolCallResult } from '../stores/chatStore'
import { sendMessage, cancelGeneration } from '../services/chatService'

export function ChatPanel() {
  const messages = useChatStore((s) => s.messages)
  const isGenerating = useChatStore((s) => s.isGenerating)
  const error = useChatStore((s) => s.error)
  const apiKey = useChatStore((s) => s.apiKey)

  const [input, setInput] = useState('')
  const [showSettings, setShowSettings] = useState(!apiKey)
  const listRef = useRef<HTMLDivElement>(null)
  const scrollLock = useRef(false)

  useEffect(() => {
    if (!scrollLock.current && listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight
  }, [messages])

  const handleSend = useCallback(() => {
    const msg = input.trim()
    if (!msg || isGenerating) return
    setInput(''); scrollLock.current = false
    sendMessage(msg)
  }, [input, isGenerating])

  if (showSettings) return <SettingsPanel onDone={() => setShowSettings(false)} />

  return (
    <div className="h-full flex flex-col">
      <div className="px-3 py-2 border-b border-white/10 flex items-center justify-between flex-shrink-0">
        <span className="text-xs font-semibold text-white/50">AI Formation Generator</span>
        <div className="flex gap-1">
          <button onClick={() => { if (messages.length === 0 || confirm('Clear?')) useChatStore.getState().clearHistory() }} className="text-white/20 hover:text-white/50 p-1"><Trash2 size={12} /></button>
          <button onClick={() => setShowSettings(true)} className="text-white/20 hover:text-white/50 p-1"><Settings size={12} /></button>
        </div>
      </div>

      <div ref={listRef} onScroll={() => { if (listRef.current) { const { scrollTop, scrollHeight, clientHeight } = listRef.current; scrollLock.current = scrollHeight - scrollTop - clientHeight > 50 } }} className="flex-1 overflow-y-auto px-3 py-2 space-y-3">
        {messages.length === 0 && (
          <div className="py-8 text-center">
            <p className="text-sm text-white/40 mb-2">Describe a drone formation</p>
            <p className="text-[10px] text-white/20">e.g., "BMW logo spinning with blue and white colors"</p>
            <div className="flex flex-wrap gap-1 mt-3 justify-center">
              {['Circle of 30 drones', 'Heart shape, red', 'Star spinning', 'Text: HELLO'].map((q) => (
                <button key={q} onClick={() => { setInput(''); scrollLock.current = false; sendMessage(q) }}
                  className="px-2 py-1 text-[10px] bg-white/5 hover:bg-white/10 rounded-full text-white/40">{q}</button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m) => <MessageBubble key={m.id} msg={m} />)}

        {isGenerating && messages[messages.length - 1]?.role === 'assistant' && (
          <span className="inline-block w-1.5 h-3 bg-blue-400 animate-pulse rounded-sm" />
        )}
      </div>

      {error && <div className="mx-3 mb-1 p-2 bg-red-900/30 border border-red-500/20 rounded text-[10px] text-red-300">{error}</div>}

      <div className="px-3 pb-3 pt-1 border-t border-white/10 flex-shrink-0">
        <div className="flex items-end gap-1.5">
          <textarea value={input} onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() } }}
            disabled={isGenerating} placeholder={isGenerating ? 'Generating...' : 'Describe a formation...'}
            rows={1} className="flex-1 bg-white/5 text-white text-xs px-3 py-2 rounded-lg border border-white/10 outline-none focus:border-blue-500/50 resize-none min-h-[34px] max-h-20 disabled:opacity-40 placeholder:text-white/20"
            onInput={(e) => { const el = e.currentTarget; el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 80) + 'px' }} />
          {isGenerating
            ? <button onClick={cancelGeneration} className="p-2 bg-red-500/20 hover:bg-red-500/30 text-red-300 rounded-lg flex-shrink-0"><Square size={14} /></button>
            : <button onClick={handleSend} disabled={!input.trim()} className="p-2 bg-blue-600/30 hover:bg-blue-600/50 text-blue-300 rounded-lg flex-shrink-0 disabled:opacity-30"><Send size={14} /></button>
          }
        </div>
      </div>
    </div>
  )
}

function MessageBubble({ msg }: { msg: ChatMessage }) {
  if (msg.role === 'system') return <div className="text-[10px] text-red-300/60 bg-red-900/10 rounded px-2 py-1">{msg.content}</div>
  if (msg.role === 'user') return <div className="flex justify-end"><div className="max-w-[85%] bg-blue-600/20 text-white/80 text-xs px-3 py-2 rounded-lg rounded-br-none">{msg.content}</div></div>

  return (
    <div className="max-w-[95%]">
      {msg.content && <div className="text-xs text-white/70 leading-relaxed whitespace-pre-wrap">{msg.content}</div>}
      {msg.toolCalls?.map((tc, i) => <ToolCard key={i} tc={tc} />)}
    </div>
  )
}

function ToolCard({ tc }: { tc: ToolCallResult }) {
  const [open, setOpen] = useState(false)
  const summary = tc.toolName === 'set_formation'
    ? `Created ${(tc.output.data as { droneCount?: number })?.droneCount ?? '?'} drones`
    : tc.toolName === 'modify_drones' ? 'Modified drones'
    : tc.toolName === 'validate' ? `Validation: ${(tc.output.data as { count?: number })?.count ?? 0} violations`
    : tc.toolName

  return (
    <div className={`my-1 rounded border text-[11px] ${tc.output.success ? 'border-white/10 bg-white/[0.02]' : 'border-red-500/20 bg-red-900/10'}`}>
      <div className="flex items-center gap-1.5 px-2 py-1 cursor-pointer hover:bg-white/5" onClick={() => setOpen(!open)}>
        {tc.output.success ? <Check size={11} className="text-green-400" /> : <X size={11} className="text-red-400" />}
        <Wrench size={10} className="text-white/20" />
        <span className="flex-1 text-white/60 truncate">{summary}</span>
        <span className="text-white/20 text-[9px]">{tc.durationMs}ms</span>
        {open ? <ChevronDown size={12} className="text-white/30" /> : <ChevronRight size={12} className="text-white/30" />}
      </div>
      {open && (
        <div className="px-2 pb-2 border-t border-white/5 space-y-1">
          <pre className="text-[9px] text-white/40 bg-black/20 rounded p-1 overflow-auto max-h-32">{JSON.stringify(tc.output.data, null, 2)?.slice(0, 800)}</pre>
        </div>
      )}
    </div>
  )
}

function SettingsPanel({ onDone }: { onDone: () => void }) {
  const apiKey = useChatStore((s) => s.apiKey)
  const model = useChatStore((s) => s.model)
  const [key, setKey] = useState(apiKey)

  return (
    <div className="h-full flex flex-col p-4 space-y-4">
      <div className="text-sm font-semibold text-white/60">Settings</div>
      <div>
        <label className="text-[10px] text-white/40 block mb-1">Claude API Key</label>
        <input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="sk-ant-..."
          className="w-full bg-white/5 text-white text-xs px-3 py-2 rounded border border-white/10 outline-none focus:border-blue-500/50" />
      </div>
      <div>
        <label className="text-[10px] text-white/40 block mb-1">Model</label>
        <select value={model} onChange={(e) => useChatStore.getState().setModel(e.target.value)}
          className="w-full bg-white/5 text-white text-xs px-3 py-2 rounded border border-white/10 outline-none">
          <option value="claude-sonnet-4-6">Sonnet 4.6</option>
          <option value="claude-opus-4-6">Opus 4.6</option>
          <option value="claude-haiku-4-5-20251001">Haiku 4.5</option>
        </select>
      </div>
      <button onClick={() => { useChatStore.getState().setApiKey(key); onDone() }}
        className="px-4 py-2 text-xs bg-blue-600 hover:bg-blue-500 text-white rounded">Save</button>
    </div>
  )
}
