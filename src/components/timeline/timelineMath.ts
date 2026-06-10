// ============================================================================
// timelineMath — pure helpers shared by every timeline surface (the graph
// canvas TimeRuler, the viewport TimelineRulerPanel / WaveformLane, and any
// future lane). One source for tick spacing, time formatting, waveform
// windowing and beat grids so the surfaces can't drift apart.
// Consumers supply their own time→pixel mapping; nothing here touches React.
// ============================================================================

export function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return `${mins}:${secs.toFixed(1).padStart(4, '0')}`
}

/** Tick spacing (seconds) that keeps labels readable at a given density. */
export function getTickInterval(effectivePxPerSecond: number): number {
  if (effectivePxPerSecond > 200) return 1
  if (effectivePxPerSecond > 50) return 5
  if (effectivePxPerSecond > 20) return 10
  return 30
}

export interface Tick {
  time: number
  isMajor: boolean
}

/** Ticks covering [startTime, endTime], major every Nth per the interval. */
export function computeTicks(startTime: number, endTime: number, interval: number): Tick[] {
  const majorEvery = interval === 5 ? 2 : interval >= 10 ? 1 : 5
  const ticks: Tick[] = []
  const first = Math.max(0, Math.floor(startTime / interval) * interval)
  let i = 0
  for (let t = first; t <= endTime; t += interval) {
    ticks.push({ time: t, isMajor: i % majorEvery === 0 })
    i++
  }
  return ticks
}

export interface WaveformBar {
  time: number
  /** Normalized 0..1 peak. */
  peak: number
}

/** Peaks that fall inside [startTime, endTime], with their show-time. */
export function waveformBarsInWindow(
  peaks: ArrayLike<number> | null,
  audioDuration: number,
  startTime: number,
  endTime: number,
): WaveformBar[] {
  if (!peaks || audioDuration <= 0) return []
  const out: WaveformBar[] = []
  for (let i = 0; i < peaks.length; i++) {
    const time = (i / peaks.length) * audioDuration
    if (time < startTime || time > endTime) continue
    out.push({ time, peak: peaks[i] ?? 0 })
  }
  return out
}

/** Beat times: explicit markers when audio is loaded, else the BPM grid. */
export function beatGridTimes(
  beatMarkers: ReadonlyArray<{ time: number }>,
  bpm: number,
  totalDuration: number,
  isAudioLoaded: boolean,
): number[] {
  if (isAudioLoaded && beatMarkers.length > 0) return beatMarkers.map((b) => b.time)
  const out: number[] = []
  const beatSec = 60 / Math.max(30, bpm)
  for (let t = 0; t < totalDuration; t += beatSec) out.push(t)
  return out
}
