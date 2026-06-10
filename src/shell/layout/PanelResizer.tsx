// ============================================================================
// PanelResizer — thin drag handle between shell panels. Pointer-captured so
// drags stay smooth over iframes/canvases; reports a delta per move and the
// host applies/clamps it.
// ============================================================================

import { useRef } from 'react'

export interface PanelResizerProps {
  direction: 'horizontal' | 'vertical'
  /** Called with the pointer delta (px) since the previous move event. */
  onResize: (delta: number) => void
}

export function PanelResizer({ direction, onResize }: PanelResizerProps) {
  const lastPos = useRef(0)
  const horizontal = direction === 'horizontal'

  return (
    <div
      role="separator"
      aria-orientation={horizontal ? 'vertical' : 'horizontal'}
      className={`flex-shrink-0 group ${horizontal ? 'w-1 cursor-col-resize' : 'h-1 cursor-row-resize'}`}
      onPointerDown={(e) => {
        e.preventDefault()
        lastPos.current = horizontal ? e.clientX : e.clientY
        e.currentTarget.setPointerCapture(e.pointerId)
      }}
      onPointerMove={(e) => {
        if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
        const pos = horizontal ? e.clientX : e.clientY
        onResize(pos - lastPos.current)
        lastPos.current = pos
      }}
      onPointerUp={(e) => e.currentTarget.releasePointerCapture(e.pointerId)}
    >
      <div className={`${horizontal ? 'w-px h-full' : 'h-px w-full'} bg-white/5 group-hover:bg-accent-primary/40 transition-colors mx-auto`} />
    </div>
  )
}
