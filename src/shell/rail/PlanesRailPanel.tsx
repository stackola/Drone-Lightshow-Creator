// ============================================================================
// PlanesRailPanel — thin rail wrapper around the existing PlanesPanel
// (which is not part of the legacy chrome being rebuilt; reused as-is).
// ============================================================================

import { SectionHeader } from '../../components/ui'
import { PlanesPanel } from '../../components/panels/PlanesPanel'

export function PlanesRailPanel() {
  return (
    <div className="flex flex-col min-h-0">
      <SectionHeader>Build Planes</SectionHeader>
      <div className="flex-1 min-h-0 overflow-y-auto">
        <PlanesPanel />
      </div>
    </div>
  )
}
