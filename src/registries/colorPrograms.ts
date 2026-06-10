// ============================================================================
// S10-09/17: Default Color Program Registration
// ============================================================================
// Registers built-in color programs so the picker has options available.
// ============================================================================

import {
  registerColorProgram,
  type SolidColorProgram,
  type GradientColorProgram,
  type MultiStopGradientColorProgram,
  type RainbowColorProgram,
  type PulseColorProgram,
  type ChaseColorProgram,
  type SweepColorProgram,
} from '../graph/colorPrograms'

export function registerDefaultColorPrograms(): void {
  registerColorProgram({
    id: 'solid-white',
    name: 'Solid White',
    type: 'solid',
    color: { r: 1, g: 1, b: 1 },
  } as SolidColorProgram)

  registerColorProgram({
    id: 'solid-red',
    name: 'Solid Red',
    type: 'solid',
    color: { r: 1, g: 0.2, b: 0.2 },
  } as SolidColorProgram)

  registerColorProgram({
    id: 'solid-blue',
    name: 'Solid Blue',
    type: 'solid',
    color: { r: 0.2, g: 0.4, b: 1 },
  } as SolidColorProgram)

  registerColorProgram({
    id: 'solid-green',
    name: 'Solid Green',
    type: 'solid',
    color: { r: 0.2, g: 1, b: 0.4 },
  } as SolidColorProgram)

  registerColorProgram({
    id: 'gradient-blue-red',
    name: 'Gradient Blue→Red',
    type: 'gradient',
    colorStart: { r: 0.2, g: 0.4, b: 1 },
    colorEnd: { r: 1, g: 0.2, b: 0.2 },
    axis: 'y',
  } as GradientColorProgram)

  registerColorProgram({
    id: 'gradient-warm',
    name: 'Gradient Warm',
    type: 'gradient',
    colorStart: { r: 1, g: 0.8, b: 0.2 },
    colorEnd: { r: 1, g: 0.2, b: 0.4 },
    axis: 'x',
  } as GradientColorProgram)

  registerColorProgram({
    id: 'rainbow',
    name: 'Rainbow',
    type: 'rainbow',
    mode: 'spatial',
    axis: 'x',
    saturation: 1,
    brightness: 1,
    speed: 0.2,
  } as RainbowColorProgram)

  registerColorProgram({
    id: 'rainbow-index',
    name: 'Rainbow (by Index)',
    type: 'rainbow',
    mode: 'index',
    axis: 'x',
    saturation: 1,
    brightness: 1,
    speed: 0.1,
  } as RainbowColorProgram)

  registerColorProgram({
    id: 'pulse-white',
    name: 'Pulse White',
    type: 'pulse',
    color: { r: 1, g: 1, b: 1 },
    frequency: 1,
    amplitude: 0.8,
    minBrightness: 0.2,
  } as PulseColorProgram)

  registerColorProgram({
    id: 'chase-rgb',
    name: 'Chase RGB',
    type: 'chase',
    colors: [{ r: 1, g: 0, b: 0 }, { r: 0, g: 1, b: 0 }, { r: 0, g: 0, b: 1 }],
    speed: 0.5,
    width: 5,
  } as ChaseColorProgram)

  registerColorProgram({
    id: 'sweep-cyan-magenta',
    name: 'Sweep Cyan→Magenta',
    type: 'sweep',
    colorFrom: { r: 0.1, g: 0.9, b: 1 },
    colorTo: { r: 1, g: 0.1, b: 0.9 },
    speed: 1,
    direction: { x: 1, y: 0, z: 0 },
  } as SweepColorProgram)

  // S6 — multi-stop gradient presets.
  registerColorProgram({
    id: 'multi-sunset',
    name: 'Multi: Sunset',
    type: 'multi-gradient',
    axis: 'y',
    stops: [
      { t: 0.0, color: { r: 0.15, g: 0.05, b: 0.25 } },  // deep violet
      { t: 0.35, color: { r: 1.0, g: 0.45, b: 0.25 } },  // orange
      { t: 0.7, color: { r: 1.0, g: 0.85, b: 0.4 } },    // amber
      { t: 1.0, color: { r: 0.6, g: 0.9, b: 1.0 } },     // sky blue
    ],
  } as MultiStopGradientColorProgram)

  registerColorProgram({
    id: 'multi-rgb',
    name: 'Multi: RGB',
    type: 'multi-gradient',
    axis: 'x',
    stops: [
      { t: 0.0, color: { r: 1, g: 0, b: 0 } },
      { t: 0.5, color: { r: 0, g: 1, b: 0 } },
      { t: 1.0, color: { r: 0, g: 0, b: 1 } },
    ],
  } as MultiStopGradientColorProgram)
}
