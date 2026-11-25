import { useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { claudePrice, formatUsd, imagePrice, spentSince, startOfToday, useCosts } from '@/ai/costs'
import { IMAGE_MODELS, loadImageSettings, saveImageSettings, testImageKey, type ImageSettings } from '@/ai/openai'
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

/** OpenAI key for pictures (Picture to drones). Stored only in this browser. */
export function ImageKeyForm({ onSaved, compact }: { onSaved?: () => void; compact?: boolean }) {
  const initial = loadImageSettings()
  const [apiKey, setApiKey] = useState(initial.apiKey)
  const [model, setModel] = useState(initial.model)
  const [quality, setQuality] = useState(initial.quality)
  const [show, setShow] = useState(false)
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null)
  const [testing, setTesting] = useState(false)
  const test = async () => {
    saveImageSettings({ apiKey, model, quality })
    setTesting(true)
    setStatus(null)
    try {
      await testImageKey(apiKey)
      setStatus({ ok: true, text: 'Connected to OpenAI.' })
      onSaved?.()
    } catch (err) {
      setStatus({ ok: false, text: err instanceof Error ? err.message : String(err) })
    } finally {
      setTesting(false)
    }
  }
  return (
    <div>
      <label className="field-label" htmlFor="img-key">OpenAI API key (pictures)</label>
      <div style={{ display: 'flex', gap: 6 }}>
        <input id="img-key" className="text-input" type={show ? 'text' : 'password'} autoComplete="off" spellCheck={false} placeholder="sk-…" value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
        <button className="btn icon" onClick={() => setShow(!show)} aria-label={show ? 'Hide key' : 'Show key'}>{show ? <EyeOff size={14} /> : <Eye size={14} />}</button>
      </div>
      {!compact && (
        <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
          <select className="select" aria-label="Image model" value={model} onChange={(e) => setModel(e.target.value)}>
            {IMAGE_MODELS.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
          <select className="select" aria-label="Picture quality" value={quality} onChange={(e) => setQuality(e.target.value as ImageSettings['quality'])}>
            <option value="low">Low quality (fast, cheapest)</option>
            <option value="medium">Medium quality</option>
            <option value="high">High quality</option>
          </select>
        </div>
      )}
      <div className="hint" style={{ marginTop: 4 }}>Used by Picture to drones to draw the line art. Stored only in this browser; requests go straight to OpenAI.</div>
      <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <button className="btn ai" onClick={test} disabled={testing || !apiKey.trim()}>{testing ? 'Checking…' : 'Save & test'}</button>
        {status && <span className={`hint ${status.ok ? 'ok' : 'err'}`}>{status.text}</span>}
      </div>
    </div>
  )
}

/** What the AI features have cost, and the prices the tracker uses (editable). */
function CostSettings() {
  const entries = useCosts((s) => s.entries)
  const total = useCosts((s) => s.total)
  const since = useCosts((s) => s.since)
  const overrides = useCosts((s) => s.overrides)
  const img = loadImageSettings()
  const cp = claudePrice(MODEL), ip = imagePrice(img.model)
  const byLabel = new Map<string, { n: number; usd: number }>()
  for (const e of entries) { const b = byLabel.get(e.label) ?? { n: 0, usd: 0 }; b.n++; b.usd += e.usd; byLabel.set(e.label, b) }
  const num = (v: number, on: (x: number) => void, label: string) => (
    <label className="cost-price"><span>{label}</span><input className="text-input" type="number" min={0} step={0.01} value={v} aria-label={label} onChange={(e) => on(Math.max(0, Number(e.target.value) || 0))} /></label>
  )
  return (
    <div style={{ marginTop: 18 }}>
      <div className="field-label">AI costs</div>
      <p style={{ margin: '0 0 6px' }}><b style={{ fontSize: 18 }}>{formatUsd(total)}</b> <span className="hint">since {new Date(since).toLocaleDateString()} · today {formatUsd(spentSince(entries, startOfToday()))}</span></p>
      {byLabel.size > 0 && (
        <table className="cost-table" style={{ marginBottom: 8 }}>
          <tbody>{[...byLabel.entries()].sort((a, b) => b[1].usd - a[1].usd).map(([l, b]) => <tr key={l}><td>{l}</td><td>{b.n}×</td><td className="cost-usd">{formatUsd(b.usd)}</td></tr>)}</tbody>
        </table>
      )}
      <div className="hint" style={{ marginBottom: 6 }}>Prices used (USD per million tokens). Estimates from list prices — your Anthropic and OpenAI bills are the source of truth.</div>
      <div className="cost-prices">
        <span className="cost-sub">{MODEL}</span>
        {num(cp.input, (x) => useCosts.getState().setClaudePrice(MODEL, { ...cp, input: x }), 'Input')}
        {num(cp.output, (x) => useCosts.getState().setClaudePrice(MODEL, { ...cp, output: x }), 'Output')}
        {num(cp.cacheRead, (x) => useCosts.getState().setClaudePrice(MODEL, { ...cp, cacheRead: x }), 'Cached input')}
      </div>
      <div className="cost-prices">
        <span className="cost-sub">{img.model}</span>
        {num(ip.textInput, (x) => useCosts.getState().setImagePrice(img.model, { ...ip, textInput: x }), 'Text input')}
        {num(ip.output, (x) => useCosts.getState().setImagePrice(img.model, { ...ip, output: x }), 'Image output')}
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
        {(overrides.claude[MODEL] || overrides.image[img.model]) && <button className="btn sm" onClick={() => { useCosts.getState().setClaudePrice(MODEL, null); useCosts.getState().setImagePrice(img.model, null) }}>Use list prices</button>}
        <button className="btn sm" onClick={() => useCosts.getState().reset()} disabled={!entries.length && !total}>Reset the cost history</button>
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
      <div style={{ marginTop: 18 }}>
        <ImageKeyForm onSaved={() => getState().toast('Picture settings saved')} />
      </div>
      <CostSettings />
      <div style={{ marginTop: 14 }}>
        <button
          className="btn sm danger"
          onClick={() => {
            saveAiSettings({ apiKey: '', baseURL: '' })
            saveImageSettings({ ...loadImageSettings(), apiKey: '' })
            getState().toast('API keys removed from this browser')
            onClose()
          }}
        >
          Remove keys from this browser
        </button>
      </div>
    </Modal>
  )
}
