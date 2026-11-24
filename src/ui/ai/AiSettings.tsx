import { useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { MODEL, MODEL_LABEL, describeError, getClient, loadAiSettings, saveAiSettings } from '@/ai/client'
import { getState } from '@/state/store'
import { Modal } from '../components/controls'

export function ApiKeyForm({ onSaved, compact }: { onSaved?: () => void; compact?: boolean }) {
  const initial = loadAiSettings()
  const [apiKey, setApiKey] = useState(initial.apiKey)
  const [baseURL, setBaseURL] = useState(initial.baseURL)
  const [show, setShow] = useState(false)
  const [advanced, setAdvanced] = useState(!!initial.baseURL)
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null)
  const [testing, setTesting] = useState(false)

  const save = () => {
    saveAiSettings({ apiKey, baseURL })
    onSaved?.()
  }

  const test = async () => {
    saveAiSettings({ apiKey, baseURL })
    setTesting(true)
    setStatus(null)
    try {
      // Free check: fetching the model's metadata verifies the key and access.
      await getClient().models.retrieve(MODEL)
      const text = `Connected — ${MODEL_LABEL} is available.`
      setStatus({ ok: true, text })
      getState().toast(text)
      onSaved?.()
    } catch (err) {
      setStatus({ ok: false, text: describeError(err) })
    } finally {
      setTesting(false)
    }
  }

  return (
    <div>
      <label className="field-label" htmlFor="ai-key">Claude API key</label>
      <div style={{ display: 'flex', gap: 6 }}>
        <input id="ai-key" className="text-input" type={show ? 'text' : 'password'} autoComplete="off" spellCheck={false} placeholder="sk-ant-…" value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
        <button className="btn icon" onClick={() => setShow(!show)} aria-label={show ? 'Hide key' : 'Show key'}>{show ? <EyeOff size={14} /> : <Eye size={14} />}</button>
      </div>
      {!compact && <div className="hint" style={{ marginTop: 4 }}>Create one in the Claude Console at platform.claude.com.</div>}
      <button className="btn ghost sm" style={{ marginTop: 6, paddingLeft: 0 }} onClick={() => setAdvanced(!advanced)}>{advanced ? '▾' : '▸'} Use a proxy instead</button>
      {advanced && (
        <>
          <label className="field-label" htmlFor="ai-proxy">Proxy URL (adds the key on your server)</label>
          <input id="ai-proxy" className="text-input" placeholder="https://your-proxy.example.com" value={baseURL} onChange={(e) => setBaseURL(e.target.value)} />
        </>
      )}
      <div className="privacy">
        Your key is stored only in this browser and requests go straight from your browser to the Claude API — nothing passes through our servers. Anyone who can use this browser profile could read the key, so for shared machines or a public deployment, use a proxy that holds the key server-side.
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <button className="btn ai" onClick={test} disabled={testing || (!apiKey.trim() && !baseURL.trim())}>{testing ? 'Checking…' : 'Save & test'}</button>
        {!compact && <button className="btn" onClick={save}>Save</button>}
        {status && <span className={`hint ${status.ok ? 'ok' : 'err'}`}>{status.text}</span>}
      </div>
    </div>
  )
}

export function AiSettingsDialog({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="AI settings" onClose={onClose} footer={<button className="btn" onClick={onClose}>Done</button>}>
      <p style={{ marginTop: 0, color: 'var(--muted)' }}>
        AI features use {MODEL_LABEL}. If a request is declined by a safety classifier, it is retried automatically on Anthropic’s recommended fallback model.
      </p>
      <ApiKeyForm onSaved={() => getState().toast('AI settings saved')} />
      <div style={{ marginTop: 14 }}>
        <button
          className="btn sm danger"
          onClick={() => {
            saveAiSettings({ apiKey: '', baseURL: '' })
            getState().toast('API key removed from this browser')
            onClose()
          }}
        >
          Remove key from this browser
        </button>
      </div>
    </Modal>
  )
}
