// ============================================================================
// AI Write Tools — Barrel module
// ============================================================================
// The 1066-LOC god module was split into six domain modules on 2026-05-21.
// This file now only ensures all of them are loaded as a single side-effect
// import, matching the historical contract: `import './aiWriteTools'` is the
// one-shot way to register every AI write tool.
// ============================================================================

// AI formation generator tools (legacy side-effect modules)
import './aiFormationGenerator'
import './aiSvgFormationGenerator'

// Domain-split modules.
import './aiWriteFormations'   // 5 formation CRUD + text + set-points
import './aiWriteGraphNodes'   // 8 graph nodes + edges
import './aiWriteShowEdit'     // 7 transform / keyframe / color / strategy / idle
import './aiWritePhysics'      // 6 fix / time / push / count / constraints / clear
import './aiWriteOrchestrators' // 4 outline / image / music / structure
