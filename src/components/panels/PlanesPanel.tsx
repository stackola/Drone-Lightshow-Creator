// ============================================================================
// Planes Panel — manage Build Planes: add / select / curve / lock / remove.
// Lives as a tab in the AssetPanel, next to the formations you drag onto planes.
// ============================================================================

import { Plus, Trash2, Lock, Unlock, Eye, EyeOff } from 'lucide-react'
import { usePlanesStore } from '../../stores/planesStore'
import { useHistoryStore } from '../../stores/historyStore'
import { Field, NumberInput, SelectInput } from '../inspectors/shared'
import { toast } from '../Toast'
import type { CurveType, CurveAxis } from '../../graph/buildPlane'

const CURVE_OPTIONS = [
  { value: 'flat', label: 'Flat' },
  { value: 'cylinder', label: 'Cylinder' },
  { value: 'dome', label: 'Dome' },
  { value: 'wave', label: 'Wave' },
]

const AXIS_OPTIONS = [
  { value: 'x', label: 'Along X' },
  { value: 'z', label: 'Along Y' },
]

export function PlanesPanel() {
  const planes = usePlanesStore((s) => s.planes)
  const activePlaneId = usePlanesStore((s) => s.activePlaneId)
  const addPlane = usePlanesStore((s) => s.addPlane)
  const updatePlane = usePlanesStore((s) => s.updatePlane)
  const removePlane = usePlanesStore((s) => s.removePlane)
  const setActivePlane = usePlanesStore((s) => s.setActivePlane)
  const snapshot = useHistoryStore((s) => s.snapshot)

  const active = planes.find((p) => p.id === activePlaneId)

  const handleAdd = () => {
    snapshot('Add plane')
    addPlane({ name: `Plane ${planes.length + 1}` })
    toast.success('Build plane added')
  }

  return (
    <div className="p-2 space-y-2">
      <button
        onClick={handleAdd}
        className="w-full flex items-center justify-center gap-1.5 px-2 py-1.5 text-caption font-medium rounded bg-cyan-500/15 text-cyan-300 hover:bg-cyan-500/25 transition-colors"
      >
        <Plus size={13} /> Add Build Plane
      </button>

      {planes.length === 0 && (
        <div className="px-2 py-6 text-center text-white/40">
          <div className="text-xs font-medium text-white/60 mb-1">No build planes yet</div>
          <div className="text-caption leading-snug max-w-[220px] mx-auto">
            Add a plane, then drag a formation from the viewport onto it. Lock the
            plane to keep items sliding on its surface.
          </div>
        </div>
      )}

      {/* Plane list */}
      <div className="space-y-1">
        {planes.map((plane) => {
          const isActive = plane.id === activePlaneId
          return (
            <div
              key={plane.id}
              onClick={() => setActivePlane(plane.id)}
              className={`flex items-center gap-1.5 px-2 py-1 rounded cursor-pointer transition-colors ${
                isActive ? 'bg-cyan-500/15 ring-1 ring-cyan-400/40' : 'bg-white/[0.03] hover:bg-white/[0.06]'
              }`}
            >
              <span className={`flex-1 text-caption truncate ${isActive ? 'text-cyan-200' : 'text-white/70'}`}>
                {plane.name}
              </span>
              <button
                title={plane.locked ? 'Unlock' : 'Lock to surface'}
                onClick={(e) => { e.stopPropagation(); snapshot(plane.locked ? 'Unlock plane' : 'Lock plane'); updatePlane(plane.id, { locked: !plane.locked }) }}
                className={`p-0.5 rounded ${plane.locked ? 'text-amber-400' : 'text-white/35 hover:text-white/70'}`}
              >
                {plane.locked ? <Lock size={12} /> : <Unlock size={12} />}
              </button>
              <button
                title={plane.visible ? 'Hide' : 'Show'}
                onClick={(e) => { e.stopPropagation(); updatePlane(plane.id, { visible: !plane.visible }) }}
                className="p-0.5 rounded text-white/35 hover:text-white/70"
              >
                {plane.visible ? <Eye size={12} /> : <EyeOff size={12} />}
              </button>
              <button
                title="Delete plane"
                onClick={(e) => { e.stopPropagation(); snapshot('Delete plane'); removePlane(plane.id) }}
                className="p-0.5 rounded text-white/35 hover:text-rose-400"
              >
                <Trash2 size={12} />
              </button>
            </div>
          )
        })}
      </div>

      {/* Active plane editor */}
      {active && (
        <div className="pt-2 mt-1 border-t border-white/10 space-y-1.5">
          <div className="text-micro font-semibold uppercase tracking-wider text-white/40 px-1">
            {active.name}
          </div>

          <Field label="Curve">
            <SelectInput
              value={active.curvature.type}
              options={CURVE_OPTIONS}
              onChange={(v) => { snapshot('Set plane curve'); updatePlane(active.id, { curvature: { ...active.curvature, type: v as CurveType } }) }}
            />
          </Field>

          {active.curvature.type !== 'flat' && (
            <Field label={active.curvature.type === 'wave' ? 'Amplitude' : 'Curvature'}>
              <NumberInput
                value={active.curvature.amount}
                step={active.curvature.type === 'wave' ? 0.2 : 0.01}
                onChange={(v) => updatePlane(active.id, { curvature: { ...active.curvature, amount: v } })}
              />
            </Field>
          )}

          {(active.curvature.type === 'cylinder' || active.curvature.type === 'wave') && (
            <Field label="Bend axis">
              <SelectInput
                value={active.curvature.axis}
                options={AXIS_OPTIONS}
                onChange={(v) => updatePlane(active.id, { curvature: { ...active.curvature, axis: v as CurveAxis } })}
              />
            </Field>
          )}

          {active.curvature.type === 'wave' && (
            <Field label="Wavelength">
              <NumberInput
                value={active.curvature.wavelength ?? 8}
                min={1}
                step={0.5}
                onChange={(v) => updatePlane(active.id, { curvature: { ...active.curvature, wavelength: v } })}
              />
            </Field>
          )}

          <Field label="Size">
            <NumberInput value={active.size} min={2} step={1} onChange={(v) => updatePlane(active.id, { size: v })} />
          </Field>
          <Field label="Grid cell">
            <NumberInput value={active.cellSize} min={0.1} step={0.1} onChange={(v) => updatePlane(active.id, { cellSize: v })} />
          </Field>
        </div>
      )}
    </div>
  )
}
