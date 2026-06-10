// ============================================================================
// Bundle 1: Audience Viewport — second Canvas with POV + env + bloom
// ============================================================================
// Renders the same drones/scene as the editor viewport but with audience-facing
// camera, environment, and optional bloom. Reads the same stores; does NOT
// advance time (only the editor viewport owns playback ticking).
// ============================================================================

import { Canvas } from '@react-three/fiber'
import { PerspectiveCamera } from '@react-three/drei'
import { useViewStore } from '../../../stores/viewStore'
import { DroneCloud, GeofenceVisualization } from '../Viewport3D'
import { AudienceEnvironment } from './AudienceEnvironment'
import { AudienceCameraControls } from './AudienceCameraControls'
import { BloomLayer } from './BloomLayer'
import { EvaluatorTick } from '../EvaluatorTick'
import { AudienceEditLayer } from './AudienceEditLayer'

export function AudienceViewport() {
  const envId = useViewStore((s) => s.audience.envId)
  const emissiveIntensity = useViewStore((s) => s.audience.emissiveIntensity)
  return (
    <div className="w-full h-full relative bg-black">
      <Canvas dpr={[1, 2]}>
        <PerspectiveCamera makeDefault position={[0, 3, 50]} fov={55} />
        <EvaluatorTick />
        <AudienceEnvironment envId={envId} />
        <GeofenceVisualization />
        <DroneCloud emissiveIntensity={Math.max(1.5, emissiveIntensity)} />
        <AudienceEditLayer />
        <AudienceCameraControls />
        <BloomLayer kind="audience" />
      </Canvas>
    </div>
  )
}
