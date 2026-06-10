import { memo, useMemo } from 'react'
import type { GroupNodeData } from '../../../graph/types'

interface GroupNodeProps {
  data: GroupNodeData
  selected?: boolean
}

function hexToRgba(hex: string, alpha: number): string {
  const match = hex.replace('#', '').match(/.{1,2}/g)
  if (!match || match.length < 3) return `rgba(128,128,128,${alpha})`
  const [r, g, b] = match.map((v) => parseInt(v, 16))
  return `rgba(${r},${g},${b},${alpha})`
}

function isLightColor(hex: string): boolean {
  const match = hex.replace('#', '').match(/.{1,2}/g)
  if (!match || match.length < 3) return false
  const [r, g, b] = match.map((v) => parseInt(v, 16))
  // Perceived luminance
  return (r! * 299 + g! * 587 + b! * 114) / 1000 > 150
}

function GroupNodeInner({ data, selected }: GroupNodeProps) {
  const bgColor = useMemo(() => hexToRgba(data.color, 0.08), [data.color])
  const headerBg = useMemo(() => hexToRgba(data.color, 0.19), [data.color])
  const textClass = isLightColor(data.color) ? 'text-slate-900' : 'text-white/80'

  return (
    <div
      className={`rounded-lg border-2 border-dashed min-w-[200px] min-h-[100px] ${
        selected ? 'ring-2 ring-cyan-400' : ''
      }`}
      style={{
        borderColor: data.color,
        backgroundColor: bgColor,
      }}
    >
      <div
        className={`px-3 py-1.5 rounded-t-md flex items-center gap-2 text-sm font-semibold ${textClass}`}
        style={{ backgroundColor: headerBg }}
      >
        <span>{data.label}</span>
      </div>
    </div>
  )
}

export const GroupNode = memo(GroupNodeInner)
