// ============================================================================
// Bundle 1: Audience Environment Presets
// ============================================================================
// Lightweight environment registry — sky, fog, lights — keyed by AudienceEnvId.
// Designed to look distinct at a glance, not photorealistic.
// ============================================================================

import { Sky, Stars } from '@react-three/drei'
import * as THREE from 'three'
import { useThree } from '@react-three/fiber'
import { useEffect } from 'react'
import type { AudienceEnvId } from '../../../stores/viewStore'

interface EnvPreset {
  sky: 'stars' | 'sky' | 'none'
  sunPosition?: [number, number, number]
  turbidity?: number
  rayleigh?: number
  ambient: number
  directional: number
  hemiTop: string
  hemiBottom: string
  fogColor: string
  fogNear: number
  fogFar: number
  background: string
}

const PRESETS: Record<AudienceEnvId, EnvPreset> = {
  night: {
    sky: 'stars',
    ambient: 0.05,
    directional: 0.15,
    hemiTop: '#0a1a2e',
    hemiBottom: '#000000',
    fogColor: '#000913',
    fogNear: 30,
    fogFar: 250,
    background: '#000913',
  },
  sunset: {
    sky: 'sky',
    sunPosition: [1, 0.05, 1],
    turbidity: 8,
    rayleigh: 4,
    ambient: 0.2,
    directional: 0.6,
    hemiTop: '#ffb27a',
    hemiBottom: '#3a1a0e',
    fogColor: '#3a1a0e',
    fogNear: 60,
    fogFar: 300,
    background: '#1a0a05',
  },
  dawn: {
    sky: 'sky',
    sunPosition: [-1, 0.08, -1],
    turbidity: 4,
    rayleigh: 2,
    ambient: 0.25,
    directional: 0.5,
    hemiTop: '#a7c4d8',
    hemiBottom: '#7a5a4e',
    fogColor: '#7a5a4e',
    fogNear: 60,
    fogFar: 300,
    background: '#2a2018',
  },
  indoor: {
    sky: 'none',
    ambient: 0.15,
    directional: 0.3,
    hemiTop: '#222222',
    hemiBottom: '#0a0a0a',
    fogColor: '#0a0a0a',
    fogNear: 10,
    fogFar: 80,
    background: '#0a0a0a',
  },
}

export function AudienceEnvironment({ envId }: { envId: AudienceEnvId }) {
  const preset = PRESETS[envId]
  const { scene } = useThree()

  useEffect(() => {
    const prevBg = scene.background
    const prevFog = scene.fog
    scene.background = new THREE.Color(preset.background)
    scene.fog = new THREE.Fog(preset.fogColor, preset.fogNear, preset.fogFar)
    return () => {
      scene.background = prevBg
      scene.fog = prevFog
    }
  }, [scene, preset.background, preset.fogColor, preset.fogNear, preset.fogFar])

  return (
    <>
      <ambientLight intensity={preset.ambient} />
      <directionalLight position={[20, 30, 10]} intensity={preset.directional} />
      <hemisphereLight args={[preset.hemiTop, preset.hemiBottom, 0.3]} />
      {preset.sky === 'stars' && (
        <Stars radius={250} depth={80} count={2500} factor={4} saturation={0} fade speed={0.3} />
      )}
      {preset.sky === 'sky' && (
        <Sky sunPosition={preset.sunPosition} turbidity={preset.turbidity} rayleigh={preset.rayleigh} />
      )}
    </>
  )
}
