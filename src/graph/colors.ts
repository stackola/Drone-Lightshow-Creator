// ============================================================================
// Shared Color3 Type + Named Constants
// ============================================================================

export interface Color3 {
  r: number
  g: number
  b: number
}

// --- Semantic color constants used throughout evaluation ---

export const COLOR_WHITE: Color3 = { r: 1, g: 1, b: 1 }
export const COLOR_FORMATION: Color3 = { r: 0.3, g: 0.5, b: 1 }
export const COLOR_TRANSITION: Color3 = { r: 0.7, g: 0.3, b: 1 }
export const COLOR_IDLE: Color3 = { r: 1, g: 0.6, b: 0 }
export const COLOR_LAUNCH: Color3 = { r: 0, g: 0.5, b: 0.5 }
export const COLOR_LAND_START: Color3 = { r: 1, g: 0.3, b: 0.3 }

/** Lerp two Color3 values */
export function lerpColor(a: Color3, b: Color3, t: number): Color3 {
  return {
    r: a.r + (b.r - a.r) * t,
    g: a.g + (b.g - a.g) * t,
    b: a.b + (b.b - a.b) * t,
  }
}
