// ============================================================================
// useAppBootstrap — shell-agnostic app lifecycle, copied from legacy
// app/App.tsx for the shell rebuild (the legacy file stays untouched until
// cutover, when this becomes the single source). Owns: dialog open-state,
// command-palette CustomEvents, crash recovery, welcome/seed flow, the
// shortcut-registry install, and the document title.
// ============================================================================

import { useState, useEffect, useCallback } from 'react'
import { useGraphStore } from '../../stores/graphStore'
import { useProjectStore } from '../../stores/projectStore'
import { useAutosave } from '../../hooks/useAutosave'
import { checkForCrashRecovery, clearAutosaves, type AutosaveEntry } from '../../services/autosave'
import { loadProjectFromJSON, saveProject, saveProjectAs, loadProjectFromFile } from '../../services/projectIO'
import { seedCinematic } from '../../app/demos/cinematic'
import { shouldShowTutorial } from '../../components/Tutorial'
import { installEditorShortcuts } from '../../input/editorBindings'
import { toast } from '../../components/Toast'

export function useAppBootstrap() {
  const [showWelcome, setShowWelcome] = useState(false)
  const [showShortcuts, setShowShortcuts] = useState(false)
  const [showExport, setShowExport] = useState(false)
  const [showSearch, setShowSearch] = useState(false)
  const [showTutorial, setShowTutorial] = useState(false)
  const [showAI, setShowAI] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [crashRecovery, setCrashRecovery] = useState<AutosaveEntry | null>(null)

  const { hasUnsavedChanges, markSaved } = useAutosave()

  // Command palette → dialog events.
  useEffect(() => {
    const onExport = () => setShowExport(true)
    const onAI = () => setShowAI(true)
    const onHistory = () => setShowHistory(true)
    window.addEventListener('open-export-dialog', onExport)
    window.addEventListener('open-ai-dialog', onAI)
    window.addEventListener('open-history-palette', onHistory)
    return () => {
      window.removeEventListener('open-export-dialog', onExport)
      window.removeEventListener('open-ai-dialog', onAI)
      window.removeEventListener('open-history-palette', onHistory)
    }
  }, [])

  // First mount: crash recovery, else welcome on an empty graph.
  useEffect(() => {
    let mounted = true
    checkForCrashRecovery()
      .then((entry) => {
        if (mounted && entry) {
          setCrashRecovery(entry)
        } else if (mounted && useGraphStore.getState().nodes.length === 0) {
          setShowWelcome(true)
        }
      })
      .catch(() => {
        if (mounted && useGraphStore.getState().nodes.length === 0) {
          seedCinematic()
        }
      })
    return () => { mounted = false }
  }, [])

  const handleRestoreCrash = useCallback(() => {
    if (crashRecovery) {
      loadProjectFromJSON(crashRecovery.json)
      clearAutosaves().catch(() => {})
      markSaved()
    }
    setCrashRecovery(null)
  }, [crashRecovery, markSaved])

  const handleDiscardCrash = useCallback(() => {
    clearAutosaves().catch(() => {})
    setCrashRecovery(null)
    if (useGraphStore.getState().nodes.length === 0) {
      setShowWelcome(true)
    }
  }, [])

  const handleCloseWelcome = useCallback(() => {
    setShowWelcome(false)
    if (useGraphStore.getState().nodes.length === 0) {
      seedCinematic()
    }
    markSaved()
    if (shouldShowTutorial()) {
      setShowTutorial(true)
    }
  }, [markSaved])

  // Keyboard input — the registry-backed listener (src/input/editorBindings).
  useEffect(() => {
    return installEditorShortcuts({
      save: () => {
        saveProject()
        markSaved()
      },
      saveAs: () => {
        const name = prompt('Save as:', useProjectStore.getState().meta.name)
        if (name?.trim()) {
          saveProjectAs(name.trim())
          markSaved()
        }
      },
      openFile: () => {
        loadProjectFromFile()
          .then(() => markSaved())
          .catch((err: unknown) => {
            if (err instanceof DOMException && err.name === 'AbortError') return
            toast.error(`Failed to open project: ${err instanceof Error ? err.message : 'Unknown error'}`)
          })
      },
      showExport: () => setShowExport(true),
      toggleSearch: () => setShowSearch((v) => !v),
      toggleHistory: () => setShowHistory((v) => !v),
      toggleShortcutsOverlay: () => setShowShortcuts((v) => !v),
    })
  }, [markSaved])

  // Document title with unsaved indicator.
  useEffect(() => {
    const name = useProjectStore.getState().meta.name
    document.title = (hasUnsavedChanges ? '• ' : '') + name + ' — Drone Show Designer'
  })

  return {
    hasUnsavedChanges,
    markSaved,
    dialogs: {
      showWelcome, setShowWelcome, handleCloseWelcome,
      showShortcuts, setShowShortcuts,
      showExport, setShowExport,
      showSearch, setShowSearch,
      showTutorial, setShowTutorial,
      showAI, setShowAI,
      showHistory, setShowHistory,
      crashRecovery, handleRestoreCrash, handleDiscardCrash,
    },
  }
}
