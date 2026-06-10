// JSON Export — formation.json for Blender import

import { useFormationStore } from '../stores/formationStore'
import { validate } from './validator'

export function exportFormationJson(): string {
  const { name, drones, fps, totalFrames, physicsLimits } = useFormationStore.getState()
  const violations = validate(drones, physicsLimits)

  let maxVel = 0, minSpacing = Infinity
  // Quick stats
  for (const d of drones) {
    for (let i = 1; i < d.positionKeyframes.length; i++) {
      const a = d.positionKeyframes[i - 1]!, b = d.positionKeyframes[i]!
      const dt = (b.frame - a.frame) / fps
      if (dt > 0) {
        const dist = Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2 + (b.z - a.z) ** 2)
        const vel = dist / dt
        if (vel > maxVel) maxVel = vel
      }
    }
  }

  return JSON.stringify({
    format: 'drone-formation-v1',
    name,
    droneCount: drones.length,
    durationSeconds: +(totalFrames / fps).toFixed(2),
    fps,
    totalFrames,
    coordinateSystem: 'ENU',
    drones: drones.map((d) => ({
      id: d.id,
      positions: d.positionKeyframes,
      colors: d.colorKeyframes,
    })),
    validation: {
      passed: violations.length === 0,
      maxVelocity: +maxVel.toFixed(2),
      violations: violations.slice(0, 20),
    },
    physicsLimits,
    blenderImportScript: BLENDER_SCRIPT,
  }, null, 2)
}

export function downloadFormationJson() {
  const json = exportFormationJson()
  const { name } = useFormationStore.getState()
  const filename = (name || 'formation').replace(/[^a-zA-Z0-9_\- ]/g, '') + '.json'
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename
  document.body.appendChild(a); a.click()
  document.body.removeChild(a); URL.revokeObjectURL(url)
}

const BLENDER_SCRIPT = `
import bpy, json, os

# --- PASTE THIS SCRIPT INTO BLENDER'S TEXT EDITOR AND RUN ---
# Change this path to your exported JSON file:
filepath = "/path/to/formation.json"

with open(filepath) as f:
    data = json.load(f)

col = bpy.data.collections.new(data["name"])
bpy.context.scene.collection.children.link(col)
bpy.context.scene.render.fps = data["fps"]
bpy.context.scene.frame_end = data["totalFrames"]

for drone in data["drones"]:
    obj = bpy.data.objects.new(f"Drone_{drone['id']:03d}", None)
    obj.empty_display_type = 'SPHERE'
    obj.empty_display_size = 0.3
    col.objects.link(obj)

    # Position keyframes
    for kf in drone["positions"]:
        obj.location = (kf["x"], kf["y"], kf["z"])
        obj.keyframe_insert("location", frame=kf["frame"])

    # Color as custom properties (access via drone["r"], drone["g"] etc.)
    if drone.get("colors"):
        for ck in drone["colors"]:
            obj["r"] = ck["r"]; obj["g"] = ck["g"]; obj["b"] = ck["b"]; obj["w"] = ck["w"]
            obj.keyframe_insert(data_path='["r"]', frame=ck["frame"])
            obj.keyframe_insert(data_path='["g"]', frame=ck["frame"])
            obj.keyframe_insert(data_path='["b"]', frame=ck["frame"])
            obj.keyframe_insert(data_path='["w"]', frame=ck["frame"])

print(f"Imported {data['droneCount']} drones, {data['totalFrames']} frames")
`.trim()
