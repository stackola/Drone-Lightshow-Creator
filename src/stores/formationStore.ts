// ============================================================================
// S5-01: Formation Store — Formation Definitions + Generated Points
// ============================================================================

import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { enableMapSet } from 'immer'
import type { Vec3 } from '../graph/types'
import type { AnimatedFormationDef } from '../graph/animatedFormation'
import { getAnimatedFormationRestPositions } from '../graph/animatedFormation'
import { getGenerator } from '../registries/generators'

enableMapSet()

export interface Formation {
  id: string
  name: string
  type: 'static' | 'animated'
  generatorId: string
  parameters: Record<string, number>
  pointCount: number
  tags: string[]
}

export interface FormationStoreState {
  formations: Formation[]
  generatedPoints: Map<string, Vec3[]>
  animatedDefs: Map<string, AnimatedFormationDef>

  addFormation: (name: string, generatorId: string, params: Record<string, number>) => string
  addAnimatedFormation: (name: string, def: AnimatedFormationDef, tags?: string[]) => string
  updateFormation: (id: string, patch: Partial<Formation>) => void
  updateAnimatedDef: (id: string, def: AnimatedFormationDef) => void
  removeFormation: (id: string) => void
  regeneratePoints: (id: string) => void
  getFormation: (id: string) => Formation | undefined
  getPoints: (id: string) => Vec3[] | undefined
  getAnimatedDef: (id: string) => AnimatedFormationDef | undefined

  loadFormations: (formations: Formation[], points: Map<string, Vec3[]>, animatedDefs?: Map<string, AnimatedFormationDef>) => void
}

let _formIdCounter = 0
function genFormId(): string {
  return `formation-${Date.now().toString(36)}-${(++_formIdCounter).toString(36)}`
}

export const useFormationStore = create<FormationStoreState>()(
  immer((set, get) => ({
    formations: [],
    generatedPoints: new Map(),
    animatedDefs: new Map(),

    addFormation(name, generatorId, params) {
      const id = genFormId()
      const gen = getGenerator(generatorId)
      const points = gen ? gen.generate(params) : []
      const formation: Formation = {
        id,
        name,
        type: 'static',
        generatorId,
        parameters: params,
        pointCount: points.length,
        tags: [],
      }
      set((state) => {
        state.formations.push(formation)
        state.generatedPoints.set(id, points)
      })
      return id
    },

    addAnimatedFormation(name, def, tags = []) {
      const id = genFormId()
      const restPositions = getAnimatedFormationRestPositions(def)
      const formation: Formation = {
        id,
        name,
        type: 'animated',
        generatorId: 'animated',
        parameters: {},
        pointCount: def.droneCount,
        tags,
      }
      set((state) => {
        state.formations.push(formation)
        state.generatedPoints.set(id, restPositions)
        state.animatedDefs.set(id, def)
      })
      return id
    },

    updateAnimatedDef(id, def) {
      const restPositions = getAnimatedFormationRestPositions(def)
      set((state) => {
        state.animatedDefs.set(id, def)
        state.generatedPoints.set(id, restPositions)
        const f = state.formations.find((f) => f.id === id)
        if (f) f.pointCount = def.droneCount
      })
    },

    updateFormation(id, patch) {
      set((state) => {
        const f = state.formations.find((f) => f.id === id)
        if (f) {
          // Exclude `id` from patch to prevent corrupting references
          const { id: _ignoreId, ...safePatch } = patch as Record<string, unknown>
          Object.assign(f, safePatch)
        }
      })
    },

    removeFormation(id) {
      set((state) => {
        state.formations = state.formations.filter((f) => f.id !== id)
        state.generatedPoints.delete(id)
        state.animatedDefs.delete(id)
      })
    },

    regeneratePoints(id) {
      const f = get().formations.find((f) => f.id === id)
      if (!f) return

      // Animated formations use their rest positions, not generators
      const animDef = get().animatedDefs.get(id)
      if (animDef) {
        const points = getAnimatedFormationRestPositions(animDef)
        set((state) => {
          const formation = state.formations.find((ff) => ff.id === id)
          if (formation) formation.pointCount = points.length
          state.generatedPoints.set(id, points)
        })
        return
      }

      const gen = getGenerator(f.generatorId)
      const points = gen ? gen.generate(f.parameters) : []
      set((state) => {
        const formation = state.formations.find((ff) => ff.id === id)
        if (formation) formation.pointCount = points.length
        state.generatedPoints.set(id, points)
      })
    },

    getFormation(id) {
      return get().formations.find((f) => f.id === id)
    },

    getPoints(id) {
      return get().generatedPoints.get(id)
    },

    getAnimatedDef(id) {
      return get().animatedDefs.get(id)
    },

    loadFormations(formations, points, animatedDefs) {
      set((state) => {
        state.formations = formations
        state.generatedPoints = points
        state.animatedDefs = animatedDefs ?? new Map()
      })
    },
  })),
)

// Mutation version — see graphStore.ts for context.
let _formationMutationVersion = 0
useFormationStore.subscribe(() => { _formationMutationVersion += 1 })
export function getFormationMutationVersion(): number {
  return _formationMutationVersion
}
