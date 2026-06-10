import { describe, it, expect, beforeEach } from 'vitest'
import { useUiModeStore, VIEW_DEFS } from './uiModeStore'

beforeEach(() => {
  useUiModeStore.setState({ mode: 'build', viewId: 'iso', graphDockOpen: false, isTweening: false })
})

describe('uiModeStore', () => {
  it('defaults to build mode + iso view', () => {
    expect(useUiModeStore.getState().mode).toBe('build')
    expect(useUiModeStore.getState().viewId).toBe('iso')
  })

  it('switches mode and view', () => {
    useUiModeStore.getState().setMode('graph')
    expect(useUiModeStore.getState().mode).toBe('graph')
    useUiModeStore.getState().setView('top')
    expect(useUiModeStore.getState().viewId).toBe('top')
  })

  it('toggles the graph dock', () => {
    expect(useUiModeStore.getState().graphDockOpen).toBe(false)
    useUiModeStore.getState().toggleGraphDock()
    expect(useUiModeStore.getState().graphDockOpen).toBe(true)
  })

  it('every view maps to a default plane kind and a camera kind', () => {
    for (const v of Object.values(VIEW_DEFS)) {
      expect(['ground-xz', 'vertical-xy', 'vertical-zy']).toContain(v.defaultPlaneKind)
      expect(['orthographic', 'perspective']).toContain(v.cameraKind)
    }
  })

  it('iso is orthographic; perspective is perspective', () => {
    expect(VIEW_DEFS.iso.cameraKind).toBe('orthographic')
    expect(VIEW_DEFS.perspective.cameraKind).toBe('perspective')
  })
})
