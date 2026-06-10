// ============================================================================
// nodeDefaults — canonical default payloads for user-created nodes. Single
// source shared by the graph-canvas context menu and the 3D viewport context
// menu so "Add Launch" means the same thing everywhere.
// ============================================================================

import type { LaunchNodeData, IdleNodeData, LandNodeData, FormationNodeData, Vec3 } from './types'

export function defaultLaunchData(startTime: number): LaunchNodeData {
  return {
    droneCount: 100,
    startTime,
    staggerDelay: 0.02,
  } as LaunchNodeData
}

export function defaultIdleData(startTime: number, center: Vec3 = { x: 0, y: 0, z: 0 }): IdleNodeData {
  return {
    behavior: 'hover',
    center,
    radius: 5,
    speed: 1,
    altitude: 10,
    startTime,
    duration: 5,
    colorProgramId: null,
  } as IdleNodeData
}

export function defaultLandData(): LandNodeData {
  return {
    staggerDelay: 0.02,
  } as LandNodeData
}

export function defaultFormationData(
  startTime: number,
  position: Vec3 = { x: 0, y: 10, z: 0 },
  formationId: string | null = null,
): FormationNodeData {
  return {
    formationId,
    startTime,
    duration: 5,
    transform: { position, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
    keyframes: [],
    colorProgramId: null,
    idleConfigs: [],
  } as FormationNodeData
}
