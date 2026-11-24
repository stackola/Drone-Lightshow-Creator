import { useEffect, useRef, useState } from 'react'
import { Pause, Play, X } from 'lucide-react'
import { Viewport } from './viewport/Viewport'
import { getState, useStore } from '@/state/store'
import { pause, play, seek, togglePlay } from '@/state/playback'
import { SkipForward } from 'lucide-react'
import { sceneAt } from '@/core/evaluate'
import { formatTime } from '@/core/validate'

/** Fullscreen client preview from the audience's seat. */
export function Present({ onExit }: { onExit: () => void }) {
  const name = useStore((s) => s.doc.name)
  const duration = useStore((s) => s.compiled?.duration ?? 0)
  const time = useStore((s) => s.time)
  const playing = useStore((s) => s.playing)
  const scene = useStore((s) => {
    if (!s.compiled) return ''
    const at = sceneAt(s.compiled, s.time)
    if (at.phase === 'takeoff') return 'Takeoff'
    if (at.phase === 'land' || at.scene < 0) return at.phase === 'land' ? 'Landing' : 'Returning'
    return s.doc.scenes[at.scene]?.name ?? ''
  })
  const firstArrival = useStore((s) => s.compiled?.sceneTimes[0]?.holdStart ?? null)
  const [idle, setIdle] = useState(false)
  const timer = useRef(0)
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    seek(0)
    const t = setTimeout(() => play(), 600)
    root.current?.requestFullscreen?.().catch(() => {})
    const onFs = () => { if (!document.fullscreenElement) exit() }
    document.addEventListener('fullscreenchange', onFs)
    return () => {
      clearTimeout(t)
      document.removeEventListener('fullscreenchange', onFs)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const exit = () => {
    pause()
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {})
    onExit()
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') exit()
      else if (e.key === ' ') { e.preventDefault(); togglePlay() }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }) // eslint-disable-line react-hooks/exhaustive-deps

  const wake = () => {
    setIdle(false)
    clearTimeout(timer.current)
    timer.current = window.setTimeout(() => getState().playing && setIdle(true), 2500)
  }
  useEffect(() => {
    wake()
    return () => clearTimeout(timer.current)
  }, [playing]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div ref={root} className={`present${idle ? ' idle' : ''}`} onPointerMove={wake}>
      <Viewport present />
      <button className="btn ghost icon close" onClick={exit} aria-label="Exit presentation" title="Exit (Esc)"><X size={18} /></button>
      <div className="present-ui">
        <div>
          <div className="present-title">{name}</div>
          <div className="present-sub">{scene}</div>
        </div>
        <div className="present-row">
          <button className="bigplay" onClick={togglePlay} aria-label={playing ? 'Pause' : 'Play'}>{playing ? <Pause size={20} /> : <Play size={20} />}</button>
          <div
            className="present-bar"
            onPointerDown={(e) => {
              const r = e.currentTarget.getBoundingClientRect()
              seek(((e.clientX - r.left) / r.width) * duration)
            }}
          >
            <div style={{ width: `${duration ? (time / duration) * 100 : 0}%` }} />
          </div>
          <span style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--muted)' }}>{formatTime(time)} / {formatTime(duration)}</span>
          {firstArrival !== null && time < firstArrival - 3 && (
            <button className="btn" onClick={() => seek(firstArrival - 3)} title="Jump to just before the first formation arrives">
              <SkipForward size={14} /> Skip takeoff
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
