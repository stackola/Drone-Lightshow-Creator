// ============================================================================
// AppShell — root of the new shell ("drone-shell-next"). Owns the providers,
// app bootstrap (dialogs, crash recovery, shortcuts via useAppBootstrap),
// and the ShellLayout frame. The engine, stores and the 3D scene layer are
// the same modules the legacy shell uses; only the DOM chrome is new.
//
// Dock slot hosts the shell's TimelineDock (Phase 4 — tracks, clips,
// transitions, transport, waveform).
// ============================================================================

import { useState, useEffect, useRef } from 'react'
import { ReactFlowProvider } from '@xyflow/react'
import { ToastProvider } from '../components/Toast'
import { ErrorBoundary } from '../components/ErrorBoundary'
import { useAppBootstrap } from './bootstrap/useAppBootstrap'
import { ShellLayout } from './ShellLayout'
import { TopBar } from './topbar/TopBar'
import { StatusStrip } from './status/StatusStrip'
import { InspectorHost } from './inspector/InspectorHost'
import { AiPanel } from './ai/AiPanel'
import { SettingsDialog } from './settings/SettingsDialog'
import { usePhysicsValidation } from './physics/usePhysicsValidation'
import { PhysicsBadge, PhysicsDrawer } from './physics/PhysicsDrawer'
import { useSelectionStore } from '../stores/selectionStore'
import { ExportDialog } from '../components/ExportDialog'
import { WelcomeScreen } from '../components/WelcomeScreen'
import { KeyboardShortcutsOverlay } from '../components/KeyboardShortcutsOverlay'
import { NodeSearchPalette } from '../components/NodeSearchPalette'
import { HistoryPalette } from '../components/HistoryPalette'
import { TutorialOverlay, FeedbackButton } from '../components/Tutorial'
import { AIDialog } from '../components/AIDialog'
import { CrashRecoveryDialog } from '../components/CrashRecoveryDialog'
import { TimelineDock } from './timeline'
import { LeftRail } from './rail'

export function AppShell() {
  const { hasUnsavedChanges, markSaved, dialogs } = useAppBootstrap()
  const [aiPanelOpen, setAiPanelOpen] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [physicsOpen, setPhysicsOpen] = useState(false)

  // Always-on physics validation (worker-backed) feeds badge + drawer.
  const violations = usePhysicsValidation()

  // The AI panel is a right-column MODE: a fresh selection swaps back to
  // the inspector so clicking the stage always shows what you clicked.
  const selectionKey = useSelectionStore(
    (s) => `${s.selectedNodeIds.join(',')}|${s.selectedEdgeIds.join(',')}`,
  )
  const prevSelectionKey = useRef(selectionKey)
  useEffect(() => {
    if (selectionKey !== prevSelectionKey.current) {
      prevSelectionKey.current = selectionKey
      if (selectionKey !== '|') setAiPanelOpen(false)
    }
  }, [selectionKey])

  return (
    <ReactFlowProvider>
      <ToastProvider>
        <ShellLayout
          topBar={
            <TopBar
              hasUnsavedChanges={hasUnsavedChanges}
              onShowWelcome={() => dialogs.setShowWelcome(true)}
              onShowShortcuts={() => dialogs.setShowShortcuts(true)}
              onShowExport={() => dialogs.setShowExport(true)}
              onShowSettings={() => setShowSettings(true)}
              onMarkSaved={markSaved}
              onToggleAI={() => setAiPanelOpen((v) => !v)}
              aiOpen={aiPanelOpen}
            />
          }
          rail={<LeftRail />}
          inspector={
            <ErrorBoundary panelName="Inspector">
              {aiPanelOpen ? <AiPanel onClose={() => setAiPanelOpen(false)} /> : <InspectorHost />}
            </ErrorBoundary>
          }
          drawer={physicsOpen ? <PhysicsDrawer violations={violations} onClose={() => setPhysicsOpen(false)} /> : null}
          dock={
            <ErrorBoundary panelName="Timeline">
              <TimelineDock />
            </ErrorBoundary>
          }
          statusStrip={
            <StatusStrip
              hasUnsavedChanges={hasUnsavedChanges}
              physicsSlot={
                <PhysicsBadge violations={violations} open={physicsOpen} onClick={() => setPhysicsOpen((v) => !v)} />
              }
            />
          }
        />
        {showSettings && <SettingsDialog onClose={() => setShowSettings(false)} />}
        {dialogs.showExport && <ExportDialog onClose={() => dialogs.setShowExport(false)} />}
        {dialogs.showWelcome && <WelcomeScreen onClose={dialogs.handleCloseWelcome} />}
        {dialogs.showShortcuts && <KeyboardShortcutsOverlay onClose={() => dialogs.setShowShortcuts(false)} />}
        {dialogs.showSearch && <NodeSearchPalette onClose={() => dialogs.setShowSearch(false)} />}
        {dialogs.showHistory && <HistoryPalette onClose={() => dialogs.setShowHistory(false)} />}
        {dialogs.showTutorial && <TutorialOverlay onClose={() => dialogs.setShowTutorial(false)} />}
        {dialogs.showAI && <AIDialog onClose={() => dialogs.setShowAI(false)} />}
        <FeedbackButton />
        {dialogs.crashRecovery && (
          <CrashRecoveryDialog
            entry={dialogs.crashRecovery}
            onRestore={dialogs.handleRestoreCrash}
            onDiscard={dialogs.handleDiscardCrash}
          />
        )}
      </ToastProvider>
    </ReactFlowProvider>
  )
}
