// ============================================================================
// S9-03/06 + S16-03/04/05: Full Export Dialog
// S9 (2026-05-21): Pre-export validation banner — shows physics violations
// before bake starts so users know to fix them first.
// ============================================================================

import { useState, useCallback, useMemo, useRef } from 'react'
import { Download, X, Loader, Video, AlertTriangle, CheckCircle2 } from 'lucide-react'
import { bakeCurrentProject, cancelBake, type BakeOutput } from '../services/bakeService'
import { exportCSV, exportProjectJSON, type ExportFormat } from '../services/exportService'
import { startVideoExport, downloadVideo } from '../services/videoExport'
import { useProjectStore } from '../stores/projectStore'
import { useGraphStore } from '../stores/graphStore'
import { usePlayheadStore } from '../stores/playheadStore'
import { useFormationStore } from '../stores/formationStore'
import { validateShowPhysics } from '../graph/physicsValidator'
import { Button, Dialog } from './ui'

interface ExportDialogProps {
  onClose: () => void
}

type FullExportFormat = ExportFormat | 'video'
type ExportState = 'idle' | 'baking' | 'ready' | 'recording' | 'video-ready' | 'error'

export function ExportDialog({ onClose }: ExportDialogProps) {
  const projectName = useProjectStore((s) => s.meta.name)
  const [format, setFormat] = useState<FullExportFormat>('csv')
  const [sampleRate, setSampleRate] = useState(10)
  const [coordinateSystem, setCoordinateSystem] = useState<'enu' | 'ned'>('enu')
  const [state, setState] = useState<ExportState>('idle')
  const [progress, setProgress] = useState(0)
  const [eta, setEta] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [bakeResult, setBakeResult] = useState<BakeOutput | null>(null)
  const [videoBlob, setVideoBlob] = useState<Blob | null>(null)
  const [videoUrl, setVideoUrl] = useState<string | null>(null)
  const [videoMime, setVideoMime] = useState<string>('video/webm')
  // Was: `(window as any).__videoCancel = cancel`. The cancel handle for the
  // in-flight `startVideoExport` call now lives on a ref instead of leaking
  // through a window-global side-channel.
  const videoCancelRef = useRef<(() => void) | null>(null)

  // S9 — pre-export validation. Compute once when the dialog opens (cheap;
  // physicsValidator is O(nodes × samples) but capped per frame; ~10 ms on
  // typical shows).
  const validation = useMemo(() => {
    const { nodes, edges } = useGraphStore.getState()
    const constraints = useProjectStore.getState().constraints
    const generatedPoints = useFormationStore.getState().generatedPoints
    const all = validateShowPhysics({ nodes, edges }, constraints, generatedPoints)
    const errors = all.filter((v) => v.severity === 'error')
    const warnings = all.filter((v) => v.severity === 'warning')
    return { errors, warnings, total: all.length }
  }, [])

  const handleBake = useCallback(async () => {
    if (format === 'json') {
      exportProjectJSON(projectName)
      onClose()
      return
    }

    if (format === 'video') {
      handleVideoRecord()
      return
    }

    setState('baking')
    setProgress(0)
    setError(null)

    try {
      const result = await bakeCurrentProject({
        sampleRate,
        onProgress: (p, e) => { setProgress(p); setEta(e) },
      })
      setBakeResult(result)
      setState('ready')
    } catch (err) {
      setError((err as Error).message)
      setState('error')
    }
  }, [format, sampleRate, projectName, onClose])

  // S16-04: Video recording
  const handleVideoRecord = useCallback(() => {
    setState('recording')
    setProgress(0)

    // Compute show duration
    const timing = useGraphStore.getState().getCachedTiming()
    let maxEnd = 0
    timing.forEach((r) => { if (r.end > maxEnd) maxEnd = r.end })
    const duration = Math.max(5, maxEnd + 2) // Add 2s buffer

    // Start playback
    const playheadStore = usePlayheadStore.getState()
    playheadStore.setCurrentTime(0)
    playheadStore.setPlaying(true)

    const { cancel } = startVideoExport(
      { duration, fps: 30, format: 'webm', width: 1920, height: 1080 },
      {
        onProgress: (p) => setProgress(p),
        onComplete: (blob, url, mimeType) => {
          playheadStore.setPlaying(false)
          setVideoBlob(blob)
          setVideoUrl(url)
          setVideoMime(mimeType)
          setState('video-ready')
        },
        onError: (err) => {
          playheadStore.setPlaying(false)
          setError(err.message)
          setState('error')
        },
      },
    )

    videoCancelRef.current = cancel
  }, [])

  const handleExport = useCallback(() => {
    if (!bakeResult) return
    exportCSV(bakeResult, { format: 'csv', sampleRate, coordinateSystem, projectName })
    onClose()
  }, [bakeResult, sampleRate, coordinateSystem, projectName, onClose])

  const handleDownloadVideo = useCallback(() => {
    if (!videoBlob) return
    const ext = videoMime.includes('mp4') ? 'mp4' : 'webm'
    downloadVideo(videoBlob, `${projectName.replace(/[^a-zA-Z0-9]/g, '_')}.${ext}`)
    onClose()
  }, [videoBlob, videoMime, projectName, onClose])

  const handleCancel = useCallback(() => {
    cancelBake()
    videoCancelRef.current?.()
    videoCancelRef.current = null
    setState('idle')
  }, [])

  return (
    // No onClose on Dialog: this dialog never closed on Escape, and Dialog
    // wires Escape whenever onClose is passed. Backdrop clicks bubble up to
    // this wrapper instead (panel clicks are stopped inside Dialog).
    <div onClick={onClose}>
      <Dialog>
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-white/10">
          <h2 className="text-lg font-semibold text-white flex items-center gap-2">
            <Download size={18} /> Export Show
          </h2>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 transition-colors">
            <X size={18} />
          </button>
        </div>

        <div className="p-4 space-y-4">
          {/* S9 — pre-export validation banner. Show the user what state
              their show is in before they commit to a long bake. Doesn't
              block — they can always proceed; we just want them informed. */}
          {state === 'idle' && validation.total === 0 && (
            <div className="flex items-center gap-2 p-2 rounded bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-xs">
              <CheckCircle2 size={14} className="flex-shrink-0" />
              <span>Show validates clean — no physics violations.</span>
            </div>
          )}
          {state === 'idle' && validation.total > 0 && (
            <div className={`flex items-start gap-2 p-2 rounded text-xs ${
              validation.errors.length > 0
                ? 'bg-red-500/10 border border-red-500/20 text-red-300'
                : 'bg-amber-500/10 border border-amber-500/20 text-amber-300'
            }`}>
              <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
              <div className="flex-1 space-y-1">
                <div>
                  {validation.errors.length > 0 && <span className="font-semibold">{validation.errors.length} error{validation.errors.length === 1 ? '' : 's'}</span>}
                  {validation.errors.length > 0 && validation.warnings.length > 0 && ', '}
                  {validation.warnings.length > 0 && <span>{validation.warnings.length} warning{validation.warnings.length === 1 ? '' : 's'}</span>}
                  {' '}detected — open the Physics tab to review.
                </div>
                <ul className="text-micro opacity-80 space-y-0.5 max-h-16 overflow-y-auto">
                  {[...validation.errors, ...validation.warnings].slice(0, 3).map((v) => (
                    <li key={v.id} className="truncate">• {v.message}</li>
                  ))}
                  {validation.total > 3 && <li className="opacity-60">+ {validation.total - 3} more</li>}
                </ul>
              </div>
            </div>
          )}

          {/* Format selector */}
          <div>
            <label className="text-xs text-white/50 block mb-1">Format</label>
            <select value={format} onChange={(e) => setFormat(e.target.value as FullExportFormat)}
              disabled={state === 'baking' || state === 'recording'}
              className="w-full bg-white/10 text-white text-sm px-3 py-2 rounded border border-white/10 outline-none focus:border-accent-primary">
              <option value="csv">CSV Waypoints (ZIP archive)</option>
              <option value="json">JSON Project File (.droneshow)</option>
              <option value="video">Video Recording (WebM)</option>
            </select>
          </div>

          {/* CSV-specific options */}
          {format === 'csv' && (
            <>
              <div>
                <label className="text-xs text-white/50 block mb-1">Sample Rate (Hz)</label>
                <input type="number" value={sampleRate}
                  onChange={(e) => setSampleRate(Math.max(1, Math.min(100, Number(e.target.value))))}
                  disabled={state === 'baking'} min={1} max={100}
                  className="w-full bg-white/10 text-white text-sm px-3 py-2 rounded border border-white/10 outline-none focus:border-accent-primary" />
                <p className="text-xs text-white/30 mt-1">Higher rates = smoother trajectories, larger files</p>
              </div>
              <div>
                <label className="text-xs text-white/50 block mb-1">Coordinate System</label>
                <select value={coordinateSystem} onChange={(e) => setCoordinateSystem(e.target.value as 'enu' | 'ned')}
                  disabled={state === 'baking'}
                  className="w-full bg-white/10 text-white text-sm px-3 py-2 rounded border border-white/10 outline-none focus:border-accent-primary">
                  <option value="enu">ENU (East-North-Up)</option>
                  <option value="ned">NED (North-East-Down)</option>
                </select>
              </div>
            </>
          )}

          {/* Video info */}
          {format === 'video' && state === 'idle' && (
            <div className="p-3 bg-white/5 rounded text-xs text-white/50 flex items-center gap-2">
              <Video size={16} className="flex-shrink-0" />
              Records the 3D viewport as a WebM video during playback. The show will play from the beginning.
            </div>
          )}

          {/* Bake / Recording progress */}
          {(state === 'baking' || state === 'recording') && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-white/70 flex items-center gap-2">
                  <Loader size={14} className="animate-spin" />
                  {state === 'recording' ? 'Recording viewport...' : 'Baking trajectories...'}
                </span>
                <span className="text-white/40">
                  {eta > 0 && state === 'baking' ? `~${Math.ceil(eta)}s remaining` : ''}
                </span>
              </div>
              <div className="w-full bg-white/10 rounded-full h-2">
                <div className="bg-accent-primary h-2 rounded-full transition-all duration-200"
                  style={{ width: `${Math.round(progress * 100)}%` }} />
              </div>
              <div className="text-xs text-white/40 text-right">{Math.round(progress * 100)}%</div>
            </div>
          )}

          {/* S16-03: Bake complete summary with report */}
          {state === 'ready' && bakeResult && (
            <div className="p-3 bg-green-900/20 border border-green-500/20 rounded text-sm text-green-300 space-y-1">
              <div>Bake complete: {bakeResult.droneCount} drones, {bakeResult.sampleCount} samples, {bakeResult.duration.toFixed(1)}s</div>
            </div>
          )}

          {/* Video ready */}
          {state === 'video-ready' && videoUrl && (
            <div className="space-y-2">
              <div className="p-3 bg-green-900/20 border border-green-500/20 rounded text-sm text-green-300">
                Video recording complete ({videoBlob ? (videoBlob.size / 1024 / 1024).toFixed(1) : '?'} MB)
              </div>
              <video src={videoUrl} controls className="w-full rounded border border-white/10" style={{ maxHeight: 200 }} />
            </div>
          )}

          {/* Error */}
          {state === 'error' && error && (
            <div className="p-3 bg-red-900/20 border border-red-500/20 rounded text-sm text-red-300">{error}</div>
          )}
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-2 p-4 border-t border-white/10">
          {(state === 'baking' || state === 'recording') ? (
            <button onClick={handleCancel} className="px-4 py-2 text-sm text-white/50 hover:text-white/80 transition-colors">Cancel</button>
          ) : state === 'ready' ? (
            <button onClick={handleExport} className="px-4 py-2 text-sm bg-green-600 hover:bg-green-500 text-white rounded transition-colors">Download CSV ZIP</button>
          ) : state === 'video-ready' ? (
            <button onClick={handleDownloadVideo} className="px-4 py-2 text-sm bg-green-600 hover:bg-green-500 text-white rounded transition-colors">Download Video</button>
          ) : (
            <Button variant="primary" size="md" onClick={handleBake}>
              {format === 'json' ? 'Export JSON' : format === 'video' ? 'Start Recording' : 'Bake & Export'}
            </Button>
          )}
        </div>
      </Dialog>
    </div>
  )
}
