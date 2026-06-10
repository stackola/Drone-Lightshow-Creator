// ============================================================================
// Bundle 2: Snap Plane popover — toggle + size / cell sliders
// ============================================================================

import { useState } from 'react'
import { useViewStore } from '../../stores/viewStore'
import { Grid as GridIcon, RotateCw } from 'lucide-react'
import { Tooltip } from '../Tooltip'

export function SnapPlanePopover() {
  const [open, setOpen] = useState(false)
  const snapPlane = useViewStore((s) => s.snapPlane)
  const toggle = useViewStore((s) => s.toggleSnapPlane)
  const setSize = useViewStore((s) => s.setSnapPlaneSize)
  const setCell = useViewStore((s) => s.setSnapPlaneCellSize)
  const setRot = useViewStore((s) => s.setSnapPlaneRotationDeg)
  const setPos = useViewStore((s) => s.setSnapPlanePosition)

  return (
    <div className="absolute bottom-14 left-2 z-10">
      <div className="flex items-center gap-1">
        <Tooltip label={snapPlane.active ? 'Disable snap plane' : 'Enable snap plane'} shortcut="P" side="right">
          <button
            className={`p-1.5 rounded-lg border transition-colors bg-surface-raised/90 backdrop-blur-sm ${
              snapPlane.active ? 'border-cyan-500/50 text-cyan-400' : 'border-white/10 text-white/40 hover:text-white/60'
            }`}
            onClick={toggle}
            aria-label="Toggle snap plane"
          >
            <GridIcon size={14} />
          </button>
        </Tooltip>
        {snapPlane.active && (
          <Tooltip label="Snap plane settings" side="right">
            <button
              className={`p-1.5 rounded-lg border transition-colors bg-surface-raised/90 backdrop-blur-sm ${
                open ? 'border-cyan-500/50 text-cyan-400' : 'border-white/10 text-white/40 hover:text-white/60'
              }`}
              onClick={() => setOpen((o) => !o)}
              aria-label="Snap plane settings"
            >
              <RotateCw size={14} />
            </button>
          </Tooltip>
        )}
      </div>
      {open && snapPlane.active && (
        <div className="animate-panel-in absolute bottom-full left-0 mb-1 bg-surface-raised/95 backdrop-blur-sm rounded-lg border border-white/10 p-2 min-w-[180px] space-y-1.5">
          <div className="text-micro text-white/40">Snap Plane</div>
          <Slider label="Size" value={snapPlane.size} min={2} max={100} step={1} onChange={setSize} />
          <Slider label="Cell" value={snapPlane.cellSize} min={0.1} max={5} step={0.1} onChange={setCell} />
          <div className="grid grid-cols-3 gap-1 text-[9px] text-white/40">
            <button onClick={() => setRot({ x: 0, y: 0, z: 0 })} className="rounded bg-white/5 hover:bg-white/10 py-0.5">XY</button>
            <button onClick={() => setRot({ x: 90, y: 0, z: 0 })} className="rounded bg-white/5 hover:bg-white/10 py-0.5">XZ</button>
            <button onClick={() => setRot({ x: 0, y: 0, z: 90 })} className="rounded bg-white/5 hover:bg-white/10 py-0.5">YZ</button>
          </div>
          <button
            onClick={() => setPos({ x: 0, y: 0, z: 0 })}
            className="w-full text-micro text-white/40 hover:text-white/70 bg-white/5 hover:bg-white/10 rounded py-0.5"
          >
            Reset position
          </button>
          <div className="text-[9px] text-white/30">Hold Shift while dragging to bypass snap.</div>
        </div>
      )}
    </div>
  )
}

function Slider({ label, value, min, max, step, onChange }: { label: string; value: number; min: number; max: number; step: number; onChange: (n: number) => void }) {
  return (
    <label className="block">
      <div className="flex justify-between text-micro text-white/40 mb-0.5">
        <span>{label}</span>
        <span className="text-white/60">{value.toFixed(step < 1 ? 1 : 0)}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-cyan-400"
      />
    </label>
  )
}
