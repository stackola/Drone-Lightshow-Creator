// ============================================================================
// Registry Initialization — Ensure all registries are populated
// ============================================================================

// Ensure generators, transitions, idle behaviors, and formation library are registered
import './generators'
import './transitions'
import './idleBehaviors'
import './formationLibrary'
import { registerS11Transitions } from './transitionStrategies'
import { registerDefaultColorPrograms } from './colorPrograms'
import { loadColorPresetsFromStorage } from '../graph/colorPrograms'

export function initRegistries(): void {
  // Side-effect imports above register all built-in definitions.
  registerS11Transitions()
  registerDefaultColorPrograms()
  // Bundle 7: load any user-saved color presets from localStorage
  loadColorPresetsFromStorage()
}
