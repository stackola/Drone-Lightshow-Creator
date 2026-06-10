// ============================================================================
// Smart Guides overlay — draws Figma-style alignment lines while a formation
// drags into alignment with its peers. Fed by FormationGizmo via the snap
// store; renders nothing when no guides are active. Lines use a distinct pink
// so they read as guides, not part of the cyan editing chrome.
// ============================================================================

import { create } from 'zustand'
import { useMemo } from 'react'
import type { SnapGuide } from '../../graph/snapGuides'

interface SnapGuideState {
  guides: SnapGuide[]
  setGuides: (g: SnapGuide[]) => void
}

function sameGuides(a: SnapGuide[], b: SnapGuide[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!
    const y = b[i]!
    if (x.axis !== y.axis || x.peerId !== y.peerId) return false
    if (Math.abs(x.to.x - y.to.x) > 1e-3 || Math.abs(x.to.y - y.to.y) > 1e-3 || Math.abs(x.to.z - y.to.z) > 1e-3) return false
  }
  return true
}

const useSnapGuideStore = create<SnapGuideState>()((set) => ({
  guides: [],
  setGuides: (guides) => set((prev) => (sameGuides(prev.guides, guides) ? prev : { guides })),
}))

export function publishSnapGuides(guides: SnapGuide[]): void {
  useSnapGuideStore.getState().setGuides(guides)
}
export function clearSnapGuides(): void {
  useSnapGuideStore.getState().setGuides([])
}

const GUIDE_COLOR = '#f472b6'

function GuideLine({ guide }: { guide: SnapGuide }) {
  const positions = useMemo(
    () => new Float32Array([guide.from.x, guide.from.y, guide.from.z, guide.to.x, guide.to.y, guide.to.z]),
    [guide.from.x, guide.from.y, guide.from.z, guide.to.x, guide.to.y, guide.to.z],
  )
  return (
    <line>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <lineBasicMaterial color={GUIDE_COLOR} transparent opacity={0.85} depthTest={false} />
    </line>
  )
}

export function SmartGuides() {
  const guides = useSnapGuideStore((s) => s.guides)
  if (guides.length === 0) return null
  return (
    <group renderOrder={999}>
      {guides.map((g) => (
        <GuideLine key={g.axis} guide={g} />
      ))}
    </group>
  )
}
