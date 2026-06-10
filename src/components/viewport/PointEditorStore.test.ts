// Item 5: regression tests for the point-editor Zustand store. The legacy
// `usePointEditor` hook still exists for backwards compat but every new
// surface (the 3D gizmo, the inspector toggle, the highlight-in-DroneCloud
// loop) reads from this store directly.
import { describe, it, expect, beforeEach } from 'vitest'
import { usePointEditorStore } from './PointEditor'

function reset() {
  usePointEditorStore.setState({ isActive: false, formationId: null, selectedIndices: new Set() })
}

describe('usePointEditorStore', () => {
  beforeEach(reset)

  it('enterEditMode activates with empty selection', () => {
    usePointEditorStore.getState().enterEditMode('formation-1')
    const s = usePointEditorStore.getState()
    expect(s.isActive).toBe(true)
    expect(s.formationId).toBe('formation-1')
    expect(s.selectedIndices.size).toBe(0)
  })

  it('exitEditMode clears state', () => {
    usePointEditorStore.getState().enterEditMode('f')
    usePointEditorStore.getState().selectPoint(3, false)
    usePointEditorStore.getState().exitEditMode()
    const s = usePointEditorStore.getState()
    expect(s.isActive).toBe(false)
    expect(s.formationId).toBeNull()
    expect(s.selectedIndices.size).toBe(0)
  })

  it('selectPoint additive toggles', () => {
    usePointEditorStore.getState().enterEditMode('f')
    usePointEditorStore.getState().selectPoint(1, false)
    usePointEditorStore.getState().selectPoint(2, true)
    usePointEditorStore.getState().selectPoint(3, true)
    expect(Array.from(usePointEditorStore.getState().selectedIndices).sort()).toEqual([1, 2, 3])
    // Re-toggle 2.
    usePointEditorStore.getState().selectPoint(2, true)
    expect(Array.from(usePointEditorStore.getState().selectedIndices).sort()).toEqual([1, 3])
  })

  it('selectPoint without additive replaces', () => {
    usePointEditorStore.getState().enterEditMode('f')
    usePointEditorStore.getState().selectPoint(1, false)
    usePointEditorStore.getState().selectPoint(2, true)
    usePointEditorStore.getState().selectPoint(7, false)
    expect(Array.from(usePointEditorStore.getState().selectedIndices)).toEqual([7])
  })

  it('selectMany adds indices in batch', () => {
    usePointEditorStore.getState().enterEditMode('f')
    usePointEditorStore.getState().selectMany([0, 2, 4], false)
    expect(Array.from(usePointEditorStore.getState().selectedIndices).sort()).toEqual([0, 2, 4])
    usePointEditorStore.getState().selectMany([10, 11], true)
    expect(Array.from(usePointEditorStore.getState().selectedIndices).sort()).toEqual([0, 10, 11, 2, 4].sort())
  })

  it('clearSelection wipes selectedIndices without exiting mode', () => {
    usePointEditorStore.getState().enterEditMode('f')
    usePointEditorStore.getState().selectMany([0, 1, 2], false)
    usePointEditorStore.getState().clearSelection()
    expect(usePointEditorStore.getState().selectedIndices.size).toBe(0)
    expect(usePointEditorStore.getState().isActive).toBe(true)
  })
})
