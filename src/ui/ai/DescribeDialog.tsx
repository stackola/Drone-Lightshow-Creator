import { useMemo, useRef, useState } from 'react'
import { Loader2, Sparkles } from 'lucide-react'
import { drawFormation, formationFromSvg, type DrawnFormation } from '@/ai/shapeGen'
import { shapePreview } from '@/ai/render'
import { describeError } from '@/ai/client'
import { generateShape } from '@/core/shapes'
import type { ShapeSpec } from '@/core/types'
import { getState, useStore } from '@/state/store'
import { addScene, setLayerShape, updateScene } from '@/state/actions'
import { defaultEffect } from '@/core/effects'
import { Modal } from '../components/controls'
import { Thumb } from '../components/Thumb'

const EXAMPLES = ['a rocket taking off', 'a dolphin jumping', 'the Eiffel Tower', 'a coffee cup with steam', 'a lightning bolt', 'two interlocking rings']

export function DescribeDialog({ onClose }: { onClose: () => void }) {
  const n = useStore((s) => s.doc.droneCount)
  const selection = useStore((s) => s.selection)
  const selectedScene = useStore((s) => (s.selection.kind === 'scene' ? s.doc.scenes.find((x) => x.id === (s.selection as { id: string }).id) : undefined))
  const [description, setDescription] = useState('')
  const [feedback, setFeedback] = useState('')
  const [drawn, setDrawn] = useState<DrawnFormation | null>(null)
  const [shape, setShape] = useState<Extract<ShapeSpec, { kind: 'image' }> | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const controller = useRef<AbortController | null>(null)

  const dots = useMemo(() => (shape ? generateShape({ ...shape, size: 10 }, n) : null), [shape, n])

  const run = async (refine: boolean) => {
    setBusy(true)
    setError(null)
    controller.current = new AbortController()
    try {
      const previewPng = refine && dots ? shapePreview(dots.points, dots.colors, drawn?.name ?? '') : undefined
      const next = await drawFormation(description, refine && drawn ? { previous: drawn, feedback, previewPng, signal: controller.current.signal } : { signal: controller.current.signal })
      const sh = await formationFromSvg(next)
      setDrawn(next)
      setShape(sh)
      setFeedback('')
    } catch (err) {
      setError(describeError(err))
    } finally {
      setBusy(false)
      controller.current = null
    }
  }

  const addNew = () => {
    if (!shape || !drawn) return
    addScene('image', { shape, name: drawn.name })
    getState().toast(`Added “${drawn.name}”`)
    onClose()
  }

  const replace = () => {
    if (!shape || !drawn || !selectedScene) return
    const layer = selectedScene.layers[0]!
    setLayerShape(selectedScene.id, layer.id, shape, `Draw ${drawn.name}`)
    updateScene(selectedScene.id, (s) => { s.layers[0]!.effect = defaultEffect('image') }, 'Image colours')
    getState().toast(`“${selectedScene.name}” is now ${drawn.name}`)
    onClose()
  }

  return (
    <Modal
      title="Describe a formation"
      onClose={() => { controller.current?.abort(); onClose() }}
      footer={
        <>
          <button className="btn" onClick={onClose}>Close</button>
          {shape && selection.kind === 'scene' && selectedScene && <button className="btn" onClick={replace} disabled={busy}>Replace “{selectedScene.name}”</button>}
          {shape && <button className="btn primary" onClick={addNew} disabled={busy}>Add as new scene</button>}
        </>
      }
    >
      <label className="field-label" htmlFor="describe" style={{ marginTop: 0 }}>What should the drones draw?</label>
      <div style={{ display: 'flex', gap: 6 }}>
        <input id="describe" className="text-input" style={{ height: 32 }} value={description} placeholder="e.g. a hot-air balloon" autoFocus onChange={(e) => setDescription(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && description.trim() && !busy && run(false)} />
        <button className="btn ai" style={{ height: 32 }} disabled={!description.trim() || busy} onClick={() => run(false)}>{busy && !shape ? <Loader2 size={14} className="spin" /> : <Sparkles size={14} />} {shape ? 'New drawing' : 'Draw'}</button>
      </div>
      {!shape && (
        <div className="chips">
          {EXAMPLES.map((e) => <button key={e} className="chip" onClick={() => setDescription(e)}>{e}</button>)}
        </div>
      )}
      {error && <div className="cp-notice error" style={{ marginTop: 10 }}>{error}</div>}
      {busy && !shape && <p className="hint" style={{ marginTop: 10 }}>Drawing… this takes a few seconds.</p>}
      {shape && drawn && dots && (
        <>
          <div className="describe-previews">
            <figure>
              <img alt={`Drawing of ${drawn.name}`} src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(drawn.svg)}`} />
              <figcaption>The drawing</figcaption>
            </figure>
            <figure>
              <Thumb points={dots.points} colors={dots.colors} width={220} height={220} />
              <figcaption>As {n} drones</figcaption>
            </figure>
          </div>
          <label className="field-label" htmlFor="feedback">Not quite right? Say what to change</label>
          <div style={{ display: 'flex', gap: 6 }}>
            <input id="feedback" className="text-input" style={{ height: 32 }} value={feedback} placeholder="e.g. make the flame bigger, point it up and to the right" onChange={(e) => setFeedback(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && !busy && run(true)} />
            <button className="btn" style={{ height: 32 }} disabled={busy} onClick={() => run(true)}>{busy ? <Loader2 size={14} className="spin" /> : null} Refine</button>
          </div>
          <p className="hint">Refining shows Claude how the drawing came out as drones, so it can fix what doesn’t read.</p>
        </>
      )}
    </Modal>
  )
}
