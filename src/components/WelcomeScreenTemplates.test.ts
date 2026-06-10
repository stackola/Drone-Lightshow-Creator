// ============================================================================
// Tests that the WelcomeScreen project templates ship clean physics.
// ============================================================================
// Catches regressions like the 2026-05-21 simple-linear ring/spacing fix at
// unit-test time (no Playwright browser needed). Templates that ship with
// warnings still appear as a "1" badge on the Physics tab and erode the
// first-load impression, so we treat warnings as fails here.
// ============================================================================

import { describe, it, expect, beforeEach } from 'vitest'
import { createBlankProject, createSimpleLinearProject } from './WelcomeScreen'
import { seedSplitStory } from '../app/demos/splitStory'
import { useGraphStore } from '../stores/graphStore'
import { useProjectStore } from '../stores/projectStore'
import { useFormationStore } from '../stores/formationStore'
import { validateShowPhysics } from '../graph/physicsValidator'
import '../registries/init'

const TEMPLATES = [
  { id: 'blank', label: 'Blank Canvas', seed: createBlankProject },
  { id: 'simple-linear', label: 'Simple Linear', seed: createSimpleLinearProject },
  { id: 'split-merge', label: 'Split/Merge Starter', seed: seedSplitStory },
] as const

describe('WelcomeScreen templates ship clean physics', () => {
  beforeEach(() => {
    useGraphStore.getState().loadGraph({ nodes: [], edges: [] })
    useFormationStore.getState().loadFormations([], new Map())
  })

  for (const t of TEMPLATES) {
    it(`${t.id} (${t.label}) — zero violations of any severity`, () => {
      t.seed()
      const { nodes, edges } = useGraphStore.getState()
      const constraints = useProjectStore.getState().constraints
      const formations = useFormationStore.getState().generatedPoints
      const homePositions = useProjectStore.getState().dronePool.homePositions
      const violations = validateShowPhysics({ nodes, edges }, constraints, formations, homePositions)
      if (violations.length > 0) {
        const summary = violations.map((v) => `  - [${v.severity}] ${v.message}`).join('\n')
        throw new Error(`${t.id} has ${violations.length} violation(s):\n${summary}`)
      }
      expect(violations).toHaveLength(0)
    })
  }
})
