# Appendix B — 3D viewport tickets

R3F-based 3D viewport, gizmo, camera, post-fx, audience view.

---

## B-01 Drone point cloud (selection, hover)

**Status:** todo • **Effort:** M
**Affects:** [src/components/viewport/Viewport3D.tsx](src/components/viewport/Viewport3D.tsx) (`DroneCloud`)

**Current:** instanced sphere mesh, color = state, emissive on select. Click handler dispatches event but UI hooks are partial.
**Figma-perfect:**
- Per-drone click-to-select with event propagation.
- Shift+click multi-select.
- Hover glow (bloom + ring).
- Held-Alt dims non-selected for inspection.
- Tooltip with drone ID + live position.
- Double-click frames the drone.
- Right-click context menu (pin, delete, duplicate).

---

## B-02 Formation gizmo

**Status:** todo • **Effort:** L • **Depends on:** L2, B1
**Affects:** [src/components/viewport/FormationGizmo.tsx](src/components/viewport/FormationGizmo.tsx)

**Current:** PivotControls at interpolated transform, disabled between keyframes, writes invisible due to B1.
**Figma-perfect:**
- W/E/R toggle modes (translate/rotate/scale).
- Screen-constant gizmo size at all zooms.
- Shift+drag snaps to grid; Cmd+drag snaps to peers.
- Multi-select bounding-box gizmo with centroid origin.
- Local/world space toggle.
- ESC cancels drag and reverts.
- Tooltip with live values.

---

## B-03 Camera controls

**Status:** todo • **Effort:** M
**Affects:** [src/components/viewport/AudienceCameraControls.tsx](src/components/viewport/audience/AudienceCameraControls.tsx), camera handling in Viewport3D

**Current:** OrbitControls; preset buttons (Persp / Front / Side / Top); 300ms ease.
**Figma-perfect:**
- Keyboard 1/2/3/4 for presets.
- Double-click focus selection (Shift+F for fit-selection).
- Shift+click to measure distance.
- Ctrl+Num to save camera, Num to recall.
- Inertia decay on release.

---

## B-04 Ground plane

**Status:** partial (GG-toggle + sensible defaults shipped; altitude ruler + snap-to-ground + per-project sizing still todo) • **Effort:** S
**Affects:** [src/components/viewport/Viewport3D.tsx](src/components/viewport/Viewport3D.tsx)

**Current:** drei `Grid` 200×200 with cellSize 2 m + sectionSize 10 m, dark-theme colors, infinite-grid with fade. Visibility toggles via GG keyboard chord (canvas).
**Figma-perfect remaining:** altitude ruler on Y; snap-drones-to-ground option; configurable size + grid spacing per project.

---

## B-05 Sky / environment

**Status:** todo • **Effort:** M
**Affects:** [src/components/viewport/audience/AudienceEnvironment.tsx](src/components/viewport/audience/AudienceEnvironment.tsx)

**Current:** starfield background.
**Figma-perfect:** environment presets (space, stadium, desert, urban); HDRI; day/night synced to audio; atmospheric haze toggle.

---

## B-06 Geofence visualization

**Status:** todo • **Effort:** XL
**Affects:** [src/components/viewport/Viewport3D.tsx](src/components/viewport/Viewport3D.tsx) (`GeofenceVisualization`)

**Current:** translucent red cylinder + altitude floor/ceiling planes.
**Figma-perfect:**
- Wireframe volume with interactive resize handles (drag faces/edges/corners).
- F toggles visibility.
- Snap-drones-to-bounds with visual feedback.
- Altitude floor/ceiling as horizontal planes (green within, red outside).
- Live violation highlighting on drones.

---

## B-07 Point editor

**Status:** todo • **Effort:** M
**Affects:** [src/components/viewport/PointEditor.tsx](src/components/viewport/PointEditor.tsx) (if exists)

**Current:** click drone for individual point edit, shift+click multi-select.
**Figma-perfect:**
- Drag selected point with axis-lock (shift) and grid-snap (alt).
- Double-click → numeric edit popover.
- Right-click context menu (duplicate, delete, pin, reset).
- Undo per move (grouped per drag).

---

## B-08 Drone trails

**Status:** todo • **Effort:** M
**Affects:** [src/components/viewport/DroneTrails.tsx](src/components/viewport/DroneTrails.tsx)

**Current:** renders drone trajectory paths.
**Figma-perfect:** toggle, color by formation/index, opacity slider, length slider, velocity vectors, screenshot trail.

---

## B-09 Selection ring

**Status:** done (cyan select + amber multi-select + red error + yellow hover + RGB axes + center crosshair all shipped) • **Effort:** S
**Affects:** [src/components/viewport/ViewportOverlays.tsx](src/components/viewport/ViewportOverlays.tsx), [src/stores/selectionStore.ts](src/stores/selectionStore.ts), [src/components/canvas/GraphCanvas.tsx](src/components/canvas/GraphCanvas.tsx)

**Current:** `SelectionBoundingBox` dispatches by selection count. 1 → cyan `Box3` + RGB `AxesHelper` + small 3D crosshair at the box centroid; box + crosshair turn red (`#f87171`) when the selected formation has any error-severity `flowDiagnostics`. 2+ → amber combined `Box3`. Independent `HoverBoundingBox` renders a yellow `#facc15` box around any hovered formation that isn't in the current selection (driven by new `selectionStore.hoveredNodeId`, wired through React Flow's `onNodeMouseEnter`/`onNodeMouseLeave`). All bound to the playhead window.

---

## B-10 Bloom + post-fx

**Status:** todo • **Effort:** M
**Affects:** [src/components/viewport/audience/BloomLayer.tsx](src/components/viewport/audience/BloomLayer.tsx)

**Current:** BloomLayer with on/off.
**Figma-perfect:** sliders for strength/threshold/radius; color grading; chromatic aberration; motion blur during playback; per-layer toggle.

---

## B-11 Audience viewport + stats HUD

**Status:** todo • **Effort:** L • **Depends on:** B2, S1
**Affects:** [src/components/viewport/audience/AudienceViewport.tsx](src/components/viewport/audience/AudienceViewport.tsx), [src/components/viewport/ViewportStats.tsx](src/components/viewport/ViewportStats.tsx) (if exists)

**Current:** separate Canvas; crashes on open (B2); shares DroneCloud component; stats HUD shows FPS/render time/drone count.
**Figma-perfect:**
- Stable mount, never crashes.
- Synced playhead with editor.
- Lighting controls (3-point).
- Frame export to image.
- Stats with rolling 60-frame graph, memory MB, draw calls, triangles.
