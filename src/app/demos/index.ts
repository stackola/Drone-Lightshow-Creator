// ============================================================================
// Slice 3: Demo registry — single source of truth for all curated demos.
// WelcomeScreen reads this list; demos.test.ts validates every demo passes
// physics + asserts every transition / idle / generator / color / animated
// formation appears in at least one demo (coverage regression gate).
// ============================================================================

import { seedPulseTest } from './pulseTest'
import { seedCountdown } from './countdown'
import { seedGalaxy } from './galaxy'
import { seedFireworks } from './fireworks'
import { seedHeartbeat } from './heartbeat'
import { seedLogoReveal } from './logoReveal'
import { seedSplitStory } from './splitStory'
import { seedCinematic } from './cinematic'

export type DemoTheme =
  | 'minimalist'
  | 'narrative'
  | 'festive'
  | 'romantic'
  | 'branded'
  | 'cinematic'

export interface DemoDescriptor {
  id: string
  name: string
  oneLineDescription: string
  lengthSeconds: number
  droneCount: number
  thumbnailColor: string
  theme: DemoTheme
  featureChips: string[]
  /**
   * Showcased feature IDs prefixed with type: 'transition:cascade', 'idle:sparkle',
   * 'generator:line', 'color:rainbow', 'animated:firework-burst'. Asserted by demos.test.ts.
   */
  showcases: string[]
  seed: () => void
}

export const DEMO_REGISTRY: DemoDescriptor[] = [
  {
    id: 'pulse-test',
    name: 'Pulse Test',
    oneLineDescription: 'A 15-second minimalist showcase of color program transitions.',
    lengthSeconds: 15,
    droneCount: 40,
    thumbnailColor: '#fbbf24',
    theme: 'minimalist',
    featureChips: ['pulse-white', 'chase-rgb', 'sweep-cyan-magenta', 'idle:pulse'],
    showcases: ['color:pulse-white', 'color:chase-rgb', 'color:sweep-cyan-magenta', 'idle:pulse', 'generator:ring'],
    seed: seedPulseTest,
  },
  {
    id: 'countdown',
    name: 'Countdown',
    oneLineDescription: 'Three-two-one liftoff. Cascade transitions across line/star formations.',
    lengthSeconds: 20,
    droneCount: 30,
    thumbnailColor: '#10b981',
    theme: 'narrative',
    featureChips: ['line', 'star', 'cascade', 'sparkle'],
    showcases: ['generator:line', 'generator:star', 'transition:cascade', 'idle:sparkle', 'color:solid-red', 'color:solid-blue', 'color:solid-green'],
    seed: seedCountdown,
  },
  {
    id: 'galaxy',
    name: 'Galaxy',
    oneLineDescription: 'Slow spiral arms with orbital idle — a meditative 45 seconds.',
    lengthSeconds: 45,
    droneCount: 100,
    thumbnailColor: '#3b82f6',
    theme: 'minimalist',
    featureChips: ['spiral generator', 'spiral transition', 'orbit', 'gradient-blue-red'],
    showcases: ['generator:spiral', 'generator:sphere', 'transition:spiral', 'idle:orbit', 'color:gradient-blue-red'],
    seed: seedGalaxy,
  },
  {
    id: 'fireworks',
    name: 'Fireworks v2',
    oneLineDescription: 'Explosion → implosion → bounce. 200 drones in rainbow.',
    lengthSeconds: 50,
    droneCount: 200,
    thumbnailColor: '#ef4444',
    theme: 'festive',
    featureChips: ['firework-burst', 'explosion', 'implosion', 'bounce', 'rainbow'],
    showcases: ['animated:firework-burst', 'transition:explosion', 'transition:implosion', 'transition:bounce', 'transition:stagger', 'color:rainbow', 'color:rainbow-index'],
    seed: seedFireworks,
  },
  {
    id: 'heartbeat',
    name: 'Heartbeat',
    oneLineDescription: 'Heart formation breathing in sync. 80 drones, intimate.',
    // 40 → 55: post-nudge-removal heart morph transitions need longer durations
    // to clear motionSpacing through the heart-cusp crowding zones.
    lengthSeconds: 55,
    droneCount: 80,
    thumbnailColor: '#f43f5e',
    theme: 'romantic',
    featureChips: ['heart', 'breathing-sphere', 'breathe', 'morph'],
    showcases: ['generator:heart', 'animated:breathing-sphere', 'idle:breathe', 'transition:morph'],
    seed: seedHeartbeat,
  },
  {
    id: 'logo-reveal',
    name: 'Logo Reveal',
    oneLineDescription: 'Branded reveal: grid → star → heart sign-off with color-sweep.',
    lengthSeconds: 35,
    droneCount: 150,
    thumbnailColor: '#a855f7',
    theme: 'branded',
    featureChips: ['color-sweep', 'drift', 'wave', 'gradient-warm'],
    showcases: ['transition:color-sweep', 'idle:drift', 'idle:wave', 'color:solid-white', 'color:gradient-warm', 'color:multi-sunset', 'color:multi-rgb'],
    seed: seedLogoReveal,
  },
  {
    id: 'split-story',
    name: 'Split Story',
    oneLineDescription: 'A flock splits, swarms, then merges — different idles per branch.',
    lengthSeconds: 60,
    droneCount: 120,
    thumbnailColor: '#22c55e',
    theme: 'narrative',
    featureChips: ['split/merge', 'swarm', 'figure8', 'spin', 'ant-walk'],
    showcases: ['transition:ant-walk', 'idle:swarm', 'idle:figure8', 'idle:spin', 'idle:hover'],
    seed: seedSplitStory,
  },
  {
    id: 'cinematic',
    name: 'Cinematic',
    oneLineDescription: 'Two minutes of pacing variety. The full feature surface.',
    lengthSeconds: 120,
    droneCount: 250,
    thumbnailColor: '#0ea5e9',
    theme: 'cinematic',
    featureChips: ['apple-tree-shake', 'long-form', 'all transitions'],
    showcases: ['animated:apple-tree-shake', 'idle:drift', 'generator:grid', 'transition:shortest-path'],
    seed: seedCinematic,
  },
]

export function getDemoById(id: string): DemoDescriptor | undefined {
  return DEMO_REGISTRY.find((d) => d.id === id)
}
