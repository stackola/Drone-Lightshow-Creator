// ============================================================================
// S8-11: Keyboard Shortcut Overlay — press ? to show all shortcuts.
// Renders LIVE from the shortcut registry (src/input/shortcutRegistry), so
// the overlay can never drift from the actual bindings. The only hand-written
// section is "Inspector inputs" — those are NumberInput drag behaviors, not
// keyboard bindings.
// ============================================================================

import { useEffect, useMemo } from 'react'
import { Dialog } from './ui'
import { listShortcuts } from '../input/shortcutRegistry'

const CATEGORY_ORDER = ['File', 'History', 'Editing', 'Clipboard', 'Playback', 'Gizmo & Camera', 'Panels']

function formatChord(chord: string): string {
  return chord
    .split(' ')
    .map((part) =>
      part
        .split('+')
        .map((k) => {
          switch (k) {
            case 'ctrl': return 'Ctrl'
            case 'alt': return 'Alt'
            case 'shift': return 'Shift'
            case 'space': return 'Space'
            case 'escape': return 'Esc'
            case 'delete': return 'Del'
            case 'arrowleft': return '←'
            case 'arrowright': return '→'
            case 'arrowup': return '↑'
            case 'arrowdown': return '↓'
            default: return k.length === 1 ? k.toUpperCase() : k
          }
        })
        .join('+'),
    )
    .join(' ')
}

const INSPECTOR_TIPS: { keys: string; description: string }[] = [
  { keys: 'Drag', description: 'Scrub number value' },
  { keys: 'Shift+drag', description: 'Coarse scrub (×10)' },
  { keys: 'Alt+drag', description: 'Fine scrub (×0.1)' },
  { keys: 'Type math', description: 'e.g. "2*pi", "15+3"' },
  { keys: '↑ / ↓', description: 'Nudge by step (Shift = ×10)' },
]

interface KeyboardShortcutsOverlayProps {
  onClose: () => void
}

export function KeyboardShortcutsOverlay({ onClose }: KeyboardShortcutsOverlayProps) {
  // Dialog already closes on Escape via onClose; this handler keeps the
  // `?` toggle-to-close behavior.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === '?') {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  // Group registry bindings by category; merge chords that share a label
  // (e.g. Redo = Ctrl+Shift+Z / Ctrl+Y).
  const groups = useMemo(() => {
    const byCategory = new Map<string, Map<string, string[]>>()
    for (const def of listShortcuts()) {
      const cat = byCategory.get(def.category) ?? new Map<string, string[]>()
      const chords = cat.get(def.label) ?? []
      chords.push(formatChord(def.chord))
      cat.set(def.label, chords)
      byCategory.set(def.category, cat)
    }
    const ordered = [...byCategory.entries()].sort(
      (a, b) => CATEGORY_ORDER.indexOf(a[0]) - CATEGORY_ORDER.indexOf(b[0]),
    )
    return ordered.map(([title, labels]) => ({
      title,
      shortcuts: [...labels.entries()].map(([description, chords]) => ({
        keys: chords.join(' / '),
        description,
      })),
    }))
  }, [])

  return (
    <Dialog onClose={onClose} title="Keyboard Shortcuts" widthClassName="max-w-lg max-h-[70vh] overflow-auto">
      <div className="p-4 space-y-5">
        {groups.map((group) => (
          <div key={group.title}>
            <h3 className="text-xs font-semibold text-white/50 uppercase tracking-wider mb-2">{group.title}</h3>
            <div className="space-y-1">
              {group.shortcuts.map((s) => (
                <div key={s.description} className="flex items-center justify-between py-1 gap-4">
                  <span className="text-sm text-white/70">{s.description}</span>
                  <kbd className="text-xs bg-white/10 text-white/60 px-2 py-0.5 rounded font-mono whitespace-nowrap">{s.keys}</kbd>
                </div>
              ))}
            </div>
          </div>
        ))}
        <div>
          <h3 className="text-xs font-semibold text-white/50 uppercase tracking-wider mb-2">Inspector inputs</h3>
          <div className="space-y-1">
            {INSPECTOR_TIPS.map((s) => (
              <div key={s.keys} className="flex items-center justify-between py-1 gap-4">
                <span className="text-sm text-white/70">{s.description}</span>
                <kbd className="text-xs bg-white/10 text-white/60 px-2 py-0.5 rounded font-mono whitespace-nowrap">{s.keys}</kbd>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Dialog>
  )
}
