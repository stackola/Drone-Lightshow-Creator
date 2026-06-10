# Appendix D — Inspector: Formation node specifics

Per-section tickets for the Formation Node Inspector.

---

## D-01 Shape dropdown

**Status:** todo • **Effort:** M • **Depends on:** L1, C-05 (SelectInput)
**Affects:** [src/components/inspectors/FormationNodeInspector.tsx](src/components/inspectors/FormationNodeInspector.tsx)

**Figma-perfect:** L1 thumbnail in header; search-by-name; star/favorite; show point count + generator type; drag-to-canvas to create new formation; right-click (duplicate, delete, rename).

---

## D-02 Generator selection + parameters

**Status:** todo • **Effort:** M • **Depends on:** L1, C-01
**Affects:** [src/components/inspectors/FormationNodeInspector.tsx](src/components/inspectors/FormationNodeInspector.tsx)

**Figma-perfect:** L1 preview in header that updates as parameters change; parameter sliders inline; reset-to-default per parameter; show units; undo/redo per parameter change; copy-parameters-to-clipboard.

---

## D-03 Transform

**Status:** todo • **Effort:** M • **Depends on:** C-02
**Affects:** [src/components/inspectors/FormationNodeInspector.tsx](src/components/inspectors/FormationNodeInspector.tsx) (`TransformSection`)

**Figma-perfect:** three L4 VectorInputs (position / rotation / scale); aspect-lock toggle for scale; drag-along-axis companion using L2 handles.

---

## D-04 Keyframes (KeyframeCurveEditor)

**Status:** todo • **Effort:** L • **Depends on:** L4, S4
**Affects:** [src/components/KeyframeCurveEditor.tsx](src/components/KeyframeCurveEditor.tsx)

Subsumed by S4. See `surfaces.md` § S4.

---

## D-05 Duration resize

**Status:** todo • **Effort:** M
**Affects:** [src/components/canvas/nodes/FormationNode.tsx](src/components/canvas/nodes/FormationNode.tsx)

**Figma-perfect:** right-edge drag with shift = beat-snap, alt = ripple downstream, double-click → numeric edit, ruler annotation during drag ("3.5s").

---

## D-06 Color program section

**Status:** todo • **Effort:** M • **Depends on:** L1, C-03 (ColorInput), C-05
**Affects:** [src/components/inspectors/ColorProgramEditor.tsx](src/components/inspectors/ColorProgramEditor.tsx)

**Figma-perfect:** inline swatch grid of programs (click to apply); add-to-library button; eyedropper; gradient stop editor; animate-color-over-time toggle; recent colors history; name with library auto-suggest. Resolve schema drift with one-shot migration + discriminated union (delete the `as any` cascade at lines 53–65).

---

## D-07 Idle configs

**Status:** todo • **Effort:** M • **Depends on:** L1, B3
**Affects:** [src/components/inspectors/IdleConfigsSection.tsx](src/components/inspectors/IdleConfigsSection.tsx) (or similar)

**Figma-perfect:** expandable cards per attached idle; drag-to-reorder with placeholder; delete + clone per config; multi-select + batch edit; L1 preview of behavior in viewport.

---

## D-08 Symmetry + annotations

**Status:** todo • **Effort:** L (symmetry XL if not already partially implemented)
**Affects:** [src/components/inspectors/FormationNodeInspector.tsx](src/components/inspectors/FormationNodeInspector.tsx)

**Figma-perfect (symmetry):** dropdown (None / X / Y / Z / Radial); symmetry plane shown in viewport; mirror + flip buttons; live mirrored preview during edit.
**Figma-perfect (annotations):** editable list with add/delete; click annotation to jump to time in timeline; drag-reorder; text-search; batch tagging.
