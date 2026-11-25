import { useMemo, useRef, useState } from 'react'
import { Check, Loader2, Sparkles } from 'lucide-react'
import { CostMeter } from './CostMeter'
import { directShow, type DirectorProgress, type DirectorResult } from '@/ai/director'
import { describeError } from '@/ai/client'
import { getState, useStore } from '@/state/store'
import { compile, scenePointColors } from '@/core/compile'
import { formatTime } from '@/core/validate'
import { Modal, NumberField, Segmented, Toggle } from '../components/controls'
import { Thumb } from '../components/Thumb'

const EXAMPLES = [
  'Product launch for "NOVA", a new electric car. Brand colours teal and white. Build up to the reveal of the name, end on a lightning bolt.',
  'Wedding of Mia & Leo on a summer evening by the lake: romantic, gold and soft pink, their initials, two hearts merging, a starry finale.',
  'New Year’s Eve for a city: countdown 3-2-1, the year 2027, fireworks-style bursts, the city’s skyline and a big finale.',
]

type Length = 'music' | 'natural' | '60' | '120' | '180' | '300'

export function DirectorDialog({ onClose }: { onClose: () => void }) {
  const doc = useStore((s) => s.doc)
  // A composed score belongs to the current show; a new show gets a new one.
  const hasMusic = !!doc.audio?.beats.length && !doc.audio.generated
  const [openedAt] = useState(() => Date.now())
  const [brief, setBrief] = useState('')
  const [drones, setDrones] = useState(doc.droneCount)
  const [length, setLength] = useState<Length>(hasMusic ? 'music' : 'natural')
  const [useMusic, setUseMusic] = useState(hasMusic)
  const [compose, setCompose] = useState(!hasMusic)
  const [progress, setProgress] = useState<DirectorProgress | null>(null)
  const [result, setResult] = useState<DirectorResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const controller = useRef<AbortController | null>(null)

  const run = async () => {
    setError(null)
    setResult(null)
    controller.current = new AbortController()
    setProgress({ phase: 'planning', scenes: [] })
    try {
      const target = length === 'music' || length === 'natural' ? null : Number(length)
      const r = await directShow({ brief, droneCount: drones, targetSeconds: target, useMusic: useMusic && hasMusic, composeScore: compose && !(useMusic && hasMusic) }, setProgress, controller.current.signal)
      setResult(r)
    } catch (err) {
      setError(describeError(err))
    } finally {
      setProgress(null)
      controller.current = null
    }
  }

  const apply = () => {
    if (!result) return
    const s = getState()
    s.replaceDoc(result.built.doc, `AI show: ${result.built.doc.name}`)
    s.set({ selection: { kind: 'show' }, time: 0, focus: null })
    s.toast('Show created — Undo to go back to your previous show')
    onClose()
  }

  const preview = useMemo(() => {
    if (!result) return null
    const c = compile(result.built.doc)
    return { duration: c.duration, tiles: c.scenes.map((cs) => ({ id: cs.id, name: result.built.doc.scenes[cs.index]!.name, points: cs.points, colors: scenePointColors(cs) })) }
  }, [result])

  const busy = !!progress
  const cancel = () => controller.current?.abort()

  return (
    <Modal
      title="Generate a show"
      onClose={() => { cancel(); onClose() }}
      footer={
        result ? (
          <>
            <button className="btn" onClick={() => setResult(null)}>Back</button>
            <button className="btn" onClick={run}>Try again</button>
            <button className="btn primary" onClick={apply}>Use this show</button>
          </>
        ) : busy ? (
          <button className="btn" onClick={cancel}>Cancel</button>
        ) : (
          <>
            <button className="btn" onClick={onClose}>Close</button>
            <button className="btn ai" disabled={brief.trim().length < 8} onClick={run}><Sparkles size={14} /> Generate</button>
          </>
        )
      }
    >
      {!busy && !result && (
        <>
          <label className="field-label" htmlFor="brief" style={{ marginTop: 0 }}>Describe the show — occasion, story, colours, words, mood</label>
          <textarea id="brief" className="textarea" style={{ fontWeight: 400, minHeight: 96, letterSpacing: 0 }} value={brief} onChange={(e) => setBrief(e.target.value)} placeholder="e.g. A 2-minute show for a bakery’s 50th anniversary: warm gold, a croissant, the number 50, and their name ‘Hartmann’." autoFocus />
          <div className="chips" style={{ marginTop: 8 }}>
            {EXAMPLES.map((e) => <button key={e} className="chip" onClick={() => setBrief(e)}>{e.length > 60 ? `${e.slice(0, 58)}…` : e}</button>)}
          </div>
          <div className="row" style={{ marginTop: 14 }}>
            <label>Drones</label>
            <div style={{ width: 120 }}><NumberField value={drones} step={10} min={10} max={1000} onChange={(v) => setDrones(Math.round(v))} /></div>
          </div>
          <div className="row">
            <label>Length</label>
            <Segmented<Length>
              value={length}
              onChange={setLength}
              options={[...(hasMusic ? [{ value: 'music' as const, label: 'Fit the music' }] : [{ value: 'natural' as const, label: 'Natural' }]), { value: '60', label: '1 min' }, { value: '120', label: '2 min' }, { value: '180', label: '3 min' }, { value: '300', label: '5 min' }]}
            />
          </div>
          {hasMusic && (
            <div className="row">
              <label />
              <Toggle checked={useMusic} onChange={setUseMusic} label={`Choreograph to “${doc.audio!.name}” (${Math.round(doc.audio!.bpm)} BPM) — formations land on downbeats`} />
            </div>
          )}
          {(!hasMusic || !useMusic) && (
            <div className="row">
              <label />
              <Toggle checked={compose} onChange={setCompose} label="Compose an original score — the music builds and drops as the hero formations arrive" />
            </div>
          )}
          {!hasMusic && <p className="hint">Or load your own song first (timeline → Music) and the show will be choreographed to it.</p>}
          <p className="hint">Replaces the current show — you can undo. Every formation is sized and checked by the safety engine.</p>
          <CostMeter since={openedAt} busy={!!progress && !result && !error} />
          {error && <div className="cp-notice error" style={{ marginTop: 8 }}>{error}</div>}
        </>
      )}
      {busy && progress && (
        <div className="ai-progress">
          <div className={`step ${progress.phase === 'planning' ? 'on' : ''}`}>{progress.phase === 'planning' ? <Loader2 size={14} className="spin" /> : <Check size={14} color="var(--ok)" />} Planning scenes and lights</div>
          <div className={`step ${progress.phase === 'drawing' ? 'on' : ''}`}>{progress.phase === 'drawing' ? <Loader2 size={14} className="spin" /> : progress.phase === 'building' ? <Check size={14} color="var(--ok)" /> : <span style={{ width: 14 }} />} {progress.note ?? 'Drawing custom formations'}</div>
          <div className={`step ${progress.phase === 'building' ? 'on' : ''}`}>{progress.phase === 'building' ? <Loader2 size={14} className="spin" /> : <span style={{ width: 14 }} />} Building safely{useMusic && hasMusic ? ' and landing on the beat' : ''}</div>
          <div className="scene-chips">{progress.scenes.map((n, i) => <span key={i}>{i + 1}. {n}</span>)}</div>
          <p className="hint" style={{ marginTop: 6 }}>This usually takes under a minute.</p>
        </div>
      )}
      {result && preview && (
        <>
          <h3 style={{ margin: '0 0 4px' }}>{result.built.doc.name}</h3>
          <p style={{ margin: 0, color: 'var(--muted)' }}>{result.plan.concept}</p>
          <p className="hint" style={{ marginTop: 6 }}>
            {result.built.doc.scenes.length} scenes · {result.built.doc.cues.length} light cues · {formatTime(preview.duration)}
            {result.built.composed ? ' · with an original score' : result.built.alignedToMusic ? ` · ${result.built.alignedToMusic} formations land on downbeats` : ''}
            {result.built.fixesApplied ? ` · ${result.built.fixesApplied} automatic safety fix${result.built.fixesApplied > 1 ? 'es' : ''}` : ''}
            {result.customFailures ? ` · ${result.customFailures} custom formation${result.customFailures > 1 ? 's' : ''} failed (a placeholder sphere stands in — ask the copilot to redo ${result.customFailures > 1 ? 'them' : 'it'})` : ''}
            {result.customSkipped ? ` · ${result.customSkipped} custom formation${result.customSkipped > 1 ? 's' : ''} over the limit of 10 (placeholders — ask the copilot to create ${result.customSkipped > 1 ? 'them' : 'it'})` : ''}
          </p>
          <div className={result.built.validation.issues.length ? 'cp-notice error' : 'okbox'} style={{ marginTop: 8 }}>
            {result.built.validation.issues.length ? `${result.built.validation.issues.length} safety issue(s) need a decision after you open it.` : <><Check size={14} /> Passes every safety check.</>}
          </div>
          <div className="result-grid">
            {preview.tiles.map((t, i) => (
              <figure key={t.id}>
                <Thumb points={t.points} colors={t.colors} width={128} height={84} />
                <figcaption>{i + 1}. {t.name}</figcaption>
              </figure>
            ))}
          </div>
        </>
      )}
    </Modal>
  )
}
