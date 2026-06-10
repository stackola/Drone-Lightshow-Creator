# Surface roadmap — Phases 1–3

Per-surface lift tickets. Each surface references which leverage projects unlock its work.

---

## S1 — Live preview & data flow (engine room)

**Status:** todo
**Effort:** L–XL
**Depends on:** B1
**Affects:** [src/graph/evaluate.ts](src/graph/evaluate.ts), [src/graph/nodeEvaluators.ts](src/graph/nodeEvaluators.ts), [src/services/bakeWorker.ts](src/services/bakeWorker.ts), [src/components/viewport/Viewport3D.tsx](src/components/viewport/Viewport3D.tsx)

### Current

Eval runs on `useFrame`, reads stores via `getState()`. Two Canvas instances each re-evaluate the whole show every frame. `nodeEvaluators.ts` and `bakeWorker.ts` are core engine files with zero tests. "Same graph = same bake" is documented but not asserted.

### Figma-perfect

- Single source-of-truth evaluation: edits push deltas into the graph; eval pipeline computes one new states snapshot per frame; published to all subscribers.
- Bake worker is a parallel deterministic re-evaluation with full physics. Output bit-for-bit reproducible.
- CI runs golden trajectory snapshots on representative graphs; fails if either pipeline drifts.

### Sub-tickets

- **S1.1** Fix the cache (B1).
- **S1.2** Hoist eval into a derived signal both Canvases read.
- **S1.3** Snapshot tests for `nodeEvaluators.ts` covering all 5 node types and idle-attachment cases.
- **S1.4** Golden trajectory tests for `bakeWorker.ts` on 3–5 representative graphs.
- **S1.5** CI test asserting preview ≈ bake within documented tolerance.

---

## S2 — 3D viewport

**Status:** todo
**Effort:** L–XL
**Depends on:** S1, L2
**Affects:** [src/components/viewport/](src/components/viewport/), [src/components/viewport/FormationGizmo.tsx](src/components/viewport/FormationGizmo.tsx), new [src/components/viewport/handles/](src/components/viewport/handles/)

### Current

Drones as instanced spheres. Bloom optional. Gizmo exists, writes broken by B1. Camera controls basic. Geofence as translucent cylinder. No DoF, no motion blur, no smart guides, no multi-select gizmo.

### Figma-perfect

- Drones crisp at all zooms (instanced quad-billboards with HDR bloom calibrated against sky).
- Camera moves eased.
- W/E/R toggle gizmo modes (translate/rotate/scale). Screen-constant gizmo size.
- Snap-to-grid (shift), peer-snap (cmd), with visual guide lines during drag.
- Multi-select bounding-box gizmo with centroid origin.
- Local/world space toggle.
- ESC cancels drag and reverts.
- Cinematic post-fx (bloom + grading + optional DoF + chromatic aberration).
- Geofence as wireframe volume with interactive resize handles. Live violation highlighting on drones.

### Notes

L2 supplies the handle library this surface uses.

---

## S3 — Inspectors

**Status:** todo
**Effort:** L
**Depends on:** L4
**Affects:** [src/components/inspectors/](src/components/inspectors/), new [src/components/inputs/](src/components/inputs/)

### Current

Standard React inputs everywhere. `ColorProgramEditor.tsx:53-65` has 5 consecutive `as any` casts + a legacy color-field fallback chain.

### Figma-perfect

Every inspector field uses L4 components: NumberInput with drag-scrub + math + units; VectorInput with axis lock; ColorInput with eyedropper; EasingInput with draggable Bézier; SelectInput with L1 previews.

Multi-select propagates. Mixed-value shows `—`. Schema drift on color programs resolved with a one-shot migration.

---

## S4 — Keyframe / curve editor

**Status:** todo
**Effort:** L
**Depends on:** L4
**Affects:** [src/components/KeyframeCurveEditor.tsx](src/components/KeyframeCurveEditor.tsx)

### Current

212 LOC, "read-only" by the file's own admission (line 187 TODO). Keyframes clickable for selection, not draggable. No add by clicking the curve. No keyboard delete. No copy/paste. No snap. 3 easing presets. Fixed 300×150 px. Value axis collapses across visible properties.

### Figma-perfect

Two-pane dope-sheet + curve editor:
- Dope sheet (top): one strip per property, click-select, drag-to-move-in-time, marquee select.
- Curve editor (bottom): each visible property has its own value axis, draggable Bézier handles (shift to constrain), double-click curve to add keyframe.
- Copy/paste (Ctrl+C/V), delete (Del), snap-to-playhead (modifier).
- Playhead overlay scrubbable.
- All easing types in the picker.
- Responsive sizing to panel width.

---

## S5 — Graph canvas (node editor)

**Status:** todo
**Effort:** L
**Depends on:** L1 (for thumbnails in node cards)
**Affects:** [src/components/canvas/](src/components/canvas/), [src/components/canvas/nodes/](src/components/canvas/nodes/), [src/components/canvas/edges/](src/components/canvas/edges/)

### Current

React Flow nodes are functional but minimal. Edges are 1px lines. No animated flow during playback. No rich node previews. No smart edge routing.

### Figma-perfect

- During playback, small particles travel along flow edges from source → target, color-coded by destination formation.
- Each formation node card contains an L1 thumbnail of the formation it produces.
- Edge routing avoids overlaps where reasonable.
- Mini-map shows graph overview with viewport indicator.
- Drag-to-create edges from node ports, with ESC cancel.
- Snap-to-beat, snap-to-grid with smart guides.

---

## S6 — Color programs

**Status:** todo
**Effort:** L
**Depends on:** L1, L4
**Affects:** [src/registries/colorPrograms.ts](src/registries/colorPrograms.ts), [src/components/inspectors/ColorProgramEditor.tsx](src/components/inspectors/ColorProgramEditor.tsx)

### Current

10 advertised, ~80 LOC, no real tests. ColorProgramEditor has the `as any` cascade.

### Figma-perfect

- Each color program has an animated L1 preview swatch in the inspector.
- Gradient editor with draggable stops + eyedropper.
- Discriminated union types with one-shot migration for legacy field names.
- Unit tests at t=0/0.5/1 for every program.

---

## S7 — AI chat panel

**Status:** todo
**Effort:** L–XL
**Depends on:** L3
**Affects:** [src/components/AIToolCard.tsx](src/components/AIToolCard.tsx), [src/components/chat/](src/components/chat/), [src/services/aiWriteTools.ts](src/services/aiWriteTools.ts)

### Current

47 tools render as JSON. AIFormationCritic built but unwired. `aiWriteTools.ts` is 1066 LOC god-module.

### Figma-perfect

- Every tool result is an L3 card with appropriate per-tool body slot.
- Errors render as banners with retry buttons.
- Streaming responses animate in.
- Tool-call cards link to the affected nodes on click.
- `aiFormationCritic` wired into formation cards (a score chip).

### Notes

Split `aiWriteTools.ts` by domain (node CRUD / formation ops / timing & physics / view control / orchestrators).

---

## S8 — Transitions & idle behaviors

**Status:** todo
**Effort:** L
**Depends on:** B3, L1, L2
**Affects:** [src/registries/transitions.ts](src/registries/transitions.ts), [src/registries/idleBehaviors.ts](src/registries/idleBehaviors.ts), inspectors

### Current

8 transitions (6 loved, 2 thin); 11 idle behaviors (10 broken until B3 lands; 1 works). Animated formations hardcoded keyframe loops.

### Figma-perfect

- Each transition has an L1 preview and a "preview-without-commit" slider in the inspector (drag to see interpolation between two arbitrary point sets).
- Each idle behavior has an L1 preview showing its modulation on a representative formation.
- Bounce velocity validated numerically.
- Animated formations have a tested animation contract.

---

## S9 — Export pipeline

**Status:** todo
**Effort:** M–L
**Depends on:** L5-toast
**Affects:** [src/services/projectIO.ts](src/services/projectIO.ts), [src/services/videoExport.ts](src/services/videoExport.ts), [src/services/bakeWorker.ts](src/services/bakeWorker.ts), [src/services/autosave.ts](src/services/autosave.ts)

### Current

CSV / JSON exports solid. MP4 video silently falls back to WebM, no progress, no tests. No e2e of bake→export→verify. Autosave silent on failure.

### Figma-perfect

- Pre-export validation report (structured: "12 violations across 3 nodes; auto-fix can resolve 9").
- Real bake progress (segments completed / total, ETA).
- CSV preview of first 100 rows in export dialog.
- Video export either at the advertised quality or honestly labeled "experimental — server-side render coming."
- Autosave failures surface as a banner.
- E2E: load demo → adjust → bake → download → verify CSV structure.

---

## S10 — System-wide hygiene

**Status:** todo
**Effort:** XL (long tail; high leverage)
**Depends on:** L5
**Affects:** every component

### Current

No toasts. Inconsistent buttons / tooltips. Loading states ad-hoc. Empty states largely absent. No standard motion library. ErrorBoundary catches but doesn't diagnose. 813 non-null assertions across the codebase.

### Figma-perfect

- Toast system used everywhere.
- One Button / Input / Dropdown / Tooltip component each, polished, themed, keyboard-accessible.
- Every panel has designed empty + loading + error states.
- Motion palette (durations + easings) used everywhere.
- ErrorBoundary logs to dev panel.
- Magic numbers in physics replaced with named constants.

### Notes

S10 is the long tail of polish. Best executed as a continuous stream alongside other surfaces, not as a discrete project.
