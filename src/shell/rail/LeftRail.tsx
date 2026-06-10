// ============================================================================
// LeftRail — Phase 2 of the shell rebuild. A floating 44px icon strip plus,
// when a section is open, an adjacent 280px floating panel card. Replaces the
// legacy AssetPanel tabs: Formations (project + library merged), Import,
// Planes. ShellLayout positions us (absolute left-3 top-3 bottom-3).
// ============================================================================

import { useState } from 'react'
import { Shapes, Upload, Layers } from 'lucide-react'
import { IconButton } from '../../components/ui'
import { FormationsPanel } from './FormationsPanel'
import { ImportPanel } from './ImportPanel'
import { PlanesRailPanel } from './PlanesRailPanel'

type SectionId = 'formations' | 'import' | 'planes'

const SECTIONS: Array<{ id: SectionId; label: string; Icon: typeof Shapes }> = [
  { id: 'formations', label: 'Formations', Icon: Shapes },
  { id: 'import', label: 'Import', Icon: Upload },
  { id: 'planes', label: 'Planes', Icon: Layers },
]

export function LeftRail() {
  const [open, setOpen] = useState<SectionId | null>('formations')

  return (
    <>
      {/* Icon strip */}
      <div className="floating-panel flex flex-col items-center gap-1 p-1.5 w-11 self-start" data-testid="rail-strip">
        {SECTIONS.map(({ id, label, Icon }) => (
          <IconButton
            key={id}
            aria-label={label}
            title={label}
            active={open === id}
            data-testid={`rail-icon-${id}`}
            onClick={() => setOpen(open === id ? null : id)}
          >
            <Icon size={18} />
          </IconButton>
        ))}
      </div>

      {/* Open section panel */}
      {open && (
        <div
          className="floating-panel ml-2 w-[280px] max-h-full overflow-hidden flex flex-col animate-panel-in"
          data-testid={`rail-panel-${open}`}
        >
          {open === 'formations' && <FormationsPanel />}
          {open === 'import' && <ImportPanel />}
          {open === 'planes' && <PlanesRailPanel />}
        </div>
      )}
    </>
  )
}
