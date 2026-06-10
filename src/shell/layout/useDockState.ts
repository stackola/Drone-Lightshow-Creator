// ============================================================================
// useDockState — persisted panel geometry for the new shell. One localStorage
// key ('shell-layout-v1', deliberately separate from the legacy 'layout-*'
// keys) holding rail/inspector widths, timeline-dock height and collapse
// flags. Sizes are clamped so a bad persisted value can't wedge the layout.
// ============================================================================

import { create } from 'zustand'

const STORAGE_KEY = 'shell-layout-v1'

interface DockGeometry {
  railPanelWidth: number
  railPanelOpen: boolean
  inspectorWidth: number
  inspectorOpen: boolean
  dockHeight: number
  dockOpen: boolean
}

interface DockState extends DockGeometry {
  /** Ctrl+\ "hide UI" — session-only, never persisted. */
  focusMode: boolean
  setRailPanelWidth: (w: number) => void
  toggleRailPanel: (open?: boolean) => void
  setInspectorWidth: (w: number) => void
  toggleInspector: (open?: boolean) => void
  setDockHeight: (h: number) => void
  toggleDock: (open?: boolean) => void
  toggleFocusMode: () => void
}

const DEFAULTS: DockGeometry = {
  railPanelWidth: 280,
  railPanelOpen: true,
  inspectorWidth: 300,
  inspectorOpen: true,
  dockHeight: 220,
  dockOpen: true,
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

function load(): DockGeometry {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULTS
    const data = JSON.parse(raw) as Partial<DockGeometry>
    return {
      ...DEFAULTS,
      ...data,
      railPanelWidth: clamp(data.railPanelWidth ?? DEFAULTS.railPanelWidth, 200, 480),
      inspectorWidth: clamp(data.inspectorWidth ?? DEFAULTS.inspectorWidth, 240, 520),
      dockHeight: clamp(data.dockHeight ?? DEFAULTS.dockHeight, 120, 480),
    }
  } catch {
    return DEFAULTS
  }
}

function persist(s: DockGeometry) {
  try {
    const { railPanelWidth, railPanelOpen, inspectorWidth, inspectorOpen, dockHeight, dockOpen } = s
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ railPanelWidth, railPanelOpen, inspectorWidth, inspectorOpen, dockHeight, dockOpen }))
  } catch {
    /* quota/privacy — ignore */
  }
}

export const useDockState = create<DockState>((set, get) => ({
  ...load(),
  focusMode: false,

  toggleFocusMode() {
    set((s) => ({ focusMode: !s.focusMode }))
  },

  setRailPanelWidth(w) {
    set({ railPanelWidth: clamp(w, 200, 480) })
    persist(get())
  },
  toggleRailPanel(open) {
    set((s) => ({ railPanelOpen: open ?? !s.railPanelOpen }))
    persist(get())
  },
  setInspectorWidth(w) {
    set({ inspectorWidth: clamp(w, 240, 520) })
    persist(get())
  },
  toggleInspector(open) {
    set((s) => ({ inspectorOpen: open ?? !s.inspectorOpen }))
    persist(get())
  },
  setDockHeight(h) {
    set({ dockHeight: clamp(h, 120, 480) })
    persist(get())
  },
  toggleDock(open) {
    set((s) => ({ dockOpen: open ?? !s.dockOpen }))
    persist(get())
  },
}))
