// ============================================================================
// View Switcher — polished floating control for build-mode views + an
// active-plane chip. Game-like segmented pill, not a dev toolbar.
// ============================================================================

import { Box, Eye, Square, LayoutGrid } from 'lucide-react'
import { useUiModeStore, type ViewId } from '../../stores/uiModeStore'
import { usePlanesStore } from '../../stores/planesStore'

const VIEWS: Array<{ id: ViewId; label: string; Icon: typeof Box }> = [
  { id: 'iso', label: 'Isometric', Icon: Box },
  { id: 'perspective', label: 'Perspective', Icon: Eye },
  { id: 'top', label: 'Top', Icon: LayoutGrid },
  { id: 'front', label: 'Front', Icon: Square },
]

export function ViewSwitcher() {
  const viewId = useUiModeStore((s) => s.viewId)
  const setView = useUiModeStore((s) => s.setView)
  const activePlane = usePlanesStore((s) => s.planes.find((p) => p.id === s.activePlaneId))

  return (
    <div className="absolute top-3 left-1/2 -translate-x-1/2 z-10 flex flex-col items-center gap-1.5 pointer-events-none">
      <div
        data-testid="view-switcher"
        className="floating-panel pointer-events-auto flex items-center gap-0.5 !rounded-full p-1"
      >
        {VIEWS.map(({ id, label, Icon }) => {
          const active = id === viewId
          return (
            <button
              key={id}
              title={label}
              onClick={() => setView(id)}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-caption font-medium transition-all active:scale-95 ${
                active
                  ? 'bg-cyan-400/90 text-slate-900 shadow shadow-cyan-500/30'
                  : 'text-white/55 hover:text-white/90 hover:bg-white/5'
              }`}
            >
              <Icon size={13} />
              {active && <span>{label}</span>}
            </button>
          )
        })}
      </div>
      {activePlane && (
        <div className="floating-panel pointer-events-none !rounded-full px-2 py-0.5 text-micro text-white/55">
          Editing: <span className="text-cyan-300">{activePlane.name}</span>
        </div>
      )}
    </div>
  )
}
