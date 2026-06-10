// ============================================================================
// UI color constants — the single TS source for accent colors used OUTSIDE
// Tailwind classes (Three.js materials, SVG strokes, canvas drawing).
// DOM elements should use the Tailwind tokens (accent-primary,
// accent-transition, …) which resolve from the CSS variables in index.css;
// these constants mirror those values for non-CSS consumers.
// ============================================================================

/** cyan-400 — primary accent: selection, active handles, snap guides. */
export const ACCENT_PRIMARY = '#22d3ee'
/** cyan-700 — dark companion for outlines on primary-accent fills. */
export const ACCENT_PRIMARY_DEEP = '#0e7490'
/** fuchsia-500 — transitions (timeline segments, 3D transition pills). */
export const ACCENT_TRANSITION = '#d946ef'
/** yellow-400 — highlighted / keyed state (selected keyframes, playhead). */
export const ACCENT_HIGHLIGHT = '#facc15'

/** Node-type palette shared by the graph canvas, minimap and previews. */
export const NODE_TYPE_COLORS: Record<string, string> = {
  launch: '#10b981',
  formation: '#3b82f6',
  transition: '#a855f7',
  idle: '#f59e0b',
  land: '#ef4444',
  group: '#64748b',
}

/** Per-axis colors — the standard 3D convention (X red, Y green, Z blue),
 * with rotation/scale lanes shifted in hue so all nine lanes stay legible. */
export const AXIS_LANE_COLORS = {
  'pos-x': '#ef4444',
  'pos-y': '#22c55e',
  'pos-z': '#3b82f6',
  'rot-x': '#f97316',
  'rot-y': '#a855f7',
  'rot-z': '#ec4899',
  'scale-x': '#14b8a6',
  'scale-y': '#eab308',
  'scale-z': '#64748b',
} as const
