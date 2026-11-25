import { useMemo, useRef, useState } from 'react'
import { findScene, sceneDroneCount } from '@/core/groups'
import { CostMeter } from './CostMeter'
import { Box, Check, Eye, Loader2, Sparkles, Wrench } from 'lucide-react'
import { attemptFrom, createModel, lookAndFix, modelShape, type ModelAttempt } from '@/ai/model3d'
import { fourViews, frontStrip } from '@/ai/render'
import { aiConfigured, describeError } from '@/ai/client'
import { sampleModel } from '@/core/model3d'
import { allocate } from '@/core/compile'
import { defaultEffect } from '@/core/effects'
import { getState, useStore } from '@/state/store'
import { addScene, setLayerShape, settleSceneParts, updateScene } from '@/state/actions'
import { Modal, Segmented } from '../components/controls'
import { SpinPreview } from './SpinPreview'
import { ApiKeyForm } from './AiSettings'

const RENDER = { views: fourViews, strip: frontStrip }

const EXAMPLES = ['an eagle flapping its wings', 'a rocket lifting off', 'a hot-air balloon', 'a trophy cup', 'a globe on a stand', 'a Christmas tree with a star', 'a whale breaching']

/** Existing model being improved (opened from the inspector), as attempt 1. */
function initialAttempts(): { attempts: ModelAttempt[]; description: string; drones: number } {
  const s = getState()
  const t = s.aiTarget
  const scene = t ? findScene(s.doc, t.sceneId)?.scene : undefined
  const li = scene ? scene.layers.findIndex((l) => l.id === t!.layerId) : -1
  const layer = scene?.layers[li]
  const drones = scene && li >= 0 ? allocate(sceneDroneCount(s.doc, scene.id), scene.layers.map((l) => l.weight))[li]! : s.doc.droneCount
  if (!layer || layer.shape.kind !== 'model') return { attempts: [], description: '', drones }
  try {
    const m = layer.shape
    return { attempts: [attemptFrom({ name: m.name, parts: m.parts, joints: m.joints, relief: m.relief }, drones, RENDER)], description: m.name, drones }
  } catch {
    return { attempts: [], description: layer.shape.name, drones }
  }
}

export function Model3DDialog({ onClose }: { onClose: () => void }) {
  const init = useMemo(initialAttempts, [])
  const target = useStore((s) => s.aiTarget)
  const selection = useStore((s) => s.selection)
  const selectedScene = useStore((s) => (s.selection.kind === 'scene' ? findScene(s.doc, (s.selection as { id: string }).id)?.scene : undefined))
  const [openedAt] = useState(() => Date.now())
  const [configured, setConfigured] = useState(aiConfigured())
  const [description, setDescription] = useState(init.description)
  const [rounds, setRounds] = useState<'0' | '1' | '2' | '3'>('2')
  const [attempts, setAttempts] = useState<ModelAttempt[]>(init.attempts)
  const [selected, setSelected] = useState(Math.max(0, init.attempts.length - 1))
  const [busy, setBusy] = useState<'generating' | 'looking' | null>(null)
  const [feedback, setFeedback] = useState('')
  const [error, setError] = useState<string | null>(null)
  const controller = useRef<AbortController | null>(null)
  const n = init.drones

  const current = attempts[selected]
  const preview = useMemo(() => (current ? sampleModel(current.parts, n, { relief: current.relief }) : null), [current, n])
  const close = () => { controller.current?.abort(); getState().set({ aiTarget: null }); onClose() }

  const create = async () => {
    setError(null)
    controller.current = new AbortController()
    try {
      await createModel(description, {
        n,
        rounds: Number(rounds),
        render: RENDER,
        signal: controller.current.signal,
        onUpdate: (a, b) => { setAttempts(a); setSelected(Math.max(0, a.length - 1)); setBusy(b) },
      })
    } catch (err) {
      setError(describeError(err))
    } finally {
      setBusy(null)
      controller.current = null
    }
  }

  const fix = async (withFeedback: boolean) => {
    if (!current) return
    setError(null)
    setBusy('looking')
    controller.current = new AbortController()
    try {
      const { critique, next } = await lookAndFix(description || current.name, current, n, RENDER, { feedback: withFeedback ? feedback : undefined, signal: controller.current.signal })
      const updated = attempts.slice(0, selected + 1).map((a, i) => (i === selected ? { ...a, critique, verdict: next ? ('fixed' as const) : ('good' as const), feedback: withFeedback ? feedback : undefined } : a))
      if (next) updated.push(next)
      setAttempts(updated)
      setSelected(updated.length - 1)
      setFeedback('')
    } catch (err) {
      setError(describeError(err))
    } finally {
      setBusy(null)
      controller.current = null
    }
  }

  const replaceId = target?.sceneId ?? (selection.kind === 'scene' ? selectedScene?.id : undefined)
  const replaceScene = replaceId ? findScene(getState().doc, replaceId)?.scene : undefined

  const add = () => {
    if (!current) return
    const scene = addScene('model', { shape: modelShape(current), name: current.name })
    if (scene && current.joints?.length) settleSceneParts(scene.id)
    getState().toast(`Added “${current.name}”`)
    close()
  }

  const replace = () => {
    if (!current || !replaceScene) return
    const layer = replaceScene.layers.find((l) => l.id === target?.layerId) ?? replaceScene.layers[0]!
    const wasModel = layer.shape.kind === 'model'
    setLayerShape(replaceScene.id, layer.id, { ...modelShape(current), size: layer.shape.size }, `3D model: ${current.name}`)
    if (current.joints?.length) settleSceneParts(replaceScene.id)
    if (!wasModel) updateScene(replaceScene.id, (s) => { const l = s.layers.find((x) => x.id === layer.id); if (l) l.effect = defaultEffect('image') }, 'Shape colours')
    getState().toast(`“${replaceScene.name}” is now ${current.name}`)
    close()
  }

  return (
    <Modal
      wide
      title={target ? 'Improve 3D model' : 'Create a 3D model'}
      onClose={close}
      footer={
        <>
          <button className="btn" onClick={close}>Close</button>
          {busy && <button className="btn" onClick={() => controller.current?.abort()}>Stop</button>}
          {current && replaceScene && !busy && <button className={target ? 'btn primary' : 'btn'} onClick={replace}>{target ? 'Apply to scene' : `Replace “${replaceScene.name}”`}</button>}
          {current && !target && !busy && <button className="btn primary" onClick={add}>Add as new scene</button>}
        </>
      }
    >
      {!configured ? (
        <div className="ai-setup" style={{ margin: 0 }}>
          <h3>Connect Claude</h3>
          <ApiKeyForm compact onSaved={() => setConfigured(true)} />
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input className="text-input" style={{ height: 32 }} aria-label="What 3D object should the drones form?" placeholder="e.g. a hot-air balloon with a basket" value={description} autoFocus onChange={(e) => setDescription(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && description.trim() && !busy && create()} />
            <button className="btn ai" style={{ height: 32 }} disabled={!description.trim() || !!busy} onClick={create}><Box size={14} /> {attempts.length ? 'Start over' : 'Build'}</button>
          </div>
          <div className="row" style={{ marginTop: 6 }}>
            <label style={{ width: 'auto' }} title="After building, Claude looks at the drones from four angles and fixes what doesn’t read">Look & fix rounds</label>
            <Segmented value={rounds} onChange={setRounds} options={[{ value: '0', label: 'None' }, { value: '1', label: '1' }, { value: '2', label: '2' }, { value: '3', label: '3' }]} />
            <span className="hint">{n} drones</span>
          </div>
          {!attempts.length && !busy && (
            <div className="chips">{EXAMPLES.map((e) => <button key={e} className="chip" onClick={() => setDescription(e)}>{e}</button>)}</div>
          )}
          <CostMeter since={openedAt} busy={!!busy} />
          {error && <div className="cp-notice error" style={{ marginTop: 10 }}>{error}</div>}
          {(attempts.length > 0 || busy) && (
            <div className="m3d">
              <div className="m3d-attempts">
                {attempts.map((a, i) => (
                  <button key={i} className={`m3d-attempt${i === selected ? ' on' : ''}`} onClick={() => setSelected(i)}>
                    <img alt={`Attempt ${i + 1}: ${a.name} from four angles`} src={`data:image/png;base64,${a.image}`} />
                    <div className="m3d-meta">
                      <b>{i + 1}. {a.name}</b> <span className="hint">{a.parts.length} parts</span>
                      {a.feedback && <div className="hint">You: {a.feedback}</div>}
                      {a.critique && (
                        <div className={a.verdict === 'good' ? 'hint ok' : 'hint'}>
                          {a.verdict === 'good' ? <Check size={11} /> : <Wrench size={11} />} {a.critique}
                        </div>
                      )}
                      {a.hiddenParts.length > 0 && <div className="hint err">{a.hiddenParts.length} part{a.hiddenParts.length > 1 ? 's' : ''} hidden inside others</div>}
                    </div>
                  </button>
                ))}
                {busy && (
                  <div className="m3d-busy"><Loader2 size={14} className="spin" /> {busy === 'generating' ? 'Building the model…' : 'Looking at the drones from four angles…'}</div>
                )}
              </div>
              <div className="m3d-side">
                {preview ? <SpinPreview points={preview.points} colors={preview.colors} /> : <div className="m3d-empty"><Loader2 size={16} className="spin" /></div>}
                {current?.motion && <img className="m3d-motion" alt={`${current.name}: moving parts at rest and at both ends of the motion`} src={`data:image/png;base64,${current.motion}`} />}
                {current && (
                  <>
                    <label className="field-label" htmlFor="m3d-feedback">Tell Claude what to change</label>
                    <textarea id="m3d-feedback" className="textarea" style={{ fontWeight: 400, minHeight: 56, letterSpacing: 0 }} placeholder="e.g. bigger flame, add a window, make it taller" value={feedback} onChange={(e) => setFeedback(e.target.value)} />
                    <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                      <button className="btn ai sm" disabled={!!busy || !feedback.trim()} onClick={() => fix(true)}><Sparkles size={12} /> Fix</button>
                      <button className="btn sm" disabled={!!busy} onClick={() => fix(false)} title="Claude looks at the drones again and fixes anything that doesn’t read"><Eye size={12} /> Look & fix again</button>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </Modal>
  )
}
