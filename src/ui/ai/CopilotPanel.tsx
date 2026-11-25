import { useEffect, useRef, useState } from 'react'
import { ArrowUp, Check, Loader2, Plus, Settings2, Sparkles, Square, TriangleAlert, Undo2 } from 'lucide-react'
import { formatUsd, spentSince, useCosts } from '@/ai/costs'
import { STARTERS, newChat, sendToCopilot, stopCopilot, useCopilot, type ChatItem } from '@/ai/copilot'
import { MODEL_LABEL, aiConfigured, onUsage, type Usage } from '@/ai/client'
import { getState, useStore } from '@/state/store'
import { Markdown } from './Markdown'
import { ApiKeyForm } from './AiSettings'

function useAiConfigured(): [boolean, () => void] {
  const [ok, setOk] = useState(() => aiConfigured())
  const dialog = useStore((s) => s.dialog)
  useEffect(() => setOk(aiConfigured()), [dialog])
  return [ok, () => setOk(aiConfigured())]
}

export function useUsage(): Usage {
  const [u, setU] = useState<Usage>({ input: 0, output: 0, cacheRead: 0, requests: 0 })
  useEffect(() => onUsage(setU), [])
  return u
}

function Item({ item, last }: { item: ChatItem; last: boolean }) {
  const pastLength = useStore((s) => s.past.length)
  switch (item.kind) {
    case 'user':
      return <div className="cp-user">{item.text}</div>
    case 'assistant':
      return (
        <div className="cp-assistant">
          {item.streaming && !item.text && (
            <div className="cp-thinking">
              <Loader2 size={12} className="spin" />
              <span>{item.thinking ? item.thinking.split('\n').filter(Boolean).slice(-1)[0] : 'Thinking…'}</span>
            </div>
          )}
          {item.text && <Markdown text={item.text} />}
        </div>
      )
    case 'tool':
      return (
        <div className={`cp-tool ${item.status === 'error' ? 'error' : ''}`}>
          {item.status === 'running' ? <Loader2 size={13} className="spin" /> : item.status === 'ok' ? <Check size={13} color="var(--ok)" /> : <TriangleAlert size={13} color="var(--err)" />}
          <div>
            <div className="t-label">{item.label}</div>
            {item.summary && item.summary !== item.label && <div className="t-sum">{item.summary}</div>}
          </div>
        </div>
      )
    case 'notice':
      return <div className={`cp-notice ${item.tone}`}>{item.text}</div>
    case 'turn':
      if (!item.changed) return last ? null : <div className="cp-turn" />
      return (
        <div className="cp-turn">
          <span style={{ flex: 1 }}>Changes saved as one undo step</span>
          <button className="btn sm ghost" disabled={pastLength !== item.historyLength} title={pastLength !== item.historyLength ? 'The show changed since — use the main Undo' : 'Undo everything the copilot did for this request'} onClick={() => getState().undo()}>
            <Undo2 size={12} /> Undo
          </button>
        </div>
      )
  }
}

export function CopilotPanel() {
  const items = useCopilot((s) => s.items)
  const running = useCopilot((s) => s.running)
  const [configured, recheck] = useAiConfigured()
  const [text, setText] = useState('')
  const logRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const usage = useUsage()
  const sessionCost = useCosts((s) => spentSince(s.entries, s.sessionStart))
  const hasMusic = useStore((s) => !!s.doc.audio)

  useEffect(() => {
    const el = logRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [items])

  const send = (value = text) => {
    if (!value.trim() || running) return
    setText('')
    void sendToCopilot(value)
  }

  return (
    <div className="copilot" aria-label="Copilot">
      <div className="panel-head" style={{ paddingBottom: 6 }}>
        <Sparkles size={13} className="ai-mark" /> Copilot
        <span className="count" style={{ textTransform: 'none', letterSpacing: 0 }}>{MODEL_LABEL}</span>
        <div className="spacer" />
        <button className="btn ghost icon sm" title="New chat" aria-label="New chat" onClick={newChat} disabled={!items.length}><Plus size={14} /></button>
        <button className="btn ghost icon sm" title="AI settings" aria-label="AI settings" onClick={() => getState().set({ dialog: 'ai-settings' })}><Settings2 size={14} /></button>
      </div>
      {!configured ? (
        <div className="scroll">
          <div className="ai-setup">
            <h3>Connect Claude</h3>
            <p className="hint" style={{ margin: '0 0 6px', color: 'var(--muted)' }}>The copilot edits your show by conversation: “make the heart pink”, “add flashes on the drop”, “review my show”.</p>
            <ApiKeyForm onSaved={recheck} compact />
          </div>
        </div>
      ) : (
        <>
          <div className="scroll cp-log" ref={logRef}>
            {!items.length && (
              <div className="cp-intro">
                <h3><Sparkles size={14} className="ai-mark" /> Edit your show by talking to it</h3>
                <div>Ask for changes in plain words. The copilot sees the show, the music and how formations look, and every change still goes through the safety engine. One request is one undo step.</div>
                <div className="chips">
                  {STARTERS.filter((s) => hasMusic || !/music|beat/i.test(s.label)).map((s) => (
                    <button key={s.label} className="chip" onClick={() => send(s.prompt)}>{s.label}</button>
                  ))}
                </div>
              </div>
            )}
            {items.map((it, i) => <Item key={it.id} item={it} last={i === items.length - 1} />)}
          </div>
          <div className="cp-input">
            <textarea
              ref={inputRef}
              rows={2}
              value={text}
              placeholder={running ? 'Working…' : 'Ask for a change, e.g. “make the heart pink and slow the globe”'}
              aria-label="Message the copilot"
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  send()
                }
              }}
            />
            {running ? (
              <button className="btn icon" onClick={stopCopilot} title="Stop" aria-label="Stop"><Square size={13} /></button>
            ) : (
              <button className="btn icon ai" onClick={() => send()} disabled={!text.trim()} title="Send (Enter)" aria-label="Send"><ArrowUp size={15} /></button>
            )}
          </div>
          <div className="cp-foot">
            <span>Shift+Enter for a new line</span>
            {usage.requests > 0 && <span title="AI cost this session (estimated from list prices) and tokens used">{formatUsd(sessionCost)} · {Math.round(usage.input / 1000)}k in · {Math.round(usage.output / 1000)}k out</span>}
          </div>
        </>
      )}
    </div>
  )
}
