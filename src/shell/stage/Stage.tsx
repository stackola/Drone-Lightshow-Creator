// ============================================================================
// Stage — the shell's full-bleed 3D editing surface. Composes the LIFTED
// scene layer (Canvas + CameraRig + SceneContents) with the lifted HUD
// overlays and DnD plumbing from the legacy BuildViewport, minus the bottom
// timeline/transport chrome (those live in the shell's TimelineDock).
// Splits with the audience viewport when the audience panel is open.
// ============================================================================

import { useEffect, Suspense } from 'react'
import { Canvas } from '@react-three/fiber'
import { ErrorBoundary } from '../../components/ErrorBoundary'
import { SceneContents, GizmoToolbar } from '../../components/viewport/Viewport3D'
import { CameraRig } from '../../components/viewport/CameraRig'
import { ViewSwitcher } from '../../components/viewport/ViewSwitcher'
import { BuildEmptyState } from '../../components/viewport/BuildEmptyState'
import { ManipulationHint } from '../../components/viewport/manipulation/manipulationKit'
import { MasterEditBanner } from '../../components/viewport/MasterEditBanner'
import { SnapPlanePopover } from '../../components/viewport/SnapPlanePopover'
import { ViewportSettingsButton, StatsHUD } from '../../components/viewport/ViewportOverlays'
import { useViewportContextMenu } from '../../components/viewport/ViewportContextMenu'
import { AudienceViewport } from '../../components/viewport/audience/AudienceViewport'
import { useUiModeStore, VIEW_DEFS } from '../../stores/uiModeStore'
import { usePlanesStore } from '../../stores/planesStore'
import { useViewStore } from '../../stores/viewStore'
import { setDragCursor, endFormationDrag } from '../../components/viewport/dragPreview'

function StageFallback() {
  return (
    <div className="h-full flex flex-col items-center justify-center gap-3 animate-fade-in">
      <div className="flex items-end gap-1.5">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="w-1.5 h-1.5 rounded-full bg-accent-primary/80 animate-pulse-slow"
            style={{ animationDelay: `${i * 220}ms` }}
          />
        ))}
      </div>
      <div className="text-white/30 text-xs tracking-wide">Preparing the stage…</div>
    </div>
  )
}

function EditorStage() {
  const viewId = useUiModeStore((s) => s.viewId)
  const { onContextMenu, onPointerDown, menu } = useViewportContextMenu()

  // View → default editing plane (lifted from BuildViewport).
  useEffect(() => {
    usePlanesStore.getState().setActivePlaneByKind(VIEW_DEFS[viewId].defaultPlaneKind)
  }, [viewId])

  return (
    <div className="viewport-3d-container w-full h-full bg-surface flex flex-col">
      <div
        className="flex-1 min-h-0 relative"
        onContextMenu={onContextMenu}
        onPointerDown={onPointerDown}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes('application/droneshow-formation')) {
            e.preventDefault()
            e.dataTransfer.dropEffect = 'copy'
            setDragCursor(e.clientX, e.clientY)
          }
        }}
        onDrop={(e) => {
          const formationId = e.dataTransfer.getData('application/droneshow-formation')
          endFormationDrag()
          if (!formationId) return
          e.preventDefault()
          window.dispatchEvent(
            new CustomEvent('plane-drop', {
              detail: { clientX: e.clientX, clientY: e.clientY, formationId },
            }),
          )
        }}
      >
        <ViewSwitcher />
        <BuildEmptyState />
        <ManipulationHint />
        <MasterEditBanner />
        <GizmoToolbar />
        <ViewportSettingsButton />
        <SnapPlanePopover />
        <StatsHUD />
        {menu}
        <Canvas dpr={[1, 2]}>
          <CameraRig />
          <SceneContents />
        </Canvas>
      </div>
    </div>
  )
}

function AudienceStage() {
  return (
    <div
      className="relative w-full h-full"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('application/droneshow-formation')) {
          e.preventDefault()
          e.dataTransfer.dropEffect = 'copy'
        }
      }}
      onDrop={(e) => {
        const formationId = e.dataTransfer.getData('application/droneshow-formation')
        if (!formationId) return
        e.preventDefault()
        window.dispatchEvent(
          new CustomEvent('audience-plane-drop', {
            detail: { clientX: e.clientX, clientY: e.clientY, formationId },
          }),
        )
      }}
    >
      <AudienceViewport />
    </div>
  )
}

export function Stage() {
  const audienceOpen = useViewStore((s) => s.audience.panelOpen)

  return (
    <div className="w-full h-full flex">
      <div className="h-full min-w-0" style={{ width: audienceOpen ? '50%' : '100%' }}>
        <ErrorBoundary panelName="3D Stage">
          <Suspense fallback={<StageFallback />}>
            <EditorStage />
          </Suspense>
        </ErrorBoundary>
      </div>
      {audienceOpen && (
        <div className="h-full min-w-0 border-l border-white/10" style={{ width: '50%' }}>
          <ErrorBoundary panelName="Audience View">
            <Suspense fallback={<StageFallback />}>
              <AudienceStage />
            </Suspense>
          </ErrorBoundary>
        </div>
      )}
    </div>
  )
}
