import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Music, Pause, Play, Plus, Repeat, Magnet, ZoomIn, ZoomOut, Maximize2, AlertTriangle, X, Drum, Sparkle, Wand2 } from 'lucide-react'
import { alignScenesToBars, songAccents, songSections } from '@/core/music'
import { MUSIC_TAG, composeScore, fitToSong, lightTheMusic, type LightingStyle } from '@/core/musicTools'
import { SECTION_COLORS } from '@/core/sections'
import { getState, useStore } from '@/state/store'
import { pause, play, seek, setRate, togglePlay } from '@/state/playback'
import { CUE_PRESETS, addCue, focusIssue, seekToScene, stepScene, updateCue, updateScene } from '@/state/actions'
import { effectSwatch } from '@/core/effects'
import { ceilTo } from '@/core/math'
import { formatTime } from '@/core/validate'
import { loadMusic, pickFile, removeMusic } from '@/state/persist'
import { MenuButton } from '@/ui/components/controls'
import { TRANSITIONS } from '@/core/transitions'
import type { HoldKey, Scene } from '@/core/types'

const trLabel = (k: string) => TRANSITIONS.find((x) => x.kind === k)?.label ?? k

const PAD = 14
const LANES = { ruler: 24, scenes: 46, lights: 34, music: 58 }

function fmtTime(t: number) {
  const m = Math.floor(t / 60)
  const s = t - m * 60
  return `${m}:${s.toFixed(1).padStart(4, '0')}`
}

/** Colour used for a scene block: the first visible layer's base look. */
function sceneColor(scene: Scene): string {
  const e = scene.layers.find((l) => l.effect.kind !== 'off')?.effect ?? scene.layers[0]?.effect
  if (!e) return '#2a3550'
  const sw = effectSwatch(e)
  return sw.startsWith('#') ? sw : sw
}

export function Timeline() {
  const compiled = useStore((s) => s.compiled)
  const doc = useStore((s) => s.doc)
  const selection = useStore((s) => s.selection)
  const validation = useStore((s) => s.validation)
  const snap = useStore((s) => s.snap)
  const loop = useStore((s) => s.loop)
  const rate = useStore((s) => s.rate)
  const playing = useStore((s) => s.playing)
  const audio = useStore((s) => s.audio)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(800)
  const [zoom, setZoom] = useState<number | null>(null) // px per second; null = fit

  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.observe(el)
    setWidth(el.clientWidth)
    return () => ro.disconnect()
  }, [])

  const duration = Math.max(compiled?.duration ?? 30, doc.audio ? doc.audio.offset + doc.audio.duration : 0)
  const fit = Math.max(0.5, (width - PAD * 2 - 8) / Math.max(1, duration))
  const pps = zoom ?? fit
  const toX = useCallback((t: number) => PAD + t * pps, [pps])
  const toT = useCallback((x: number) => (x - PAD) / pps, [pps])
  const contentW = Math.max(width, toX(duration) + PAD + 40)

  const beats = useMemo(() => compiled?.beats ?? [], [compiled])
  const downbeat = compiled?.downbeat ?? 0

  /** Snap a time to the nearest beat (if music) or 0.1 s. Alt disables snapping. */
  const snapT = useCallback(
    (t: number, alt: boolean) => {
      if (snap && !alt && beats.length) {
        let best = t, bd = Infinity
        let lo = 0, hi = beats.length - 1
        while (lo < hi) {
          const mid = (lo + hi) >> 1
          if (beats[mid]! < t) lo = mid + 1
          else hi = mid
        }
        for (const i of [lo - 1, lo]) {
          const b = beats[i]
          if (b !== undefined && Math.abs(b - t) < bd) { bd = Math.abs(b - t); best = b }
        }
        if (bd * pps < 14) return best
      }
      return Math.round(t * 10) / 10
    },
    [snap, beats, pps],
  )

  // Ctrl/Cmd + wheel zoom around the pointer.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      const x = e.clientX - rect.left + el.scrollLeft
      const t = toT(x)
      const next = Math.max(fit, Math.min(400, pps * Math.exp(-e.deltaY * 0.0025)))
      setZoom(next <= fit * 1.001 ? null : next)
      requestAnimationFrame(() => {
        el.scrollLeft = PAD + t * next - (e.clientX - rect.left)
      })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [pps, fit, toT])

  // Generic drag helper.
  const drag = (e: React.PointerEvent, onMove: (t: number, ev: PointerEvent, dx: number) => void, onClick?: () => void) => {
    e.stopPropagation()
    e.preventDefault()
    const el = e.currentTarget as HTMLElement
    el.setPointerCapture(e.pointerId)
    const startX = e.clientX
    const rect = scrollRef.current!.getBoundingClientRect()
    let moved = false
    const move = (ev: PointerEvent) => {
      if (!moved && Math.abs(ev.clientX - startX) < 3) return
      moved = true
      const x = ev.clientX - rect.left + scrollRef.current!.scrollLeft
      onMove(toT(x), ev, (ev.clientX - startX) / pps)
    }
    const up = () => {
      el.removeEventListener('pointermove', move)
      if (!moved) onClick?.()
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up, { once: true })
  }

  const scrub = (e: React.PointerEvent) => {
    const rect = scrollRef.current!.getBoundingClientRect()
    const at = (clientX: number) => toT(clientX - rect.left + scrollRef.current!.scrollLeft)
    const wasPlaying = getState().playing
    if (wasPlaying) pause()
    seek(at(e.clientX))
    const el = e.currentTarget as HTMLElement
    el.setPointerCapture(e.pointerId)
    const move = (ev: PointerEvent) => seek(at(ev.clientX))
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', () => {
      el.removeEventListener('pointermove', move)
      if (wasPlaying) play()
    }, { once: true })
  }

  const issueScenes = useMemo(() => new Set(validation?.issues.map((i) => i.sceneId).filter(Boolean)), [validation])

  // Ruler ticks
  const ticks = useMemo(() => {
    const steps = [0.5, 1, 2, 5, 10, 15, 30, 60, 120]
    const step = steps.find((s) => s * pps >= 64) ?? 120
    const out: number[] = []
    for (let t = 0; t <= duration + 1e-6; t += step) out.push(Math.round(t * 100) / 100)
    return out
  }, [pps, duration])

  const blocks: JSX.Element[] = []
  if (compiled) {
    const st = compiled.sceneTimes
    const seg0 = compiled.takeoff
    blocks.push(
      <div key="to" className={`blk ground${selection.kind === 'takeoff' ? ' sel' : ''}`} style={{ left: toX(seg0.t0), width: Math.max(2, (seg0.t1 - seg0.t0) * pps - 2) }} onClick={() => { getState().select({ kind: 'takeoff' }); seek(0) }} title="Takeoff">
        {(seg0.t1 - seg0.t0) * pps > 60 ? 'Takeoff' : ''}
      </div>,
    )
    doc.scenes.forEach((scene, i) => {
      const t = st[i]
      if (!t || t.id !== scene.id) return
      const fw = (t.holdStart - t.flightStart) * pps
      const selF = selection.kind === 'flight' && selection.id === scene.id
      blocks.push(
        <div
          key={`f-${scene.id}`}
          className={`blk flight${t.extended ? ' ext' : ''}${t.detour ? ' detour' : ''}${t.transition.used !== 'direct' ? ' styled' : ''}${selF ? ' sel' : ''}`}
          style={{ left: toX(t.flightStart) + 1, width: Math.max(2, fw - 3) }}
          title={`Flight into ${scene.name}: ${(t.holdStart - t.flightStart).toFixed(1)} s${t.auto ? ' (auto)' : ''} · fastest safe ${t.minFlight.toFixed(1)} s${t.extended ? ' — extended for safety' : ''}${t.detour ? ' · collision-free detour (spread, cross, close in)' : ''}${t.transition.used !== 'direct' ? ` · ${trLabel(t.transition.used)} transition` : ''}${t.transition.note ? ` — ${t.transition.note}` : ''}`}
          onClick={() => getState().select({ kind: 'flight', id: scene.id })}
        >
          {fw > 44 ? `${t.transition.used !== 'direct' && fw > 90 ? `${trLabel(t.transition.used)} ` : ''}${(t.holdStart - t.flightStart).toFixed(1)}s` : ''}
          <div
            className="grip r"
            onPointerDown={(e) =>
              drag(e, (tt, ev) => {
                const min = ceilTo(t.minFlight, 0.1)
                const dur = Math.max(min, snapT(tt, ev.altKey) - t.flightStart)
                updateScene(scene.id, (s) => { s.flight.duration = Math.round(dur * 100) / 100 }, 'Flight duration', `flight:${scene.id}`)
              }, () => getState().select({ kind: 'flight', id: scene.id }))
            }
          />
        </div>,
      )
      const hw = (t.holdEnd - t.holdStart) * pps
      const sel = selection.kind === 'scene' && selection.id === scene.id
      blocks.push(
        <div
          key={`h-${scene.id}`}
          className={`blk hold${sel ? ' sel' : ''}`}
          style={{ left: toX(t.holdStart), width: Math.max(4, hw), ['--c' as string]: sceneColor(scene) }}
          title={`${scene.name} · ${fmtTime(t.holdStart)}–${fmtTime(t.holdEnd)}`}
          onPointerDown={(e) => drag(e, () => {}, () => { getState().select({ kind: 'scene', id: scene.id }); seekToScene(scene.id) })}
        >
          {issueScenes.has(scene.id) && <span className="err-dot" />}
          {hw > 50 ? scene.name : ''}
          <KeyMarks sceneId={scene.id} keys={scene.keys} hold={scene.hold} holdStart={t.holdStart} pps={pps} drag={drag} snapT={snapT} />
          <div
            className="grip r"
            onPointerDown={(e) =>
              drag(e, (tt, ev) => {
                const hold = Math.max(0, snapT(tt, ev.altKey) - t.holdStart)
                updateScene(scene.id, (s) => { s.hold = Math.round(hold * 100) / 100 }, 'Hold duration', `hold:${scene.id}`)
              }, () => { getState().select({ kind: 'scene', id: scene.id }); seekToScene(scene.id) })
            }
          />
        </div>,
      )
      // Groups flying their own sequences after the hold: one row per group, each step on its own clock.
      const split = compiled.segments.find((sg) => sg.kind === 'split' && sg.scene === i)
      if (split?.kind === 'split') {
        const rows = split.tracks.filter((tr) => tr.id)
        blocks.push(
          <div key={`s-${scene.id}`} className="blk split" style={{ left: toX(split.t0), width: Math.max(4, (split.t1 - split.t0) * pps) }} title={`Groups of ${scene.name} · ${fmtTime(split.t0)}–${fmtTime(split.t1)}, then everyone merges`}>
            {rows.map((tr, r) => {
              const g = scene.groups?.find((x) => x.id === tr.id)
              return (
                <div key={tr.id} className="split-row" style={{ top: `${(r * 100) / rows.length}%`, height: `${100 / rows.length}%` }}>
                  {tr.stepTimes.flatMap((stt, k) => {
                    const step = g?.steps[k]
                    if (!step) return []
                    const fx = (stt.flightStart - split.t0) * pps, fw = (stt.holdStart - stt.flightStart) * pps
                    const hx = (stt.holdStart - split.t0) * pps, hw = (stt.holdEnd - stt.holdStart) * pps
                    const selH = selection.kind === 'scene' && selection.id === step.id
                    const selF = selection.kind === 'flight' && selection.id === step.id
                    return [
                      <div
                        key={`f${k}`}
                        className={`sub flight${stt.transition.used !== 'direct' ? ' styled' : ''}${selF ? ' sel' : ''}`}
                        style={{ left: fx, width: Math.max(2, fw - 1) }}
                        title={`${g!.name}: flight into ${step.name} · ${(stt.holdStart - stt.flightStart).toFixed(1)} s`}
                        onClick={() => getState().select({ kind: 'flight', id: step.id })}
                      >
                        <div className="grip r" onPointerDown={(e) => drag(e, (tt, ev) => {
                          const dur = Math.max(ceilTo(stt.minFlight, 0.1), snapT(tt, ev.altKey) - stt.flightStart)
                          updateScene(step.id, (s) => { s.flight.duration = Math.round(dur * 100) / 100 }, 'Flight duration', `flight:${step.id}`)
                        }, () => getState().select({ kind: 'flight', id: step.id }))} />
                      </div>,
                      <div
                        key={`h${k}`}
                        className={`sub hold${selH ? ' sel' : ''}`}
                        style={{ left: hx, width: Math.max(3, hw), ['--c' as string]: sceneColor(step) }}
                        title={`${g!.name} · ${step.name} · ${fmtTime(stt.holdStart)}–${fmtTime(stt.holdEnd)}`}
                        onPointerDown={(e) => drag(e, () => {}, () => { getState().select({ kind: 'scene', id: step.id }); seekToScene(step.id) })}
                      >
                        {issueScenes.has(step.id) && <span className="err-dot" />}
                        {hw > 46 ? step.name : ''}
                        <KeyMarks sceneId={step.id} keys={step.keys} hold={step.hold} holdStart={stt.holdStart} pps={pps} drag={drag} snapT={snapT} />
                        <div className="grip r" onPointerDown={(e) => drag(e, (tt, ev) => {
                          const hold = Math.max(0, snapT(tt, ev.altKey) - stt.holdStart)
                          updateScene(step.id, (s) => { s.hold = Math.round(hold * 100) / 100 }, 'Hold duration', `hold:${step.id}`)
                        }, () => { getState().select({ kind: 'scene', id: step.id }); seekToScene(step.id) })} />
                      </div>,
                    ]
                  })}
                  {split.t1 - tr.end > 0.05 && <div className="sub wait" style={{ left: (tr.end - split.t0) * pps, width: (split.t1 - tr.end) * pps }} title={`${g?.name ?? 'Group'} waits for the others`} />}
                </div>
              )
            })}
          </div>,
        )
      }
    })
    const rf = compiled.returnFlight
    const rw = (rf.t1 - rf.t0) * pps
    blocks.push(
      <div
        key="rf"
        className={`blk flight${rf.extended ? ' ext' : ''}${rf.detour ? ' detour' : ''}${rf.transition.used !== 'direct' ? ' styled' : ''}${selection.kind === 'landing' ? ' sel' : ''}`}
        style={{ left: toX(rf.t0) + 1, width: Math.max(2, rw - 3) }}
        title={`Return flight: ${(rf.t1 - rf.t0).toFixed(1)} s${rf.detour ? ' · collision-free detour' : ''}${rf.transition.used !== 'direct' ? ` · ${trLabel(rf.transition.used)} transition` : ''}`}
        onClick={() => getState().select({ kind: 'landing' })}
      >
        {rw > 44 ? `${(rf.t1 - rf.t0).toFixed(1)}s` : ''}
        <div
          className="grip r"
          onPointerDown={(e) =>
            drag(e, (tt, ev) => {
              const dur = Math.max(ceilTo(rf.minDuration, 0.1), snapT(tt, ev.altKey) - rf.t0)
              getState().update((d) => { d.site.returnFlight.duration = Math.round(dur * 100) / 100 }, 'Return flight', 'returnFlight')
            }, () => getState().select({ kind: 'landing' }))
          }
        />
      </div>,
    )
    const ld = compiled.landing
    blocks.push(
      <div key="ld" className={`blk ground${selection.kind === 'landing' ? ' sel' : ''}`} style={{ left: toX(ld.t0), width: Math.max(2, (ld.t1 - ld.t0) * pps - 2) }} onClick={() => getState().select({ kind: 'landing' })} title="Landing">
        {(ld.t1 - ld.t0) * pps > 50 ? 'Land' : ''}
      </div>,
    )
  }

  const cueBlocks = doc.cues.map((q) => {
    const sel = selection.kind === 'cue' && selection.id === q.id
    const w = Math.max(6, q.duration * pps)
    const fadeInW = Math.min(w, q.fadeIn * pps), fadeOutW = Math.min(w, q.fadeOut * pps)
    return (
      <div
        key={q.id}
        className={`blk cue${sel ? ' sel' : ''}`}
        style={{ left: toX(q.start), width: w }}
        title={`Light cue · ${fmtTime(q.start)} for ${q.duration.toFixed(1)} s`}
        onPointerDown={(e) => {
          const start0 = q.start
          drag(
            e,
            (_t, ev, dt) => {
              const s = Math.max(0, snapT(start0 + dt, ev.altKey))
              updateCue(q.id, (c) => { c.start = s }, 'Move light cue', `cue-move:${q.id}`)
            },
            () => getState().select({ kind: 'cue', id: q.id }),
          )
        }}
      >
        {fadeInW > 1 && <span className="fade" style={{ left: 0, width: fadeInW, background: 'linear-gradient(90deg, rgba(9,11,16,0.8), transparent)' }} />}
        {fadeOutW > 1 && <span className="fade" style={{ right: 0, width: fadeOutW, background: 'linear-gradient(270deg, rgba(9,11,16,0.8), transparent)' }} />}
        <span className="chip" style={{ background: effectSwatch(q.effect) }} />
        {w > 70 ? cueLabel(q.effect.kind) : ''}
        <div
          className="grip l"
          onPointerDown={(e) => {
            const end = q.start + q.duration
            drag(e, (tt, ev) => {
              const s = Math.max(0, Math.min(end - 0.1, snapT(tt, ev.altKey)))
              updateCue(q.id, (c) => { c.start = s; c.duration = end - s }, 'Resize light cue', `cue-l:${q.id}`)
            }, () => getState().select({ kind: 'cue', id: q.id }))
          }}
        />
        <div
          className="grip r"
          onPointerDown={(e) =>
            drag(e, (tt, ev) => {
              const d = Math.max(0.1, snapT(tt, ev.altKey) - q.start)
              updateCue(q.id, (c) => { c.duration = Math.round(d * 100) / 100 }, 'Resize light cue', `cue-r:${q.id}`)
            }, () => getState().select({ kind: 'cue', id: q.id }))
          }
        />
      </div>
    )
  })

  const totalH = LANES.ruler + LANES.scenes + LANES.lights + LANES.music
  const bpm = doc.audio?.bpm
  const sections = useMemo(() => songSections(doc), [doc.audio]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="timeline">
      <div className="tl-bar">
        <button className="btn ghost icon" onClick={() => stepScene(-1)} title="Previous scene (↑)" aria-label="Previous scene"><ChevronLeft size={16} /></button>
        <button className="btn primary icon" onClick={togglePlay} title="Play / pause (Space)" aria-label={playing ? 'Pause' : 'Play'}>
          {playing ? <Pause size={15} /> : <Play size={15} />}
        </button>
        <button className="btn ghost icon" onClick={() => stepScene(1)} title="Next scene (↓)" aria-label="Next scene"><ChevronRight size={16} /></button>
        <TimeCode duration={compiled?.duration ?? 0} />
        <button className={`btn ghost icon${loop ? ' on' : ''}`} onClick={() => getState().set({ loop: !loop })} title="Loop" aria-pressed={loop}><Repeat size={14} /></button>
        <select className="select" style={{ width: 70, height: 26 }} value={rate} onChange={(e) => setRate(Number(e.target.value))} aria-label="Playback speed" title="Playback speed">
          {[0.25, 0.5, 1, 2, 4].map((r) => <option key={r} value={r}>{r}×</option>)}
        </select>
        <div className="spacer" />
        {validation && validation.issues.length > 0 && (
          <span className="badge-err" style={{ marginRight: 6 }}><AlertTriangle size={12} /> {validation.issues.length} on timeline</span>
        )}
        {beats.length > 0 && doc.scenes.length > 0 && (
          <button
            className="btn sm ghost"
            title="Retime the show so every formation arrives exactly on a downbeat and holds for whole bars (flights only get longer, never unsafe)"
            onClick={() => {
              const { doc: next, aligned } = alignScenesToBars(getState().doc)
              if (aligned) {
                getState().replaceDoc(next, 'Land on the beat')
                getState().toast(`${aligned} formation${aligned > 1 ? 's' : ''} now land on downbeats`)
              } else getState().toast('No formations arrive while the music plays')
            }}
          >
            <Drum size={13} /> On the beat
          </button>
        )}
        <button className={`btn sm ghost${snap ? ' on' : ''}`} onClick={() => getState().set({ snap: !snap })} title="Snap edits to beats (hold Alt to bypass)" aria-pressed={snap}>
          <Magnet size={13} /> {beats.length ? `Snap · ${Math.round(bpm ?? 0)} BPM` : 'Snap'}
        </button>
        <div className="divider-v" />
        <button className="btn ghost icon sm" onClick={() => setZoom(Math.max(fit, pps / 1.5) <= fit * 1.001 ? null : pps / 1.5)} title="Zoom out" aria-label="Zoom out"><ZoomOut size={14} /></button>
        <button className="btn ghost icon sm" onClick={() => setZoom(Math.min(400, pps * 1.5))} title="Zoom in (Ctrl + scroll)" aria-label="Zoom in"><ZoomIn size={14} /></button>
        <button className={`btn ghost icon sm${zoom === null ? ' on' : ''}`} onClick={() => setZoom(null)} title="Fit whole show" aria-label="Fit"><Maximize2 size={13} /></button>
      </div>
      <div className="tl-body" style={{ height: totalH }}>
        <div className="tl-labels">
          <div className="tl-label" style={{ ['--h' as string]: `${LANES.ruler}px` }} />
          <div className="tl-label" style={{ ['--h' as string]: `${LANES.scenes}px` }}>Scenes</div>
          <div className="tl-label" style={{ ['--h' as string]: `${LANES.lights}px` }}>
            Lights
            <MenuButton className="btn ghost icon sm" title="Add light cue at playhead" button={<Plus size={13} />} width={210}>
              {(close) => (
                <>
                  <div className="menu-label">Add at playhead</div>
                  {CUE_PRESETS.map((p, i) => (
                    <button key={p.label} className="menu-item" onClick={() => { addCue(snapT(getState().time, false), i); close() }}>
                      {p.label}
                    </button>
                  ))}
                </>
              )}
            </MenuButton>
          </div>
          <div className="tl-label" style={{ ['--h' as string]: `${LANES.music}px` }}>
            Music
            <MenuButton className="btn ghost icon sm" title="Music" button={<Music size={13} />} width={250}>
              {(close) => (
                <>
                  <button className="menu-item" onClick={async () => { close(); const f = await pickFile('audio/*'); if (f) await loadMusic(await f.arrayBuffer(), f.type || 'audio/mpeg', f.name) }}>
                    {doc.audio ? 'Replace music…' : 'Load music…'}
                  </button>
                  <button className="menu-item" title="An original soundtrack written to this show: arrivals move onto bar lines, and the music builds and drops as the hero formations arrive" onClick={() => { close(); runComposeScore() }}>
                    <Wand2 size={13} /> {doc.audio?.generated ? 'Compose a new score' : 'Compose a score for this show'}
                  </button>
                  {doc.audio && (
                    <>
                      <div className="menu-sep" />
                      <div className="menu-label">Use the music</div>
                      <button className="menu-item" title="Cues that follow the song: breathing in quiet parts, sweeps into drops, flashes on every hit" onClick={() => { close(); runLightTheMusic('bold') }}>
                        <Sparkle size={13} /> Light the music — bold
                      </button>
                      <button className="menu-item" onClick={() => { close(); runLightTheMusic('subtle') }}>
                        <Sparkle size={13} /> Light the music — subtle
                      </button>
                      {doc.cues.some((q) => q.tag === MUSIC_TAG) && (
                        <button className="menu-item" onClick={() => { close(); getState().update((d) => { d.cues = d.cues.filter((q) => q.tag !== MUSIC_TAG) }, 'Remove music lighting') }}>
                          <X size={13} /> Remove music lighting
                        </button>
                      )}
                      <button className="menu-item" title="Every arrival on a bar line, and the show stretched or tightened so the finale ends with the song" onClick={() => { close(); runFitToSong() }}>
                        <Drum size={13} /> Fit show to song
                      </button>
                      <div className="menu-sep" />
                      <button className="menu-item" onClick={() => { close(); void removeMusic() }}>
                        <X size={13} /> Remove music
                      </button>
                    </>
                  )}
                </>
              )}
            </MenuButton>
          </div>
        </div>
        <div className="tl-scroll" ref={scrollRef}>
          <div className="tl-content" style={{ width: contentW, height: totalH }}>
            <div className="tl-lane ruler" style={{ ['--h' as string]: `${LANES.ruler}px` }} onPointerDown={scrub}>
              {ticks.map((t) => (
                <div key={t} className="tick" style={{ left: toX(t) }}>
                  <span>{fmtTime(t).replace(/\.0$/, '')}</span>
                </div>
              ))}
              {beats.length > 0 && (60 / (bpm || 120)) * pps > 5
                ? beats.map((b, i) => <div key={i} className={(i - downbeat) % 4 === 0 ? 'bar' : 'beat'} style={{ left: toX(b) }} />)
                : (240 / (bpm || 120)) * pps > 5 && beats.map((b, i) => ((i - downbeat) % 4 === 0 ? <div key={i} className="bar" style={{ left: toX(b) }} /> : null))}
              {validation?.issues.map((iss) => (
                <svg key={iss.id} className="imark" style={{ left: toX(iss.time) }} viewBox="0 0 10 10" onPointerDown={(e) => { e.stopPropagation(); focusIssue(iss) }}>
                  <title>{iss.title}</title>
                  <path d="M5 9 L0.5 1 H9.5 Z" fill="currentColor" />
                </svg>
              ))}
            </div>
            <div className="tl-lane" style={{ ['--h' as string]: `${LANES.scenes}px` }}>
              {blocks}
            </div>
            <div
              className="tl-lane"
              style={{ ['--h' as string]: `${LANES.lights}px` }}
              onDoubleClick={(e) => {
                const rect = scrollRef.current!.getBoundingClientRect()
                addCue(snapT(toT(e.clientX - rect.left + scrollRef.current!.scrollLeft), false), 5)
              }}
            >
              {cueBlocks}
              {doc.cues.length === 0 && <div className="lane-empty" style={{ left: toX(0) }}>Double-click to add a light cue — flashes, sweeps and washes that play over the formations</div>}
            </div>
            <div className="tl-lane" style={{ ['--h' as string]: `${LANES.music}px` }}>
              {doc.audio && sections.map((sec, i) => (
                <button
                  key={i}
                  className="sec-band"
                  style={{ left: toX(sec.start), width: Math.max(2, (sec.end - sec.start) * pps - 1), ['--c' as string]: SECTION_COLORS[sec.label] }}
                  title={`${sec.label[0]!.toUpperCase() + sec.label.slice(1)} · ${fmtTime(sec.start)}–${fmtTime(sec.end)} · loudness ${Math.round(sec.energy * 100)}% — click to jump here`}
                  onClick={() => seek(sec.start)}
                >
                  {(sec.end - sec.start) * pps > 36 ? sec.label : ''}
                </button>
              ))}
              {doc.audio && songAccents(doc).map((a, i) => <div key={i} className="accent-tick" style={{ left: toX(a) }} title={`Accent at ${fmtTime(a)}`} />)}
              {doc.audio ? (
                <MusicClip left={toX(doc.audio.offset)} width={doc.audio.duration * pps} name={doc.audio.name} peaks={audio?.peaks ?? null} missing={!audio} generated={!!doc.audio.generated}
                  energy={doc.audio.energy ?? null} beats={doc.audio.beats} duration={doc.audio.duration}
                  onPointerDown={(e) => {
                    const o0 = doc.audio!.offset
                    drag(e, (_t, ev, dt) => {
                      const o = Math.round((o0 + dt) * 10) / 10
                      getState().update((d) => { if (d.audio) d.audio.offset = ev.altKey ? o0 + dt : o }, 'Move music', 'music-offset')
                    })
                  }}
                />
              ) : (
                <div className="lane-empty" style={{ left: toX(0) }}>
                  <button className="btn sm" onClick={async () => { const f = await pickFile('audio/*'); if (f) await loadMusic(await f.arrayBuffer(), f.type || 'audio/mpeg', f.name) }}>
                    <Music size={13} /> Load music
                  </button>
                  or drop an audio file anywhere — beats are detected so scenes and lights snap to the music
                </div>
              )}
            </div>
            <Playhead toX={toX} scrollRef={scrollRef} />
          </div>
        </div>
      </div>
    </div>
  )
}

export function runLightTheMusic(style: LightingStyle) {
  const s = getState()
  const { doc, added } = lightTheMusic(s.doc, style)
  if (!added) { s.toast('No song structure to light — load music first.', 'err'); return }
  s.replaceDoc(doc, `Light the music (${style})`)
  s.toast(`${added} light cues now follow the music`)
}

export function runComposeScore() {
  const s = getState()
  if (!s.doc.scenes.length) { s.toast('Add a formation first — the score is written to the show.', 'err'); return }
  const before = s.doc
  const { doc, plan } = composeScore(before)
  if (!plan) return
  s.replaceDoc(before.cues.some((q) => q.tag === MUSIC_TAG) ? lightTheMusic(doc, 'subtle').doc : doc, 'Compose a score')
  const drops = plan.sections.filter((x) => x.label === 'drop').length
  s.toast(`Composed a ${formatTime(plan.duration)} score · ${drops} drop${drops === 1 ? '' : 's'} on your hero formations${before.audio && !before.audio.generated ? ` — replaced “${before.audio.name}” (Undo to get it back)` : ''}`)
}

export function runFitToSong() {
  const s = getState()
  if (!s.doc.audio) { s.toast('Load music first.', 'err'); return }
  const { doc, endGap } = fitToSong(s.doc)
  s.replaceDoc(doc, 'Fit show to song')
  const bar = 240 / Math.max(1, s.doc.audio.bpm)
  s.toast(Math.abs(endGap) <= bar + 0.01 ? 'The show now lands on the bars and ends with the song' : endGap < 0 ? `The show runs ${Math.round(-endGap)} s past the song even at minimum holds` : `Fitted — the song continues ${Math.round(endGap)} s after the finale`)
}

type DragFn = (e: React.PointerEvent, onMove: (t: number, ev: PointerEvent, dt: number) => void, onClick?: () => void) => void

/** Keyframe diamonds on a hold block: drag to retime, click to jump there. */
function KeyMarks({ sceneId, keys, hold, holdStart, pps, drag, snapT }: { sceneId: string; keys?: HoldKey[]; hold: number; holdStart: number; pps: number; drag: DragFn; snapT: (t: number, free: boolean) => number }) {
  if (!keys?.length) return null
  return (
    <>
      {keys.map((k, ki) => (
        <span
          key={ki}
          className={`key-mark${k.through ? ' through' : ''}`}
          style={{ left: Math.min(Math.max(0, k.t), hold) * pps }}
          title={`Keyframe at ${k.t.toFixed(1)} s into the hold${k.through ? ', flowed through' : ''} — drag to retime`}
          onPointerDown={(e) => {
            e.stopPropagation()
            drag(e, (tt, ev) => {
              const nt = Math.round(Math.max(0, Math.min(hold, snapT(tt, ev.altKey) - holdStart)) * 100) / 100
              updateScene(sceneId, (s) => { const key = s.keys?.[ki]; if (key) key.t = nt }, 'Keyframe time', `kt:${sceneId}:${ki}`)
            }, () => { getState().select({ kind: 'scene', id: sceneId }); seek(holdStart + k.t) })
          }}
        />
      ))}
    </>
  )
}

function cueLabel(kind: string): string {
  return { solid: 'Wash', gradient: 'Gradient', rainbow: 'Rainbow', pulse: 'Pulse', twinkle: 'Twinkle', chase: 'Chase', wave: 'Sweep', image: 'Image', flash: 'Flash', strobe: 'Strobe', off: 'Blackout', react: 'Breathe', meter: 'Meter', write: 'Write', type: 'Type', flip: 'Flip', matrix: 'LED' }[kind] ?? kind
}

function TimeCode({ duration }: { duration: number }) {
  const time = useStore((s) => s.time)
  return (
    <div className="timecode" aria-live="off">
      {fmtTime(time)} <span>/ {formatTime(duration)}</span>
    </div>
  )
}

function Playhead({ toX, scrollRef }: { toX: (t: number) => number; scrollRef: React.RefObject<HTMLDivElement> }) {
  const time = useStore((s) => s.time)
  const playing = useStore((s) => s.playing)
  const x = toX(time)
  useEffect(() => {
    const el = scrollRef.current
    if (!el || !playing) return
    if (x > el.scrollLeft + el.clientWidth - 40) el.scrollLeft = x - 80
    else if (x < el.scrollLeft) el.scrollLeft = Math.max(0, x - 80)
  }, [x, playing, scrollRef])
  return <div className="playhead" style={{ left: x - 1 }} />
}

function MusicClip({ left, width, name, peaks, missing, generated, energy, beats, duration, onPointerDown }: {
  left: number; width: number; name: string; peaks: Float32Array | null; missing: boolean; generated: boolean
  energy: number[] | null; beats: number[]; duration: number
  onPointerDown: (e: React.PointerEvent) => void
}) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const cv = ref.current
    if (!cv || (!peaks && !energy)) return
    const w = Math.max(1, Math.min(16000, Math.round(width)))
    const h = 34
    cv.width = w
    cv.height = h
    const ctx = cv.getContext('2d')!
    ctx.clearRect(0, 0, w, h)
    if (peaks) {
      ctx.fillStyle = 'rgba(120, 180, 255, 0.45)'
      for (let x = 0; x < w; x++) {
        const a = Math.floor((x / w) * peaks.length), b = Math.max(a + 1, Math.floor(((x + 1) / w) * peaks.length))
        let m = 0
        for (let i = a; i < b; i++) m = Math.max(m, peaks[i]!)
        const ph = Math.max(1, m * h * 0.95)
        ctx.fillRect(x, (h - ph) / 2, 1, ph)
      }
    }
    // Loudness curve (per beat) — the shape of the song at a glance.
    if (energy && beats.length > 1 && duration > 0) {
      ctx.strokeStyle = 'rgba(255, 214, 102, 0.9)'
      ctx.lineWidth = 1.5
      ctx.beginPath()
      beats.forEach((b, i) => {
        const x = (b / duration) * w, y = h - 2 - (energy[i] ?? 0) * (h - 6)
        if (i === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      })
      ctx.stroke()
    }
  }, [peaks, width, energy, beats, duration])
  return (
    <div className="music-clip" style={{ left, width: Math.max(4, width) }} onPointerDown={onPointerDown} title="Drag to move the music">
      {(peaks || energy) && <canvas ref={ref} />}
      <span className="mname">{name}{missing ? (generated ? ' — composing…' : ' — file not loaded (use the Music menu to re-attach)') : ''}</span>
    </div>
  )
}
