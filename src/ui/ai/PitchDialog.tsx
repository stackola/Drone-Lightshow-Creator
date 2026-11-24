import { useRef, useState } from 'react'
import { Copy, Download, Loader2, Sparkles } from 'lucide-react'
import { writePitch } from '@/ai/pitch'
import { describeError } from '@/ai/client'
import { getState, useStore } from '@/state/store'
import { download, safeName } from '@/state/persist'
import { Modal, Select } from '../components/controls'
import { Markdown } from './Markdown'

const TONES = ['Premium and elegant', 'Joyful and festive', 'Confident and corporate', 'Romantic and intimate', 'Bold and energetic']

export function PitchDialog({ onClose }: { onClose: () => void }) {
  const showName = useStore((s) => s.doc.name)
  const issues = useStore((s) => s.validation?.issues.length ?? 0)
  const [client, setClient] = useState('')
  const [occasion, setOccasion] = useState('')
  const [tone, setTone] = useState(TONES[0]!)
  const [language, setLanguage] = useState('English')
  const [notes, setNotes] = useState('')
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const controller = useRef<AbortController | null>(null)

  const run = async () => {
    setBusy(true)
    setError(null)
    setText('')
    controller.current = new AbortController()
    try {
      setText(await writePitch({ client, occasion, tone, language, notes }, setText, controller.current.signal))
    } catch (err) {
      setError(describeError(err))
    } finally {
      setBusy(false)
      controller.current = null
    }
  }

  return (
    <Modal
      title="Write a client pitch"
      onClose={() => { controller.current?.abort(); onClose() }}
      footer={
        <>
          {text && !busy && (
            <>
              <button className="btn" onClick={() => { void navigator.clipboard.writeText(text); getState().toast('Pitch copied') }}><Copy size={13} /> Copy</button>
              <button className="btn" onClick={() => download(text, `${safeName(showName)}-pitch.md`, 'text/markdown')}><Download size={13} /> Download .md</button>
            </>
          )}
          {busy ? <button className="btn" onClick={() => controller.current?.abort()}>Stop</button> : <button className="btn ai" onClick={run}><Sparkles size={14} /> {text ? 'Rewrite' : 'Write pitch'}</button>}
        </>
      }
    >
      <p style={{ marginTop: 0, color: 'var(--muted)' }}>A proposal you can send to the client, written from the actual show: its scenes, timing, music and exact safety figures. Unknowns like dates and prices become [placeholders].</p>
      {issues > 0 && <div className="cp-notice error" style={{ marginBottom: 8 }}>The show has {issues} open safety issue{issues > 1 ? 's' : ''}; the pitch will describe safety as “to be finalised”.</div>}
      <div className="grid3" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <div><label className="field-label" htmlFor="p-client">Client</label><input id="p-client" className="text-input" value={client} onChange={(e) => setClient(e.target.value)} placeholder="e.g. Hartmann Bakery" /></div>
        <div><label className="field-label" htmlFor="p-occ">Occasion</label><input id="p-occ" className="text-input" value={occasion} onChange={(e) => setOccasion(e.target.value)} placeholder="e.g. 50th anniversary" /></div>
        <div><label className="field-label">Tone</label><Select value={tone} ariaLabel="Tone" options={TONES.map((t) => ({ value: t, label: t }))} onChange={setTone} /></div>
        <div><label className="field-label" htmlFor="p-lang">Language</label><input id="p-lang" className="text-input" value={language} onChange={(e) => setLanguage(e.target.value)} /></div>
      </div>
      <label className="field-label" htmlFor="p-notes">Anything to mention (optional)</label>
      <input id="p-notes" className="text-input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. weather backup date, our team’s experience" />
      {error && <div className="cp-notice error" style={{ marginTop: 10 }}>{error}</div>}
      {(text || busy) && (
        <div className="pitch-out" aria-live="polite">
          {text ? <Markdown text={text} /> : <span className="hint"><Loader2 size={12} className="spin" /> Looking at your show and writing…</span>}
        </div>
      )}
    </Modal>
  )
}
