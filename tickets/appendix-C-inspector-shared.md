# Appendix C — Inspector shared widgets

Each becomes part of the L4 crafted-input library.

---

## C-01 NumberInput

**Status:** done (L4 ship 2026-05-21; lives in `inspectors/shared.tsx`) • **Effort:** M • **Depends on:** —
**Affects:** [src/components/inspectors/shared.tsx](src/components/inspectors/shared.tsx) (`NumberInput`); migration: every numeric field in [src/components/inspectors/](src/components/inspectors/) already uses it.

**Shipped:** drag-to-scrub (shift = ×10, alt = ×0.1, cmd = snap), math eval (`+ - * / % ( )` + decimals + pi), inline unit suffix, selected-on-focus, ↑↓ nudge with shift = ×10, `mixed` prop renders `—` for multi-select with conflicting values, history (shift+↑↓ cycles recent values).

---

## C-02 VectorInput

**Status:** partial (3× NumberInput + axis-colored caps + per-channel mixed-value indicators shipped; channel-lock toggle + drag-along-axis still todo) • **Effort:** S (with L4 NumberInput in place)
**Affects:** [src/components/inspectors/shared.tsx](src/components/inspectors/shared.tsx) (`VectorInput`)

**Current:** three NumberInputs with the standard RGB=XYZ cap colors (red/emerald/blue). Each channel supports its own `mixed` flag for the multi-select pipeline. Step/min/unit pass through to all three.
**Figma-perfect remaining:** channel-lock toggle (uniform scale already inlined as a single-NumberInput → all-three-equal path in keyframe scale; the L4 VectorInput itself doesn't yet expose a chain UI). Drag-along-axis companion (would be a separate L2 handle, not strictly part of VectorInput).

---

## C-03 ColorInput

**Status:** partial (component shipped 2026-05-21 with swatch + popover + recents + eyedropper + mixed; adoption at inline-swatch sites still pending) • **Effort:** M
**Affects:** [src/components/inputs/ColorInput.tsx](src/components/inputs/ColorInput.tsx); migration target: inline `<input type="color">` sites that aren't `ColorProgramEditor`.

**Shipped:** swatch + popover with HexColorPicker, per-session recent-colors row (max 12, localStorage), browser EyeDropper API integration (Chromium only; gracefully ignored elsewhere), mixed-value indicator. Saved-palette/alpha-slider/contrast-readout still todo.

---

## C-04 EasingInput

**Status:** mostly done (popover with draggable cubic-Bézier curve + presets shipped 2026-05-21; hover-preview animated demo still todo) • **Effort:** M
**Affects:** [src/components/inspectors/EasingSelect.tsx](src/components/inspectors/EasingSelect.tsx) (adopted by `FormationNodeInspector` + `ColorKeyframesSection` + `KeyframeCurveEditor`).

**Shipped:** select dropdown of preset easings; "Custom Bézier" opens an inline 2-handle draggable editor (p1 + p2); drag updates `bezierConfig` live. Hover-any-preset → animated demo dot is the remaining polish item.

---

## C-05 SelectInput (registry choices)

**Status:** partial (RegistrySelect shipped 2026-05-21 with L1 preview tiles per option; search-filter + favourites + drag-to-canvas + right-click still todo) • **Effort:** M • **Depends on:** L1
**Affects:** [src/components/inputs/RegistrySelect.tsx](src/components/inputs/RegistrySelect.tsx) (adopted by `IdleNodeInspector` and other registry-driven inspectors).

**Shipped:** popover with each option rendering a live L1 `RegistryItemPreview` tile (generator/transition/idle/color-program previews). Params are forwarded to the preview tiles so e.g. an idle radius/speed change updates the option thumbnail.
**Figma-perfect remaining:** search-filter input at top of popover; star/favourite per option; drag-to-canvas to instantiate; right-click context menu (rename, duplicate, delete).

---

## C-06 Multi-select propagation + mixed-value plumbing

**Status:** todo • **Effort:** M
**Affects:** [src/stores/selectionStore.ts](src/stores/selectionStore.ts) + every input

**Current:** multi-select tracked but doesn't propagate to inspector batch edit.
**Figma-perfect:** every L4 input accepts `value: T | typeof MIXED` and propagates `onChange` across the full selection. Inspector shows mixed-value indicator (`—`). Typing replaces for all. Batch-edit toolbar surfaces when selection size > 1.
