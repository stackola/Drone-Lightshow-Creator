// ============================================================================
// ShellLayout — the new shell's frame, floating-panel ("UI3") paradigm:
//   TopBar
//   full-bleed Stage, with the LeftRail and Inspector FLOATING over it as
//   glass cards (the .floating-panel language Build mode established),
//   GraphSheet sliding over the stage,
//   docked TimelineDock + StatusStrip below.
// Ctrl+\ toggles focus mode (hides the floating cards + dock) via the
// 'toggle-ui-focus' event registered in the shortcut registry.
// ============================================================================

import { useEffect, type ReactNode } from 'react'
import { useDockState } from './layout/useDockState'
import { PanelResizer } from './layout/PanelResizer'
import { Stage } from './stage/Stage'
import { GraphSheet } from './graph/GraphSheet'

export interface ShellLayoutProps {
  topBar: ReactNode
  rail: ReactNode
  inspector: ReactNode
  dock: ReactNode
  statusStrip: ReactNode
  /** Optional drawer between the stage and the dock (physics validation). */
  drawer?: ReactNode
}

export function ShellLayout({ topBar, rail, inspector, dock, statusStrip, drawer }: ShellLayoutProps) {
  const inspectorWidth = useDockState((s) => s.inspectorWidth)
  const inspectorOpen = useDockState((s) => s.inspectorOpen)
  const dockHeight = useDockState((s) => s.dockHeight)
  const dockOpen = useDockState((s) => s.dockOpen)
  const setDockHeight = useDockState((s) => s.setDockHeight)
  const focusMode = useDockState((s) => s.focusMode)
  const toggleFocusMode = useDockState((s) => s.toggleFocusMode)

  // Ctrl+\ (registered in editorBindings) → hide/show the UI.
  useEffect(() => {
    const onToggle = () => toggleFocusMode()
    window.addEventListener('toggle-ui-focus', onToggle)
    return () => window.removeEventListener('toggle-ui-focus', onToggle)
  }, [toggleFocusMode])

  const showChrome = !focusMode

  return (
    <div className="h-full flex flex-col bg-surface" data-testid="app-shell">
      {topBar}
      <div className="flex-1 min-h-0 relative">
        {/* Full-bleed stage */}
        <div className="absolute inset-0">
          <Stage />
        </div>
        <GraphSheet />
        {/* Floating left rail */}
        {showChrome && (
          <div className="absolute left-3 top-3 bottom-3 z-20 flex pointer-events-none" data-testid="left-rail">
            <div className="pointer-events-auto flex max-h-full">{rail}</div>
          </div>
        )}
        {/* Floating inspector */}
        {showChrome && inspectorOpen && (
          <div
            className="absolute right-3 top-3 bottom-3 z-20 pointer-events-none flex"
            style={{ width: inspectorWidth }}
            data-testid="inspector-card"
          >
            <div className="pointer-events-auto floating-panel w-full max-h-full overflow-hidden flex flex-col animate-panel-in">
              {inspector}
            </div>
          </div>
        )}
      </div>
      {showChrome && drawer}
      {showChrome && dockOpen && (
        <>
          <PanelResizer direction="vertical" onResize={(d) => setDockHeight(dockHeight - d)} />
          <div className="flex-shrink-0 border-t border-white/10 bg-surface-raised/50" style={{ height: dockHeight }}>
            {dock}
          </div>
        </>
      )}
      {statusStrip}
    </div>
  )
}
