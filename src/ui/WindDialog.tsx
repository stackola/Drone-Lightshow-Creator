// Wind test: fly the show through the physical simulation and report how far
// drones are blown off their paths and how close they really get.

import { Wind, Play, Square, Eye, EyeOff, CheckCircle2, AlertTriangle, XOctagon } from 'lucide-react'
import { getState, useStore } from '@/state/store'
import { cancelSim, runSim, useSim } from '@/state/sim'
import { seek } from '@/state/playback'
import { WIND_PRESETS, simVerdict, type WindSpec } from '@/core/simulate'
import { formatTime } from '@/core/validate'
import { Modal, NumberField, Row, Segmented } from './components/controls'

const DIRECTIONS: { value: string; label: string; title: string }[] = [
  { value: '0', label: 'N', title: 'From behind the show' },
  { value: '90', label: 'E', title: 'From the right (seen from the audience)' },
  { value: '180', label: 'S', title: 'From the audience' },
  { value: '270', label: 'W', title: 'From the left (seen from the audience)' },
]

export function WindDialog({ onClose }: { onClose: () => void }) {
  const { wind, running, progress, result, forCompiled, view, error } = useSim()
  const compiled = useStore((s) => s.compiled)
  const limits = useStore((s) => s.doc.limits)
  const planned = useStore((s) => s.validation?.stats.minDistance ?? null)
  const stale = !!result && forCompiled !== compiled
  const setWind = (patch: Partial<WindSpec>) => useSim.setState({ wind: { ...wind, ...patch } })
  const preset = WIND_PRESETS.find((p) => p.wind.speed === wind.speed && p.wind.gust === wind.gust && p.wind.turbulence === wind.turbulence)?.label ?? 'Custom'
  const verdict = result && !result.cancelled ? simVerdict(result, limits.minSpacing) : null
  const jump = (t: number) => {
    seek(t)
    useSim.setState({ view: true })
    onClose()
  }

  return (
    <Modal
      title="Wind test"
      onClose={onClose}
      wide
      footer={
        <>
          {result && !stale && result.frames && (
            <button className="btn" onClick={() => useSim.setState({ view: !view })} title="Play the simulated flight in the viewport">
              {view ? <><EyeOff size={13} /> Show the plan</> : <><Eye size={13} /> Watch in viewport</>}
            </button>
          )}
          <div style={{ flex: 1 }} />
          {running ? (
            <button className="btn" onClick={cancelSim}><Square size={12} /> Stop</button>
          ) : (
            <button className="btn primary" disabled={!compiled} onClick={() => runSim(wind)}><Play size={12} /> {result ? 'Run again' : 'Run wind test'}</button>
          )}
        </>
      }
    >
      <p style={{ marginTop: 0 }}>
        Flies every drone through a physical simulation: limited thrust and tilt, air drag, wind that grows with altitude, travelling gusts and
        turbulence, and a flight controller that doesn’t know the wind is coming. The safety check proves the <em>plan</em> is safe; this shows
        how much margin it leaves in real air.
      </p>
      <div className="wind-grid">
        <div>
          <Row label="Conditions">
            <Segmented
              full value={preset}
              options={[...WIND_PRESETS.map((p) => ({ value: p.label, label: p.label })), ...(preset === 'Custom' ? [{ value: 'Custom', label: 'Custom' }] : [])]}
              onChange={(v) => { const p = WIND_PRESETS.find((x) => x.label === v); if (p) setWind(p.wind) }}
            />
          </Row>
          <Row label="Wind at 10 m" title="Mean wind speed measured at 10 m; it is stronger higher up">
            <NumberField value={wind.speed} step={0.5} min={0} max={25} unit="m/s" onChange={(v) => setWind({ speed: v })} />
          </Row>
          <Row label="Gusts" title="Gust amplitude on top of the mean wind">
            <NumberField value={wind.gust} step={0.5} min={0} max={15} unit="m/s" onChange={(v) => setWind({ gust: v })} />
          </Row>
          <Row label="Turbulence" title="Random buffeting of each drone (standard deviation)">
            <NumberField value={wind.turbulence} step={0.1} min={0} max={5} unit="m/s" onChange={(v) => setWind({ turbulence: v })} />
          </Row>
          <Row label="Blowing from">
            <Segmented full value={String(wind.from)} options={DIRECTIONS} onChange={(v) => setWind({ from: Number(v) })} />
          </Row>
        </div>
        <div className="wind-out">
          {running && (
            <div className="wind-progress" role="progressbar" aria-valuenow={Math.round(progress * 100)} aria-valuemin={0} aria-valuemax={100}>
              <div style={{ width: `${progress * 100}%` }} />
              <span><Wind size={12} /> Flying {compiled?.n ?? ''} drones… {Math.round(progress * 100)}%</span>
            </div>
          )}
          {error && <div className="issue"><AlertTriangle size={14} /><div><div className="ititle">Simulation failed</div><div className="idetail">{error}</div></div></div>}
          {!running && !result && !error && <div className="hint">Pick conditions and run the test. It takes a few seconds.</div>}
          {result && verdict && (
            <>
              {stale && <div className="hint" style={{ color: 'var(--warn)', marginBottom: 6 }}>The show changed since this test — run it again for current results.</div>}
              <div className={`wind-verdict ${verdict.level}`}>
                {verdict.level === 'ok' ? <CheckCircle2 size={15} /> : verdict.level === 'warn' ? <AlertTriangle size={15} /> : <XOctagon size={15} />}
                <span>{verdict.text}</span>
              </div>
              <div className="stats" style={{ marginTop: 10 }}>
                <div>Closest approach</div>
                <div className={result.minDistance !== null && result.minDistance < limits.minSpacing ? 'bad' : ''}>
                  {result.minDistance === null ? `≥ ${result.checkRadius.toFixed(1)} m` : `${result.minDistance.toFixed(2)} m`}
                  {planned !== null && <span className="hint"> · planned {planned.toFixed(2)} m</span>}
                </div>
                <div>Largest drift</div>
                <div>
                  {result.maxDeviation.toFixed(2)} m{' '}
                  <button className="link" onClick={() => jump(result.maxDeviationTime)}>at {formatTime(result.maxDeviationTime)}</button>
                </div>
                <div>Typical drift (RMS)</div><div>{result.rmsDeviation.toFixed(2)} m</div>
                <div>At thrust/tilt limit</div><div className={result.saturated > 0.05 ? 'bad' : ''}>{(result.saturated * 100).toFixed(1)}% of the time</div>
              </div>
              {result.closeCalls.length > 0 && (
                <>
                  <div className="subhead" style={{ marginTop: 10 }}>Closest calls</div>
                  <div className="close-calls">
                    {result.closeCalls.slice(0, 6).map((q) => (
                      <button key={`${q.i}-${q.j}`} className="close-call" onClick={() => jump(q.t)}>
                        <span>Drones {q.i + 1} & {q.j + 1}</span><span className="bad">{q.d.toFixed(2)} m</span><span className="hint">{formatTime(q.t)}</span>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </div>
      <p className="hint" style={{ marginBottom: 0 }}>
        Model: ≈1 kg show drone, 35° max tilt, quadratic drag, position controller with feed-forward. Results are an engineering estimate, not a
        certification — always follow the manufacturer’s wind limits.
      </p>
    </Modal>
  )
}

/** Open the wind test from anywhere. */
export function openWindTest() {
  getState().set({ dialog: 'wind' })
}
