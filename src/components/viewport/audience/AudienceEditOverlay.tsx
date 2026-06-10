// ============================================================================
// Audience Edit Overlay — DOM HUD for audience-perspective editing. Lives over
// the audience Canvas. Presentation is the default; "Edit" is a toggle. In Free
// mode a depth slider controls where placements land along the view ray.
// ============================================================================

import { MousePointer2, Hand } from 'lucide-react'
import { useAudienceEditStore } from '../../../stores/audienceEditStore'
import { usePlanesStore } from '../../../stores/planesStore'

export function AudienceEditOverlay() {
  const editing = useAudienceEditStore((s) => s.editing)
  const surface = useAudienceEditStore((s) => s.surface)
  const placementDepth = useAudienceEditStore((s) => s.placementDepth)
  const toggleEditing = useAudienceEditStore((s) => s.toggleEditing)
  const setSurface = useAudienceEditStore((s) => s.setSurface)
  const setPlacementDepth = useAudienceEditStore((s) => s.setPlacementDepth)
  const hasActivePlane = usePlanesStore((s) => s.activePlaneId !== null)

  return (
    <div className="absolute top-2 left-2 z-10 flex flex-col gap-1.5 pointer-events-none">
      <div className="floating-panel pointer-events-auto flex items-center gap-0.5 !rounded-md p-0.5">
        <button
          onClick={() => editing && toggleEditing()}
          className={`flex items-center gap-1 px-2 py-0.5 rounded text-micro font-medium transition-colors ${
            !editing ? 'bg-white/80 text-slate-900' : 'text-white/55 hover:text-white/85'
          }`}
        >
          <Hand size={11} /> Present
        </button>
        <button
          data-testid="audience-edit-toggle"
          onClick={() => !editing && toggleEditing()}
          className={`flex items-center gap-1 px-2 py-0.5 rounded text-micro font-medium transition-colors ${
            editing ? 'bg-cyan-400/90 text-slate-900' : 'text-white/55 hover:text-white/85'
          }`}
        >
          <MousePointer2 size={11} /> Edit
        </button>
      </div>

      {editing && (
        <div className="floating-panel pointer-events-auto flex flex-col gap-1 !rounded-md p-1.5 w-40">
          <div className="flex items-center gap-0.5">
            <button
              onClick={() => setSurface('plane')}
              disabled={!hasActivePlane}
              title={hasActivePlane ? 'Place onto the active build plane' : 'No active plane'}
              className={`flex-1 px-1.5 py-0.5 rounded text-micro font-medium transition-colors disabled:opacity-30 ${
                surface === 'plane' ? 'bg-cyan-400/80 text-slate-900' : 'text-white/55 hover:text-white/85'
              }`}
            >
              Plane
            </button>
            <button
              onClick={() => setSurface('free')}
              className={`flex-1 px-1.5 py-0.5 rounded text-micro font-medium transition-colors ${
                surface === 'free' ? 'bg-cyan-400/80 text-slate-900' : 'text-white/55 hover:text-white/85'
              }`}
            >
              Free
            </button>
          </div>
          {surface === 'free' && (
            <label className="flex items-center gap-1.5 text-micro text-white/60">
              <span className="w-9">Depth</span>
              <input
                type="range"
                min={5}
                max={150}
                step={1}
                value={placementDepth}
                onChange={(e) => setPlacementDepth(Number(e.target.value))}
                className="flex-1 accent-cyan-400"
              />
              <span className="w-7 tabular-nums text-right">{Math.round(placementDepth)}</span>
            </label>
          )}
        </div>
      )}
    </div>
  )
}
