import { Undo2, Redo2, MonitorPlay, Menu, ShieldCheck, ShieldAlert, Wrench, Settings2, FilePlus2, FolderOpen, Save, Download, Music, Keyboard, Sparkles, Wand2, PenLine, MessageSquareText, FileText, KeyRound, Box, Wind, ImagePlus } from 'lucide-react'
import { openCopilot } from './ai/openCopilot'
import { STARTERS } from '@/ai/copilotStore'
import { getState, useStore } from '@/state/store'
import { fixAll } from '@/state/actions'
import { loadMusic, openProjectFile, pickFile, saveProject } from '@/state/persist'
import { formatTime } from '@/core/validate'
import { MenuButton } from './components/controls'
import { IssueCard } from './panels/Inspector'

export function TopBar({ onPresent }: { onPresent: () => void }) {
  const name = useStore((s) => s.doc.name)
  const n = useStore((s) => s.doc.droneCount)
  const duration = useStore((s) => s.compiled?.duration ?? 0)
  const canUndo = useStore((s) => s.past.length > 0)
  const canRedo = useStore((s) => s.future.length > 0)
  const undoLabel = useStore((s) => s.past[s.past.length - 1]?.label)
  const redoLabel = useStore((s) => s.future[0]?.label)
  const update = useStore((s) => s.update)
  return (
    <header className="topbar">
      <div className="brand" title="Drone Show Designer">
        <span className="brand-mark" aria-hidden />
      </div>
      <input className="title-input" value={name} aria-label="Show name" onChange={(e) => update((d) => { d.name = e.target.value }, 'Rename show', 'showname')} />
      <span className="meta">{n} drones · {formatTime(duration)}</span>
      <div className="spacer" />
      <button className="btn ghost icon" disabled={!canUndo} onClick={() => getState().undo()} title={canUndo ? `Undo ${undoLabel} (Ctrl+Z)` : 'Nothing to undo'} aria-label="Undo"><Undo2 size={15} /></button>
      <button className="btn ghost icon" disabled={!canRedo} onClick={() => getState().redo()} title={canRedo ? `Redo ${redoLabel} (Ctrl+Shift+Z)` : 'Nothing to redo'} aria-label="Redo"><Redo2 size={15} /></button>
      <div className="divider-v" />
      <SafetyStatus />
      <MenuButton className="btn ai" title="AI features" align="right" width={280} button={<><Sparkles size={14} /> AI</>}>
        {(close) => (
          <>
            <button className="menu-item" onClick={() => { close(); getState().set({ dialog: 'director' }) }}><Wand2 size={14} className="ai-mark" /> Generate a show from a brief…</button>
            <button className="menu-item" onClick={() => { close(); getState().set({ dialog: 'picture', aiTarget: null }) }}><ImagePlus size={14} className="ai-mark" /> Picture to drones…</button>
            <button className="menu-item" onClick={() => { close(); getState().set({ dialog: 'describe' }) }}><PenLine size={14} className="ai-mark" /> Describe a formation…</button>
            <button className="menu-item" onClick={() => { close(); getState().set({ dialog: 'model3d', aiTarget: null }) }}><Box size={14} className="ai-mark" /> Create a 3D model…</button>
            <button className="menu-item" onClick={() => { close(); openCopilot() }}><MessageSquareText size={14} className="ai-mark" /> Ask the copilot <span className="kbd">Ctrl K</span></button>
            <button className="menu-item" onClick={() => { close(); openCopilot(); void import('@/ai/copilot').then((m) => m.sendToCopilot(STARTERS[0]!.prompt)) }}><Sparkles size={14} className="ai-mark" /> Review my show</button>
            <button className="menu-item" onClick={() => { close(); getState().set({ dialog: 'pitch' }) }}><FileText size={14} className="ai-mark" /> Write a client pitch…</button>
            <div className="menu-sep" />
            <button className="menu-item" onClick={() => { close(); getState().set({ dialog: 'ai-settings' }) }}><KeyRound size={14} /> AI settings…</button>
          </>
        )}
      </MenuButton>
      <button className="btn ghost icon" title="Show settings & safety limits" aria-label="Show settings" onClick={() => getState().select({ kind: 'show' })}><Settings2 size={15} /></button>
      <MenuButton className="btn ghost icon" title="File" align="right" width={240} button={<Menu size={16} />}>
        {(close) => (
          <>
            <button className="menu-item" onClick={() => { close(); getState().set({ dialog: 'new' }) }}><FilePlus2 size={14} /> New show…</button>
            <button className="menu-item" onClick={async () => { close(); const f = await pickFile('.json,application/json'); if (f) await openProjectFile(f) }}><FolderOpen size={14} /> Open project…</button>
            <button className="menu-item" onClick={() => { close(); saveProject() }}><Save size={14} /> Save project <span className="kbd">Ctrl S</span></button>
            <div className="menu-sep" />
            <button className="menu-item" onClick={() => { close(); getState().set({ dialog: 'export' }) }}><Download size={14} /> Export trajectories…</button>
            <button className="menu-item" onClick={async () => { close(); const f = await pickFile('audio/*'); if (f) await loadMusic(await f.arrayBuffer(), f.type || 'audio/mpeg', f.name) }}><Music size={14} /> Load music…</button>
            <div className="menu-sep" />
            <button className="menu-item" onClick={() => { close(); getState().set({ dialog: 'shortcuts' }) }}><Keyboard size={14} /> Keyboard shortcuts <span className="kbd">?</span></button>
          </>
        )}
      </MenuButton>
      <button className="btn primary" onClick={onPresent} title="Play the show fullscreen from the audience’s view (P)">
        <MonitorPlay size={15} /> Present
      </button>
    </header>
  )
}

function SafetyStatus() {
  const validation = useStore((s) => s.validation)
  const computing = useStore((s) => s.computing)
  const err = useStore((s) => s.engineError)
  const minSpacing = useStore((s) => s.doc.limits.minSpacing)
  if (err) return <span className="btn status-btn err" title={err}>Engine error</span>
  if (!validation) return <span className="btn status-btn busy"><span className="spinner" /> Planning…</span>
  const count = validation.issues.length
  const fixable = validation.issues.filter((i) => i.fix).length
  return (
    <MenuButton
      className={`btn status-btn ${count ? 'err' : 'ok'}`}
      title="Safety check"
      align="right"
      width={360}
      button={
        <>
          {count ? <ShieldAlert size={14} /> : <ShieldCheck size={14} />}
          {count ? `${count} issue${count > 1 ? 's' : ''}` : 'Safe to fly'}
          {computing && <span className="spinner" style={{ marginLeft: 2 }} />}
        </>
      }
    >
      {(close) => (
        <div style={{ padding: 6, maxHeight: '70vh', overflow: 'auto' }}>
          {count === 0 ? (
            <div className="okbox"><ShieldCheck size={15} /> Every drone pair stays ≥ {minSpacing} m apart; speeds, altitude, airspace and battery are within limits.</div>
          ) : (
            <>
              {fixable > 0 && <button className="btn sm primary" onClick={() => { fixAll() }}><Wrench size={12} /> Fix {fixable} automatically</button>}
              {validation.issues.map((i) => <IssueCard key={i.id} issue={i} />)}
            </>
          )}
          <div className="stats" style={{ marginTop: 10, padding: '0 2px' }}>
            <div>Closest approach</div><div>{validation.stats.minDistance.toFixed(2)} m</div>
            <div>Peak speed</div><div>{validation.stats.peakSpeedH.toFixed(1)} m/s</div>
            <div>Peak acceleration</div><div>{validation.stats.peakAccel.toFixed(1)} m/s²</div>
            <div>Peak jerk</div><div>{validation.stats.peakJerk.toFixed(1)} m/s³</div>
            <div>Highest drone</div><div>{validation.stats.maxAltitude.toFixed(0)} m</div>
          </div>
          <div className="hint" style={{ marginTop: 8 }}>Checks are exact, not sampled: every pair of drones in every flight, peak speeds, accelerations and jerk from the motion curves. Flights that would pass too close take a collision-free detour automatically.</div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 6 }}>
            <button className="btn sm ghost" onClick={() => { close(); getState().set({ dialog: 'wind' }) }} title="Fly the show through a physical simulation with wind and gusts"><Wind size={12} /> Wind test</button>
            <button className="btn sm ghost" onClick={() => { close(); getState().select({ kind: 'show' }) }}>Edit limits</button>
          </div>
        </div>
      )}
    </MenuButton>
  )
}
