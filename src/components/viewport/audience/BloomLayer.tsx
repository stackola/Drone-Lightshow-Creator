// ============================================================================
// Bundle 1: Bloom postprocessing wrapper
// ============================================================================

import { EffectComposer, Bloom } from '@react-three/postprocessing'
import { KernelSize } from 'postprocessing'
import { useViewStore } from '../../../stores/viewStore'

export function BloomLayer({ kind }: { kind: 'editor' | 'audience' }) {
  const enabled = useViewStore((s) =>
    kind === 'editor' ? s.audience.bloomEditor : s.audience.bloomAudience,
  )
  const intensity = useViewStore((s) => s.audience.bloomIntensity)
  if (!enabled) return null
  return (
    <EffectComposer multisampling={0}>
      <Bloom
        intensity={intensity}
        luminanceThreshold={0.2}
        luminanceSmoothing={0.4}
        kernelSize={KernelSize.LARGE}
        mipmapBlur
      />
    </EffectComposer>
  )
}
