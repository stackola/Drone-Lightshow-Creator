// CSV Export — flat table format

import { useFormationStore } from '../stores/formationStore'

export function exportFormationCsv(): string {
  const { drones } = useFormationStore.getState()
  const lines = ['drone_id,frame,x,y,z,r,g,b,w']

  for (const d of drones) {
    // Merge position and color keyframes by frame
    const frames = new Set<number>()
    for (const kf of d.positionKeyframes) frames.add(kf.frame)
    for (const kf of d.colorKeyframes) frames.add(kf.frame)

    const sortedFrames = [...frames].sort((a, b) => a - b)
    for (const frame of sortedFrames) {
      const pos = d.positionKeyframes.find((k) => k.frame === frame) ?? d.positionKeyframes[0]
      const col = d.colorKeyframes.find((k) => k.frame === frame) ?? d.colorKeyframes[0]
      lines.push(`${d.id},${frame},${pos?.x.toFixed(3) ?? 0},${pos?.y.toFixed(3) ?? 0},${pos?.z.toFixed(3) ?? 0},${col?.r ?? 255},${col?.g ?? 255},${col?.b ?? 255},${col?.w ?? 0}`)
    }
  }

  return lines.join('\n')
}

export function downloadFormationCsv() {
  const csv = exportFormationCsv()
  const { name } = useFormationStore.getState()
  const filename = (name || 'formation').replace(/[^a-zA-Z0-9_\- ]/g, '') + '.csv'
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename
  document.body.appendChild(a); a.click()
  document.body.removeChild(a); URL.revokeObjectURL(url)
}
