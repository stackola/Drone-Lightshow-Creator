// Picture to drones: describe → Claude writes the picture description →
// an image model draws it as glowing line art → traced into drones at any
// count → Claude compares and fixes. Every stage can be re-run on its own:
// the drone count and detail re-trace instantly from the kept picture.

import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, ImagePlus, Loader2, RefreshCw, Sparkles, Upload, Wrench } from 'lucide-react'
import { findScene, sceneDroneCount } from '@/core/groups'
import { generateShape } from '@/core/shapes'
import { defaultEffect } from '@/core/effects'
import type { DrawingStyle, PictureSource } from '@/core/types'
import { aiConfigured, describeError } from '@/ai/client'
import { imagesConfigured } from '@/ai/openai'
import { compactPicture, createPicture, describeFit, expandPrompt, newPicture, pictureFit, reviewPicture, thresholdFor, traceSource, type PictureAttempt } from '@/ai/picture'
import { dronesPng } from '@/ai/render'
import { getState, useStore } from '@/state/store'
import { addPictureScene, setLayerShape, updateScene } from '@/state/actions'
import { pickFile } from '@/state/persist'
import { Modal, NumberField, Row, Segmented, Toggle } from '../components/controls'
import { ApiKeyForm, ImageKeyForm } from './AiSettings'

const EXAMPLES = ['bride and groom dancing', 'a bridal bouquet of roses', 'a champagne bottle popping', 'a phoenix rising', 'a lighthouse with beams', 'a dragon']

type Busy = 'writing' | 'drawing' | 'looking' | 'tracing' | null

/** The picture formation being improved (opened from the inspector), if any. */
function initial(): { attempt: PictureAttempt | null; drones: number } {
  const s = getState()
  const t = s.aiTarget
  const scene = t ? findScene(s.doc, t.sceneId)?.scene : undefined
  const layer = scene?.layers.find((l) => l.id === t?.layerId)
  const drones = scene ? sceneDroneCount(s.doc, scene.id) : s.doc.droneCount
  if (layer?.shape.kind === 'image' && layer.shape.picture) return { attempt: { name: layer.shape.name, source: layer.shape.picture, shape: layer.shape }, drones }
  return { attempt: null, drones }
}

export function PictureDialog({ onClose }: { onClose: () => void }) {
  const init = useMemo(initial, [])
  const target = useStore((s) => s.aiTarget)
  const showDrones = useStore((s) => s.doc.droneCount)
  const selectedScene = useStore((s) => (s.selection.kind === 'scene' ? findScene(s.doc, (s.selection as { id: string }).id)?.scene : undefined))
  const [claude, setClaude] = useState(aiConfigured())
  const [images, setImages] = useState(imagesConfigured())
  const [description, setDescription] = useState(init.attempt?.source.prompt.slice(0, 80) ?? '')
  const [drones, setDrones] = useState(init.drones)
  const [attempts, setAttempts] = useState<PictureAttempt[]>(init.attempt ? [init.attempt] : [])
  const [selected, setSelected] = useState(0)
  const [prompt, setPrompt] = useState(init.attempt?.source.prompt ?? '')
  const [busy, setBusy] = useState<Busy>(null)
  const [error, setError] = useState<string | null>(null)
  const controller = useRef<AbortController | null>(null)
  const current = attempts[selected]

  useEffect(() => { if (current) setPrompt(current.source.prompt) }, [current?.source.prompt]) // eslint-disable-line react-hooks/exhaustive-deps

  // Drones at the chosen count: instant, from the traced picture.
  const preview = useMemo(() => {
    if (!current) return null
    const g = generateShape({ ...current.shape, size: 10 }, Math.max(20, drones))
    return dronesPng(g.points, g.colors, 520)
  }, [current, drones])
  const limits = useStore((s) => s.doc.limits)
  const fit = useMemo(() => (current ? pictureFit(current.shape, Math.max(20, drones), limits) : null), [current, drones, limits])

  const run = async (f: (signal: AbortSignal) => Promise<void>) => {
    setError(null)
    controller.current = new AbortController()
    try { await f(controller.current.signal) } catch (err) {
      if ((err as Error).name !== 'AbortError') setError(describeError(err))
    } finally { setBusy(null); controller.current = null }
  }

  const create = () => run(async (signal) => {
    const out = await createPicture(description, { n: drones, rounds: 1, limits: getState().doc.limits, signal, onUpdate: (a, b) => { setAttempts(a); setSelected(Math.max(0, a.length - 1)); setBusy(b) } })
    setAttempts(out)
    setSelected(out.length - 1)
  })

  /** A new picture from the (edited) description, keeping everything else. */
  const redraw = () => run(async (signal) => {
    setBusy('drawing')
    const next = await newPicture(current?.name ?? description, prompt, drones, current?.source.detail ?? 0.6, signal, current?.source.format ?? 'square')
    setAttempts((a) => [...a, next])
    setSelected(attempts.length)
  })

  const expandOnly = () => run(async (signal) => {
    setBusy('writing')
    const e = await expandPrompt(description, drones, signal)
    setPrompt(e.prompt)
    if (current) setAttempts((a) => a.map((x, i) => (i === selected ? { ...x, source: { ...x.source, format: e.format } } : x)))
  })

  /** Re-trace the current picture with new settings (no new picture). */
  const retrace = (patch: Partial<PictureSource>) => {
    if (!current) return
    const source = { ...current.source, ...patch }
    setBusy('tracing')
    void traceSource(source, current.name).then((traced) => {
      const shape = { ...traced, ...(current.shape.style ? { style: current.shape.style } : {}) }
      setAttempts((a) => a.map((x, i) => (i === selected ? { ...x, source, shape, critique: undefined, verdict: undefined } : x)))
      setBusy(null)
    }, (err) => { setError(describeError(err)); setBusy(null) })
  }

  const lookAndFix = () => run(async (signal) => {
    if (!current) return
    setBusy('looking')
    const r = await reviewPicture(description || current.name, current, drones, signal, getState().doc.limits)
    const marked = attempts.map((x, i) => (i === selected ? { ...x, critique: r.critique, verdict: r.done ? ('good' as const) : r.new_picture ? ('redrawn' as const) : ('adjusted' as const) } : x))
    setAttempts(marked)
    if (r.done || (!r.new_picture && r.detail === undefined && r.sensitivity === undefined && !r.style)) return
    if (r.new_picture?.trim()) {
      setBusy('drawing')
      const next = await newPicture(current.name, r.new_picture, drones, r.detail ?? current.source.detail, signal, r.format ?? current.source.format ?? 'square')
      setAttempts([...marked, next])
      setSelected(marked.length)
      return
    }
    const source = { ...current.source, detail: r.detail ?? current.source.detail, threshold: r.sensitivity === undefined ? current.source.threshold : thresholdFor(r.sensitivity) }
    const traced = await traceSource(source, current.name)
    const style = r.style ?? current.shape.style
    const next = { name: current.name, source, shape: { ...traced, ...(style ? { style } : {}) } }
    setAttempts([...marked, next])
    setSelected(marked.length)
  })

  const upload = async () => {
    const f = await pickFile('image/*')
    if (!f) return
    void run(async () => {
      setBusy('tracing')
      const url = await new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => rej(new Error('Could not read that image.')); r.readAsDataURL(f) })
      const source: PictureSource = { prompt: f.name.replace(/\.[^.]+$/, ''), image: await compactPicture(url), detail: 0.6, threshold: null }
      const next = { name: source.prompt.slice(0, 40), source, shape: await traceSource(source, source.prompt) }
      setAttempts((a) => [...a, next])
      setSelected(attempts.length)
    })
  }

  const close = () => { controller.current?.abort(); getState().set({ aiTarget: null }); onClose() }

  const replaceId = target?.sceneId ?? selectedScene?.id
  const replaceScene = replaceId ? findScene(getState().doc, replaceId)?.scene : undefined

  const add = () => {
    if (!current) return
    const grew = drones > showDrones
    addPictureScene({ ...current.shape, size: 40 }, current.name, drones)
    getState().toast(grew ? `Added “${current.name}”. The show now has ${drones} drones — use Fix to resize the other formations.` : `Added “${current.name}” (${drones} drones)`)
    close()
  }
  const replace = () => {
    if (!current || !replaceScene) return
    const layer = replaceScene.layers.find((l) => l.id === target?.layerId) ?? replaceScene.layers[0]!
    setLayerShape(replaceScene.id, layer.id, { ...current.shape, size: layer.shape.size }, `Picture: ${current.name}`)
    updateScene(replaceScene.id, (s) => { const l = s.layers.find((x) => x.id === layer.id); if (l) l.effect = defaultEffect('image') }, 'Picture colours')
    getState().toast(`“${replaceScene.name}” is now ${current.name}`)
    close()
  }

  const sensitivity = current?.source.threshold === null || current?.source.threshold === undefined ? null : Math.round(((0.7 - current.source.threshold) / 0.6) * 100) / 100
  const busyText: Record<Exclude<Busy, null>, string> = { writing: 'Claude is writing the picture description…', drawing: 'Drawing the picture (about 45 s)…', looking: 'Claude is comparing the drones with the picture…', tracing: 'Tracing…' }

  return (
    <Modal
      wide
      title={target ? 'Picture studio' : 'Picture to drones'}
      onClose={close}
      footer={
        <>
          <button className="btn" onClick={close}>Close</button>
          {busy && busy !== 'tracing' && <button className="btn" onClick={() => controller.current?.abort()}>Stop</button>}
          {current && replaceScene && !busy && <button className={target ? 'btn primary' : 'btn'} onClick={replace}>{target ? 'Apply to scene' : `Replace “${replaceScene.name}”`}</button>}
          {current && !target && !busy && (
            <button className="btn primary" onClick={add} title={drones > showDrones ? `The show grows to ${drones} drones` : drones < showDrones ? `The other ${showDrones - drones} drones wait dark behind it` : undefined}>
              Add as new scene{drones !== showDrones ? ` (${drones} drones)` : ''}
            </button>
          )}
        </>
      }
    >
      {!claude || !images ? (
        <div className="ai-setup" style={{ margin: 0 }}>
          {!claude && (<><h3>Connect Claude</h3><ApiKeyForm compact onSaved={() => setClaude(aiConfigured())} /></>)}
          {!images && (<><h3 style={{ marginTop: claude ? 0 : 16 }}>Connect an image model</h3><ImageKeyForm compact onSaved={() => setImages(imagesConfigured())} /></>)}
          {claude && !images && <button className="btn ghost sm" style={{ marginTop: 8 }} onClick={() => setImages(true)}>Skip — I’ll use my own pictures</button>}
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input className="text-input" style={{ height: 32 }} aria-label="What should the drones show?" placeholder="e.g. bride and groom dancing" value={description} autoFocus onChange={(e) => setDescription(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && description.trim() && !busy && create()} />
            <div style={{ width: 120 }}><NumberField value={drones} step={50} min={20} max={2000} unit="drones" precision={0} title="Drones in this formation" onChange={(v) => setDrones(Math.round(v))} /></div>
            <button className="btn ai" style={{ height: 32 }} disabled={!description.trim() || !!busy || !imagesConfigured()} onClick={create}><Sparkles size={14} /> {attempts.length ? 'New' : 'Create'}</button>
            <button className="btn" style={{ height: 32 }} disabled={!!busy} onClick={upload} title="Trace your own picture: bright lines on a dark background work best"><Upload size={14} /></button>
          </div>
          {!attempts.length && !busy && <div className="chips">{EXAMPLES.map((e) => <button key={e} className="chip" onClick={() => setDescription(e)}>{e}</button>)}</div>}
          {error && <div className="cp-notice error" style={{ marginTop: 10 }}>{error}</div>}
          {busy && busy !== 'tracing' && <p className="hint" style={{ marginTop: 10 }}><Loader2 size={12} className="spin" /> {busyText[busy]}</p>}
          {current && (
            <div className="pic-studio">
              <div className="pic-pair">
                <figure>
                  <img alt={`Picture of ${current.name}`} src={current.source.image} />
                  <figcaption>The picture</figcaption>
                </figure>
                <figure>
                  {preview && <img alt={`${current.name} as ${drones} drones`} src={`data:image/png;base64,${preview}`} />}
                  <figcaption>As {drones} drones{busy === 'tracing' ? ' · tracing…' : ''}</figcaption>
                </figure>
              </div>
              <div className="pic-controls">
                <Row label="Drones" title="Change the count to see it with more or fewer drones — nothing is redrawn">
                  <input type="range" min={50} max={2000} step={10} value={drones} aria-label="Drones" onChange={(e) => setDrones(Number(e.target.value))} style={{ flex: 1 }} />
                  <span className="hint" style={{ width: 44, textAlign: 'right' }}>{drones}</span>
                </Row>
                <Row label="Style" title="Lines: every line of the picture is a line of drones. Filled: drones spread over the whole figure. Adaptive: lines while they fit the sky, a filled silhouette when there are more drones than the lines can hold.">
                  <Segmented full value={current.shape.style ?? 'lines'} onChange={(style: DrawingStyle) => setAttempts((a) => a.map((x, i) => (i === selected ? { ...x, shape: { ...x.shape, style } } : x)))} options={[{ value: 'lines', label: 'Lines' }, { value: 'filled', label: 'Filled' }, { value: 'adaptive', label: 'Adaptive' }]} />
                </Row>
                <Row label="Detail" title="Lower: fewer, bolder lines. Higher: more of the picture’s lines (lines that would blur together at this drone count are always left out).">
                  <input type="range" min={0} max={1} step={0.05} value={current.source.detail} aria-label="Detail" onChange={(e) => retrace({ detail: Number(e.target.value) })} style={{ flex: 1 }} />
                  <span className="hint" style={{ width: 44, textAlign: 'right' }}>{Math.round(current.source.detail * 100)}%</span>
                </Row>
                <Row label="Faint lines" title="How faint a line can be and still count">
                  <Toggle checked={sensitivity === null} onChange={(auto) => retrace({ threshold: auto ? null : thresholdFor(0.5) })} label="Automatic" />
                  {sensitivity !== null && <input type="range" min={0} max={1} step={0.05} value={sensitivity} aria-label="Line sensitivity" onChange={(e) => retrace({ threshold: thresholdFor(Number(e.target.value)) })} style={{ flex: 1 }} />}
                </Row>
                {fit && <p className={`hint ${fit.fits ? 'ok' : 'err'}`}>{describeFit(fit, drones)}</p>}
                {fit && !fit.fits && (
                  <div className="pic-actions">
                    <button className="btn sm" onClick={() => setDrones(fit.maxDrones)}>Use {fit.maxDrones} drones</button>
                    {(current.shape.style ?? 'lines') !== 'filled' && <button className="btn sm" onClick={() => setAttempts((a) => a.map((x, i) => (i === selected ? { ...x, shape: { ...x.shape, style: 'filled' } } : x)))}>Fill it</button>}
                    {(current.shape.style ?? 'lines') === 'lines' && <button className="btn ghost sm" onClick={() => setAttempts((a) => a.map((x, i) => (i === selected ? { ...x, shape: { ...x.shape, style: 'adaptive' } } : x)))}>Adaptive</button>}
                  </div>
                )}
                <div className="pic-actions">
                  <button className="btn ai sm" disabled={!!busy} onClick={lookAndFix}><Wrench size={12} /> Look &amp; fix</button>
                </div>
                {current.critique && (
                  <p className={`hint ${current.verdict === 'good' ? 'ok' : ''}`}>{current.verdict === 'good' ? <Check size={11} /> : <Wrench size={11} />} {current.critique}</p>
                )}
                <label className="field-label" htmlFor="pic-prompt">Picture description</label>
                <textarea id="pic-prompt" className="textarea" rows={5} value={prompt} onChange={(e) => setPrompt(e.target.value)} />
                <div className="pic-actions">
                  <button className="btn sm" disabled={!!busy || !prompt.trim() || !imagesConfigured()} onClick={redraw}><RefreshCw size={12} /> New picture from this</button>
                  <button className="btn ghost sm" disabled={!!busy || !description.trim()} onClick={expandOnly} title="Claude rewrites the description from your words"><Sparkles size={12} /> Rewrite</button>
                </div>
              </div>
            </div>
          )}
          {attempts.length > 1 && (
            <div className="pic-history" aria-label="Versions">
              {attempts.map((a, i) => (
                <button key={i} className={`pic-thumb${i === selected ? ' on' : ''}`} onClick={() => setSelected(i)} title={a.critique ?? a.source.prompt}>
                  <img alt={`Version ${i + 1}`} src={a.source.image} />
                  <span>{i + 1}{a.verdict === 'good' ? ' ✓' : ''}</span>
                </button>
              ))}
            </div>
          )}
          {!attempts.length && !busy && <p className="hint" style={{ marginTop: 10 }}><ImagePlus size={12} /> Claude writes a picture description from your words, an image model draws it as glowing line art, and every line becomes a line of drones. Change the drone count, detail or description and re-run just that step.</p>}
        </>
      )}
    </Modal>
  )
}
