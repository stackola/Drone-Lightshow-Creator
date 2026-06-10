// ============================================================================
// S16-04: Video Render Export — Record 3D viewport as MP4/WebM
// ============================================================================
// Uses MediaRecorder API to capture the viewport canvas as video.
// L5-toast (2026-05-21): the MP4 path is *not* a real MP4 — `MediaRecorder`
// browser support for `video/mp4` is sparse and we currently fall back to WebM
// regardless of what the user picked. The function now fires a toast and
// reports the chosen mimeType so the caller can label the export honestly
// rather than silently degrading. Plan §S9 / appendix Tier-2 video export.
// ============================================================================

import { toast } from '../components/Toast'

export interface VideoExportOptions {
  duration: number     // seconds to record
  fps: number          // frames per second (default 30)
  format: 'webm' | 'mp4'
  width: number
  height: number
}

export interface VideoExportCallbacks {
  onProgress: (progress: number) => void
  /** `mimeType` is the format actually used (may differ from `options.format`
   *  when MP4 isn't supported and we fall back to WebM). */
  onComplete: (blob: Blob, url: string, mimeType: string) => void
  onError: (error: Error) => void
}

function pickMimeType(format: 'webm' | 'mp4'): { mimeType: string; degraded: boolean } {
  // Try MP4 first if requested; the H.264 codec line is what Safari/iOS accept.
  if (format === 'mp4') {
    for (const candidate of ['video/mp4;codecs=avc1.42E01E', 'video/mp4']) {
      if (MediaRecorder.isTypeSupported(candidate)) return { mimeType: candidate, degraded: false }
    }
    // Fallback to WebM with a degraded flag so the caller can warn.
    for (const candidate of ['video/webm;codecs=vp9', 'video/webm']) {
      if (MediaRecorder.isTypeSupported(candidate)) return { mimeType: candidate, degraded: true }
    }
  }
  for (const candidate of ['video/webm;codecs=vp9', 'video/webm']) {
    if (MediaRecorder.isTypeSupported(candidate)) return { mimeType: candidate, degraded: false }
  }
  return { mimeType: '', degraded: false }
}

/**
 * S16-04: Record the 3D viewport canvas as video.
 * Finds the Three.js canvas element and uses MediaRecorder to capture it.
 */
export function startVideoExport(
  options: VideoExportOptions,
  callbacks: VideoExportCallbacks,
): { cancel: () => void } {
  let cancelled = false

  const canvas = document.querySelector('canvas[data-engine]') as HTMLCanvasElement | null
  if (!canvas) {
    callbacks.onError(new Error('3D viewport canvas not found'))
    return { cancel: () => {} }
  }

  const stream = canvas.captureStream(options.fps)
  const { mimeType, degraded } = pickMimeType(options.format)

  if (!mimeType) {
    callbacks.onError(new Error('No supported video format available in this browser'))
    return { cancel: () => {} }
  }

  if (degraded) {
    toast.warning(`MP4 isn't supported in this browser — exporting as WebM instead.\nThe file will play in most modern players.`, { duration: 6000 })
  }

  const recorder = new MediaRecorder(stream, {
    mimeType,
    videoBitsPerSecond: 8_000_000,
  })

  const chunks: Blob[] = []
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data)
  }

  recorder.onstop = () => {
    if (cancelled) return
    const blob = new Blob(chunks, { type: mimeType })
    const url = URL.createObjectURL(blob)
    callbacks.onComplete(blob, url, mimeType)
  }

  recorder.onerror = () => {
    if (cancelled) return
    callbacks.onError(new Error('MediaRecorder failed'))
  }

  recorder.start(100) // Collect data every 100ms

  // Progress tracking
  const startTime = Date.now()
  const progressInterval = setInterval(() => {
    if (cancelled) { clearInterval(progressInterval); return }
    const elapsed = (Date.now() - startTime) / 1000
    const progress = Math.min(1, elapsed / options.duration)
    callbacks.onProgress(progress)

    if (elapsed >= options.duration) {
      clearInterval(progressInterval)
      recorder.stop()
    }
  }, 200)

  return {
    cancel: () => {
      cancelled = true
      clearInterval(progressInterval)
      if (recorder.state === 'recording') recorder.stop()
    },
  }
}

/**
 * Download a video blob as a file.
 */
export function downloadVideo(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
