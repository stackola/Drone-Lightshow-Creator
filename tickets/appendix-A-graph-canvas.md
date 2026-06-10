# Appendix A — Graph canvas tickets

React Flow canvas, nodes, edges, canvas-level interactions.

---

## A-01 Formation node card

**Status:** todo • **Effort:** M • **Depends on:** L1
**Affects:** [src/components/canvas/nodes/FormationNode.tsx](src/components/canvas/nodes/FormationNode.tsx)

**Current:** blue card, label, start/end time, muted opacity, validation badges, duration-resizable right edge.
**Figma-perfect:**
- Click-to-edit label in place without opening inspector.
- Double-click toggles an inline details popover (keyframes, color, idle configs at a glance).
- Hover tooltip with full metadata (formation ID, duration, keyframe count, symmetry mode).
- Selected ring animates on entry.
- Active-at-playhead pulses with cyan aura.
- L1 thumbnail of the formation embedded in the card.
- Right-click context menu (duplicate, color edit, symmetry flip).

---

## A-02 Launch node card

**Status:** partial (hover tooltip shipped 2026-05-21 ~22:38; drag-badge + bottleneck analysis + disabled-state still todo) • **Effort:** S • **Depends on:** —
**Affects:** [src/components/canvas/nodes/LaunchNode.tsx](src/components/canvas/nodes/LaunchNode.tsx)

**Current:** emerald card with drone count, startTime, staggerDelay + multi-line hover tooltip showing drone count, stagger, fan-out total, derived launch duration, start, and any "drones not allocated downstream" warning.
**Figma-perfect remaining:**
- Drag the count badge to adjust drone count.
- Downstream bottleneck analysis in the tooltip.
- Hover expands to a small stagger preview (fan-out animation hint).
- Disabled state with reason ("graph has no land node") + visual mute.
- Click selects + opens inspector; selected shows cyan ring.

---

## A-03 Transition node card

**Status:** todo • **Effort:** M • **Depends on:** L1
**Affects:** [src/components/canvas/nodes/TransitionNode.tsx](src/components/canvas/nodes/TransitionNode.tsx)

**Current:** violet dashed card, strategy label, auto-inserted between formations.
**Figma-perfect:**
- Click edge label to edit strategy in a dropdown with L1 previews.
- Hover shows estimated duration + drone count from incoming edge.
- Double-click expands an inline parameter editor for strategies that have knobs.
- Drag-to-move adjusts insertion point.
- If strategy fails, red badge with reason tooltip.
- Undo on strategy change.
- Multi-select includes transitions in the bounding-box gizmo.

---

## A-04 Idle node card

**Status:** todo • **Effort:** M • **Depends on:** L1, B3
**Affects:** [src/components/canvas/nodes/IdleNode.tsx](src/components/canvas/nodes/IdleNode.tsx)

**Current:** amber card with behavior, radius, speed, altitude, attached to formation above.
**Figma-perfect:**
- Drag from a formation port to create an attached idle.
- Click behavior badge → behavior-picker popover with L1 previews + radius/speed sliders.
- 3D circle/orbit gizmo overlay in viewport while editing.
- Shift+click stacks multiple idles on the same formation.
- Delete with undo animation.
- Tooltip shows inherited color + animation duration.

---

## A-05 Land node card

**Status:** partial (hover tooltip + Lock icon visible 2026-05-21 ~22:38; drag-badge + estimated-flight-time still todo) • **Effort:** S • **Depends on:** —
**Affects:** [src/components/canvas/nodes/LandNode.tsx](src/components/canvas/nodes/LandNode.tsx)

**Current:** red dashed card + Lock icon (already there) + multi-line hover tooltip surfacing the "protected from deletion" rule that was previously discoverable only by trying to delete. Stagger and derived-timing notes included.
**Figma-perfect remaining:**
- Drag number badge for stagger.
- Estimated flight time from prior formations (would require graph traversal during render).
- Click → inspector stagger edit (already wired via React Flow standard selection).
- Grayed with reason ("no upstream nodes") if no flow.

---

## A-06 Flow edge

**Status:** todo • **Effort:** L • **Depends on:** L4
**Affects:** [src/components/canvas/edges/FlowEdge.tsx](src/components/canvas/edges/FlowEdge.tsx)

**Current:** bezier curve, stroke width ∝ drone count, mid-point pill badge with allocation-mode color (auto=slate, manual-count=blue, manual-percent=green).
**Figma-perfect:**
- Click badge → context menu to toggle allocation mode (Auto / Manual Count / Manual Percent).
- Drag badge to adjust drone count with a number-input popover.
- Hover highlights the path; dims others.
- Selected = cyan stroke.
- Right-click context menu (edit, invert, delete, duplicate).
- Red warning badge on constraint violation, with hover details.
- Drag-from-handle creates an edge; ESC cancels mid-drag.
- Undo/redo on create/delete.
- Right-aligned label showing incoming drone count.

---

## A-07 Attachment edge

**Status:** partial (hover tooltip shipped 2026-05-21 ~22:32; context menu + drag-to-reattach still todo) • **Effort:** S • **Depends on:** —
**Affects:** [src/components/canvas/edges/AttachmentEdge.tsx](src/components/canvas/edges/AttachmentEdge.tsx)

**Current:** dashed violet line + native SVG `<title>` hover tooltip resolving source/target to display names ("Idle 'Orbit' attached to formation 'Opening Ring'"). Selected stroke cyan.
**Figma-perfect remaining:**
- Right-click context menu (edit behavior, swap target, delete).
- Drag to re-attach.

---

## A-08 Pan / zoom

**Status:** todo • **Effort:** M
**Affects:** [src/components/canvas/GraphCanvas.tsx](src/components/canvas/GraphCanvas.tsx)

**Current:** wheel zoom, middle-drag pan (React Flow defaults).
**Figma-perfect:**
- Shift+scroll zoom toward cursor.
- Trackpad pinch zoom.
- Space+drag pan (or middle mouse).
- Zoom-in / zoom-out limits.
- Double-click node = focus + zoom to 1.0.
- Shift+1 / Cmd+0 (or `F`) fit-all.
- Trackpad momentum decay.

---

## A-09 Selection

**Status:** todo • **Effort:** L • **Depends on:** L4
**Affects:** [src/components/canvas/GraphCanvas.tsx](src/components/canvas/GraphCanvas.tsx), [src/stores/selectionStore.ts](src/stores/selectionStore.ts)

**Current:** click select, shift+click toggle, Ctrl+A all, ESC clear.
**Figma-perfect:**
- Click-drag marquee.
- Selected nodes show cyan ring.
- Multi-select bounding-box gizmo with move + align handles.
- Right-click selection → context menu (duplicate, group, delete, align, distribute).
- Shift+arrow nudge by grid.
- Selection propagates to inspector with mixed-value plumbing (L4).

---

## A-10 Copy / paste

**Status:** todo • **Effort:** M • **Depends on:** L5-copy-paste
**Affects:** new [src/stores/clipboardStore.ts](src/stores/clipboardStore.ts), [src/components/canvas/GraphCanvas.tsx](src/components/canvas/GraphCanvas.tsx)

**Current:** Ctrl+D duplicates with 50px offset; no Ctrl+C/V.
**Figma-perfect:**
- Ctrl+C copies selection (preserves connections among copied nodes; drops external edges).
- Ctrl+V pastes at canvas cursor or shifted from original.
- Ctrl+X cuts (copy then delete).
- ID remap on paste (no collisions).
- Single undo entry per paste.
- Paste between sessions via JSON serialization in localStorage.

---

## A-11 Snap & grid

**Status:** todo • **Effort:** L
**Affects:** [src/components/canvas/GraphCanvas.tsx](src/components/canvas/GraphCanvas.tsx), new snap utilities

**Current:** 80px auto-transition snap; no grid.
**Figma-perfect:**
- Grid overlay toggle (16px default, configurable).
- Snap-to-grid on node drag.
- Snap-to-beat (reads audio BPM).
- Snap-to-parent (align Y with upstream formation).
- Magnetic snap within 8px.
- Hold Shift to disable snap.
- Smart guide lines drawn when dragging near grid lines or peers.

---

## A-12 Context menu

**Status:** todo • **Effort:** L
**Affects:** [src/components/canvas/ContextMenu.tsx](src/components/canvas/ContextMenu.tsx)

**Current:** right-click empty canvas → add-node menu (launch, formation, transition, idle, land).
**Figma-perfect:**
- Right-click on selection → menu (duplicate, delete, align L/C/R/T/M/B, distribute H/V, group/ungroup, send-back/bring-front, properties).
- Right-click empty → add-node + paste.
- ESC dismisses with fade.

---

## A-13 Minimap

**Status:** todo • **Effort:** XL
**Affects:** new [src/components/canvas/MiniMap.tsx](src/components/canvas/MiniMap.tsx)

**Current:** none.
**Figma-perfect:** top-right floating, shows graph overview + viewport indicator, click to focus, auto-hide on small graphs.

---

## A-14 Search (Ctrl+K)

**Status:** todo • **Effort:** M • **Depends on:** L5-cmd-palette
**Affects:** [src/components/NodeSearchPalette.tsx](src/components/NodeSearchPalette.tsx)

**Current:** fuzzy search over nodes (type, ID, data JSON). Cap 20 results. No action commands.
**Figma-perfect:** fuzzy across nodes + formations + colors + actions + recent commands; type-ahead with descriptions; arrow nav; bind custom shortcuts inline.

---

## A-15 Auto-layout

**Status:** mostly done (undo via toast shipped earlier; group-respect + autoLayout test shipped 2026-05-21 ~23:25; 300ms eased animation + preview-before-apply still todo) • **Effort:** S
**Affects:** [src/components/canvas/CanvasToolbar.tsx](src/components/canvas/CanvasToolbar.tsx), [src/components/canvas/autoLayout.ts](src/components/canvas/autoLayout.ts), [src/components/canvas/autoLayout.test.ts](src/components/canvas/autoLayout.test.ts) (new)

**Current:** Auto-layout button repositions nodes by time + greedy first-fit lanes, fits view, fires an info toast with one-click Undo (5s). Skips group nodes themselves AND children inside a group (`node.parentId`) so React Flow's relative-to-parent positioning is preserved. Two unit tests in `autoLayout.test.ts` (chain laning, parent skip).
**Figma-perfect remaining:** 300ms eased animation between current and target positions (React Flow doesn't natively interpolate `setNodePositionsBatch`); preview-before-apply mode.

---

## A-16 Alignment & distribution

**Status:** todo • **Effort:** L
**Affects:** [src/components/canvas/GraphCanvas.tsx](src/components/canvas/GraphCanvas.tsx)

**Current:** none.
**Figma-perfect:** right-click selection → align (L/C/R/T/M/B) + distribute (even h/v) + match-size + match-duration.

---

## A-17 Time ruler + playhead

**Status:** todo • **Effort:** M
**Affects:** [src/components/timeline/TimelineRulerPanel.tsx](src/components/timeline/TimelineRulerPanel.tsx)

**Current:** bars per timed node, click to scrub, mute/solo toggles.
**Figma-perfect:**
- Tick marks + labels at 1s/5s intervals.
- Hover bar → tooltip.
- Drag bar to move startTime with snap.
- Drag right edge to resize duration.
- Alt-drag ripples downstream.
- Dashed for derived nodes, solid for authored.
- Beat markers if audio is loaded.
- Loop region handles on ruler background.
- Playhead has snap modifiers (alt = beat, shift = node boundary), double-click → jump-to-time dialog.
