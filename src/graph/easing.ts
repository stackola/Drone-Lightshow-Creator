// ============================================================================
// Shared Easing Functions — Full Library
// ============================================================================
// S10-01: Polynomial easings (cubic, quartic, quintic — in/out/in-out = 12)
// S10-02: Physics-based easings (sine, exponential, circular — 9)
// S10-03: Oscillatory easings (elastic, bounce, back — 9)
// S10-04: Spring easing (damped harmonic oscillator)
// S10-05: Custom cubic-bezier easing
// ============================================================================

export type EasingType =
  | 'linear'
  // Quadratic (existing)
  | 'ease-in' | 'ease-out' | 'ease-in-out'
  // S10-01: Polynomial
  | 'ease-in-cubic' | 'ease-out-cubic' | 'ease-in-out-cubic'
  | 'ease-in-quartic' | 'ease-out-quartic' | 'ease-in-out-quartic'
  | 'ease-in-quintic' | 'ease-out-quintic' | 'ease-in-out-quintic'
  // S10-02: Physics-based
  | 'ease-in-sine' | 'ease-out-sine' | 'ease-in-out-sine'
  | 'ease-in-expo' | 'ease-out-expo' | 'ease-in-out-expo'
  | 'ease-in-circ' | 'ease-out-circ' | 'ease-in-out-circ'
  // S10-03: Oscillatory
  | 'ease-in-elastic' | 'ease-out-elastic' | 'ease-in-out-elastic'
  | 'ease-in-bounce' | 'ease-out-bounce' | 'ease-in-out-bounce'
  | 'ease-in-back' | 'ease-out-back' | 'ease-in-out-back'
  // S10-04: Spring
  | 'spring'
  // S10-05 wiring (2026-05-21): user-defined cubic-bezier curve.
  // The four control-point values live on the keyframe's `bezierConfig` field.
  | 'cubic-bezier'

export type EasingTypeWithStep = EasingType | 'step'

// S10-04: Spring configuration
export interface SpringConfig {
  tension: number   // default 170
  friction: number  // default 26
}

const DEFAULT_SPRING: SpringConfig = { tension: 170, friction: 26 }

// S10-05: Cubic bezier control points
export interface CubicBezierConfig {
  x1: number
  y1: number
  x2: number
  y2: number
}

/** All easing type IDs for UI dropdowns */
export const EASING_TYPES: { id: EasingType; label: string; group: string }[] = [
  { id: 'linear', label: 'Linear', group: 'Basic' },
  { id: 'ease-in', label: 'Ease In (Quad)', group: 'Basic' },
  { id: 'ease-out', label: 'Ease Out (Quad)', group: 'Basic' },
  { id: 'ease-in-out', label: 'Ease In-Out (Quad)', group: 'Basic' },
  // Polynomial
  { id: 'ease-in-cubic', label: 'Ease In Cubic', group: 'Polynomial' },
  { id: 'ease-out-cubic', label: 'Ease Out Cubic', group: 'Polynomial' },
  { id: 'ease-in-out-cubic', label: 'Ease In-Out Cubic', group: 'Polynomial' },
  { id: 'ease-in-quartic', label: 'Ease In Quartic', group: 'Polynomial' },
  { id: 'ease-out-quartic', label: 'Ease Out Quartic', group: 'Polynomial' },
  { id: 'ease-in-out-quartic', label: 'Ease In-Out Quartic', group: 'Polynomial' },
  { id: 'ease-in-quintic', label: 'Ease In Quintic', group: 'Polynomial' },
  { id: 'ease-out-quintic', label: 'Ease Out Quintic', group: 'Polynomial' },
  { id: 'ease-in-out-quintic', label: 'Ease In-Out Quintic', group: 'Polynomial' },
  // Physics
  { id: 'ease-in-sine', label: 'Ease In Sine', group: 'Physics' },
  { id: 'ease-out-sine', label: 'Ease Out Sine', group: 'Physics' },
  { id: 'ease-in-out-sine', label: 'Ease In-Out Sine', group: 'Physics' },
  { id: 'ease-in-expo', label: 'Ease In Expo', group: 'Physics' },
  { id: 'ease-out-expo', label: 'Ease Out Expo', group: 'Physics' },
  { id: 'ease-in-out-expo', label: 'Ease In-Out Expo', group: 'Physics' },
  { id: 'ease-in-circ', label: 'Ease In Circ', group: 'Physics' },
  { id: 'ease-out-circ', label: 'Ease Out Circ', group: 'Physics' },
  { id: 'ease-in-out-circ', label: 'Ease In-Out Circ', group: 'Physics' },
  // Oscillatory
  { id: 'ease-in-elastic', label: 'Ease In Elastic', group: 'Oscillatory' },
  { id: 'ease-out-elastic', label: 'Ease Out Elastic', group: 'Oscillatory' },
  { id: 'ease-in-out-elastic', label: 'Ease In-Out Elastic', group: 'Oscillatory' },
  { id: 'ease-in-bounce', label: 'Ease In Bounce', group: 'Oscillatory' },
  { id: 'ease-out-bounce', label: 'Ease Out Bounce', group: 'Oscillatory' },
  { id: 'ease-in-out-bounce', label: 'Ease In-Out Bounce', group: 'Oscillatory' },
  { id: 'ease-in-back', label: 'Ease In Back', group: 'Oscillatory' },
  { id: 'ease-out-back', label: 'Ease Out Back', group: 'Oscillatory' },
  { id: 'ease-in-out-back', label: 'Ease In-Out Back', group: 'Oscillatory' },
  // Spring
  { id: 'spring', label: 'Spring', group: 'Spring' },
  // Custom curve — the EasingSelect popover renders a draggable Bézier editor for this option.
  { id: 'cubic-bezier', label: 'Custom Bézier', group: 'Custom' },
]

/** Default Bézier control points (matches CSS `ease`). */
export const DEFAULT_BEZIER: CubicBezierConfig = { x1: 0.25, y1: 0.1, x2: 0.25, y2: 1 }

/** Apply easing to a [0,1] t value */
export function applyEasing(
  t: number,
  easing: EasingType,
  springConfig?: SpringConfig,
  bezierConfig?: CubicBezierConfig,
): number {
  const c = Math.max(0, Math.min(1, t))
  if (easing === 'cubic-bezier') {
    return cubicBezierEasing(c, bezierConfig ?? DEFAULT_BEZIER)
  }
  switch (easing) {
    // --- Basic (quadratic) ---
    case 'linear': return c
    case 'ease-in': return c * c
    case 'ease-out': return 1 - (1 - c) * (1 - c)
    case 'ease-in-out': return c < 0.5 ? 2 * c * c : 1 - Math.pow(-2 * c + 2, 2) / 2

    // --- S10-01: Polynomial ---
    case 'ease-in-cubic': return c * c * c
    case 'ease-out-cubic': return 1 - Math.pow(1 - c, 3)
    case 'ease-in-out-cubic': return c < 0.5 ? 4 * c * c * c : 1 - Math.pow(-2 * c + 2, 3) / 2
    case 'ease-in-quartic': return c * c * c * c
    case 'ease-out-quartic': return 1 - Math.pow(1 - c, 4)
    case 'ease-in-out-quartic': return c < 0.5 ? 8 * c * c * c * c : 1 - Math.pow(-2 * c + 2, 4) / 2
    case 'ease-in-quintic': return c * c * c * c * c
    case 'ease-out-quintic': return 1 - Math.pow(1 - c, 5)
    case 'ease-in-out-quintic': return c < 0.5 ? 16 * c * c * c * c * c : 1 - Math.pow(-2 * c + 2, 5) / 2

    // --- S10-02: Physics-based ---
    case 'ease-in-sine': return 1 - Math.cos((c * Math.PI) / 2)
    case 'ease-out-sine': return Math.sin((c * Math.PI) / 2)
    case 'ease-in-out-sine': return -(Math.cos(Math.PI * c) - 1) / 2
    case 'ease-in-expo': return c === 0 ? 0 : Math.pow(2, 10 * c - 10)
    case 'ease-out-expo': return c === 1 ? 1 : 1 - Math.pow(2, -10 * c)
    case 'ease-in-out-expo':
      if (c === 0) return 0
      if (c === 1) return 1
      return c < 0.5 ? Math.pow(2, 20 * c - 10) / 2 : (2 - Math.pow(2, -20 * c + 10)) / 2
    case 'ease-in-circ': return 1 - Math.sqrt(1 - Math.pow(c, 2))
    case 'ease-out-circ': return Math.sqrt(1 - Math.pow(c - 1, 2))
    case 'ease-in-out-circ':
      return c < 0.5
        ? (1 - Math.sqrt(1 - Math.pow(2 * c, 2))) / 2
        : (Math.sqrt(1 - Math.pow(-2 * c + 2, 2)) + 1) / 2

    // --- S10-03: Oscillatory ---
    case 'ease-in-elastic': {
      if (c === 0 || c === 1) return c
      return -Math.pow(2, 10 * c - 10) * Math.sin((c * 10 - 10.75) * ((2 * Math.PI) / 3))
    }
    case 'ease-out-elastic': {
      if (c === 0 || c === 1) return c
      return Math.pow(2, -10 * c) * Math.sin((c * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1
    }
    case 'ease-in-out-elastic': {
      if (c === 0 || c === 1) return c
      return c < 0.5
        ? -(Math.pow(2, 20 * c - 10) * Math.sin((20 * c - 11.125) * ((2 * Math.PI) / 4.5))) / 2
        : (Math.pow(2, -20 * c + 10) * Math.sin((20 * c - 11.125) * ((2 * Math.PI) / 4.5))) / 2 + 1
    }
    case 'ease-in-bounce': return 1 - bounceOut(1 - c)
    case 'ease-out-bounce': return bounceOut(c)
    case 'ease-in-out-bounce':
      return c < 0.5
        ? (1 - bounceOut(1 - 2 * c)) / 2
        : (1 + bounceOut(2 * c - 1)) / 2
    case 'ease-in-back': {
      const s = 1.70158
      return (s + 1) * c * c * c - s * c * c
    }
    case 'ease-out-back': {
      const s = 1.70158
      return 1 + (s + 1) * Math.pow(c - 1, 3) + s * Math.pow(c - 1, 2)
    }
    case 'ease-in-out-back': {
      const s = 1.70158 * 1.525
      return c < 0.5
        ? (Math.pow(2 * c, 2) * ((s + 1) * 2 * c - s)) / 2
        : (Math.pow(2 * c - 2, 2) * ((s + 1) * (c * 2 - 2) + s) + 2) / 2
    }

    // --- S10-04: Spring ---
    case 'spring': return springEasing(c, springConfig ?? DEFAULT_SPRING)

    default: return c
  }
}

function bounceOut(t: number): number {
  if (t < 1 / 2.75) return 7.5625 * t * t
  if (t < 2 / 2.75) { const t2 = t - 1.5 / 2.75; return 7.5625 * t2 * t2 + 0.75 }
  if (t < 2.5 / 2.75) { const t2 = t - 2.25 / 2.75; return 7.5625 * t2 * t2 + 0.9375 }
  const t2 = t - 2.625 / 2.75; return 7.5625 * t2 * t2 + 0.984375
}

/**
 * S10-04: Damped harmonic oscillator spring easing.
 * Simulates a spring with given tension and friction.
 */
function springEasing(t: number, config: SpringConfig): number {
  const { tension, friction } = config
  const omega = Math.sqrt(tension)
  const zeta = friction / (2 * omega)

  if (zeta < 1) {
    // Underdamped
    const omegaD = omega * Math.sqrt(1 - zeta * zeta)
    return 1 - Math.exp(-zeta * omega * t * 6) *
      (Math.cos(omegaD * t * 6) + (zeta * omega / omegaD) * Math.sin(omegaD * t * 6))
  } else {
    // Critically/overdamped
    return 1 - (1 + omega * t * 6) * Math.exp(-omega * t * 6)
  }
}

/**
 * S10-05: Cubic bezier easing — evaluates cubic-bezier(x1, y1, x2, y2) at t.
 * Uses Newton-Raphson iteration to find the x parameter, then evaluates y.
 */
export function cubicBezierEasing(t: number, config: CubicBezierConfig): number {
  const { x1, y1, x2, y2 } = config
  if (t <= 0) return 0
  if (t >= 1) return 1

  // Find parameter u such that bezierX(u) = t using Newton-Raphson
  let u = t
  for (let i = 0; i < 8; i++) {
    const x = bezier(u, x1, x2) - t
    if (Math.abs(x) < 1e-6) break
    const dx = bezierDeriv(u, x1, x2)
    if (Math.abs(dx) < 1e-6) break
    u -= x / dx
  }
  u = Math.max(0, Math.min(1, u))

  return bezier(u, y1, y2)
}

function bezier(t: number, p1: number, p2: number): number {
  // B(t) = 3(1-t)²t·p1 + 3(1-t)t²·p2 + t³
  return 3 * (1 - t) * (1 - t) * t * p1 + 3 * (1 - t) * t * t * p2 + t * t * t
}

function bezierDeriv(t: number, p1: number, p2: number): number {
  return 3 * (1 - t) * (1 - t) * p1 + 6 * (1 - t) * t * (p2 - p1) + 3 * t * t * (1 - p2)
}

/** Apply easing with step support (holds previous value until next keyframe) */
export function applyEasingWithStep(t: number, easing: EasingTypeWithStep): number {
  if (easing === 'step') return 0
  return applyEasing(t, easing)
}
