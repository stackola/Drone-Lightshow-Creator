# Leverage projects — Phase 1

The five cross-cutting projects. Each one, done once, multiplies polish across dozens of features.

---

## L1 — Live-edit inspector previews

**Status:** todo
**Effort:** L (3–5d)
**Depends on:** B1
**Affects:** new `src/components/RegistryItemPreview.tsx`; consumed by inspector files, asset panel, AI tool cards.

### Current

38 registry items (7 generators, 3 animated formations, 8 transitions, 10 idle behaviors, 10 color programs) have the same UX shape: inspector form fields → store mutation → results visible *only* if the user scrubs the timeline (and right now not even then; see B1). Users can't see what they're configuring.

### Figma-perfect

- A `<RegistryItemPreview kind="generator|transition|idle|color" id="ring" params={...} size={64|128|240} />` component renders a small live 3D preview, looping where appropriate.
- Loop policy:
  - Generators: spin slowly so depth is visible (12s rotation).
  - Animated formations: play their actual animation, looped.
  - Transitions: 4-second cycle source → target → reset.
  - Idle behaviors: 4-second cycle of the behavior on a representative formation.
  - Color programs: drones in a sample ring cycle through the program.
- Preview re-renders within 1 frame of param changes (subscribes to store, not props).
- Cached representative formations so the preview's source data is consistent across renders.
- Click-to-expand for a full-size inspection in a popover.

### Adoption sites

- Inspector panels for each registry kind (5 inspectors).
- Asset panel (formation library cards).
- AI tool result cards (L3) — `create_formation`, `set_color_program`, `add_transition_node`, etc.
- `<SelectInput>` (L4) — each option in the dropdown.

### Notes

Implementation can re-use the existing `DroneCloud`/`evaluateAtTime` pipeline at a smaller resolution. Use an off-screen Canvas (or `OffscreenCanvas` if available) per preview to avoid contention with the main viewport.

---

## L2 — Direct-manipulation 3D handle library

**Status:** todo
**Effort:** L (4–6d)
**Depends on:** B1
**Affects:** new `src/components/viewport/handles/`; consumed by formation gizmo, every generator/transition/idle param.

### Current

~30 generator/transition/idle parameters today exist only as inspector number fields — radius, tilt, count, lemniscate aspect, drift direction, etc. The 3D viewport is a passive preview. Figma-tier products replace these with handles you drag in the actual scene.

### Figma-perfect

Five handle primitives, used everywhere:

1. **RadiusHandle** — drag along an axis to set a scalar radius. Live readout. Shift = snap, ESC = cancel.
2. **PlaneHandle** — gimbal-rotates a tilt plane. Shows the plane translucent during drag.
3. **CountHandle** — small "+N / −N" pip; drag to adjust count. Live pair-spacing violation feedback (drones turn red when too close).
4. **CenterHandle** — translate a point in 3D with axis lock (shift = X, control = Z, alt = Y).
5. **DirectionHandle** — drag an arrow to set a unit vector. Optionally constrained to XZ plane (for ground-plane direction).

All handles:
- Screen-constant size at all zoom levels.
- Cursor changes during drag (`grabbing`, `grab` on hover).
- Snap with modifier keys (shift = grid, cmd = peer-snap to other formations).
- Tooltip with live numeric values.
- Multi-target: if multi-select is active, handle drives all selected targets.
- ESC cancels drag and reverts.
- Single undo entry per drag (not per pixel).

### Adoption sites

- Ring, sphere, spiral, line, arc, heart, star — radius / count / plane.
- Orbit, breathe, pulse, wave, spin, sparkle, drift — radius / center / direction.
- Cascade, sweep — direction.
- Explosion, implosion — center.

---

## L3 — AI tool-call card system

**Status:** todo
**Effort:** L (4–6d)
**Depends on:** L1 (cards embed previews), B1 (so the affected-node-highlights-on-click works live)
**Affects:** new `src/components/chat/ToolCallCard.tsx` and per-tool body slots; consumed by [src/components/AIToolCard.tsx](src/components/AIToolCard.tsx) (which is currently the raw renderer).

### Current

47 AI tools render their results as JSON text in the chat panel. The chat is currently more of a "log dump" than an editor surface.

### Figma-perfect

Base card has:
- Title (the tool's verb form, e.g. "Created formation 'Heart Ring' with 80 points").
- Status badge (✓ done / ⚠ partial / ✗ failed).
- Inline action buttons configurable per tool ("Undo this", "Edit parameters", "Show in graph", "Apply suggestion").
- Per-tool body slot — see below.
- Clicking the card highlights the affected node in both graph canvas + 3D viewport.
- Animates in on mount; collapses to a single-line summary when older than 5 entries.

Per-tool body slots, prioritized for the night's work:
- **create_formation / update_formation:** L1 thumbnail preview of the formation. Point count, generator name.
- **add_keyframe / remove_keyframe:** mini timeline showing all keyframes on the node, with the new one highlighted.
- **fix_all_violations / auto_time_show:** structured "fixed N violations, M remain" diff. List each fix with a one-line description and a per-fix undo button.
- **set_color_program:** before/after color swatch row.
- **set_transition_strategy:** before/after strategy chips, physics-safety badge.
- **evaluate_at_time:** scrubber that drives the viewport.
- **create_show_from_outline:** progress-during-build, success card with play button.
- **critique_show:** suggestion list with per-suggestion "Apply" button linking to the relevant write tool.

### Notes

The card is the single biggest visible-to-strangers transformation in the app. After this lands, AI is no longer "a chat panel" but "a real collaborator with visible work product."

---

## L4 — Crafted-input library

**Status:** todo
**Effort:** L (5–7d) including multi-select plumbing
**Depends on:** —
**Affects:** new `src/components/inputs/`; consumed by every inspector.

### Current

Inspector inputs are standard React forms. Number = `<input type="number">`, vector = three of those, color = `HexColorPicker`, easing = dropdown. No drag-scrub, no math, no units, no nudge, no mixed-value indicators, no eyedropper, no draggable Bézier handles.

### Figma-perfect

Five components, well-crafted:

1. **NumberInput** —
   - drag-to-scrub by default (cursor changes to `ew-resize`, no axis lock yet).
   - shift = ×10 multiplier, alt = ×0.1, cmd = snap to round.
   - math expression evaluation on submit (`2*pi`, `15+3`, `geofence/2`).
   - inline unit suffix (`m`, `°`, `s`).
   - selected-on-focus.
   - ↑↓ arrow nudge by step; shift+arrow = ×10.
   - "mixed" indicator (`—`) on multi-select.
   - history: ↑↓ cycles previous values.
2. **VectorInput** — three NumberInputs + axis-colored labels (x=red, y=green, z=blue) + a channel-lock toggle. Drag-along-axis companion in the 3D viewport (lights up the matching axis ring).
3. **ColorInput** — swatch + popover with hex/HSL/RGB tabs, recent-colors row, eyedropper (samples from viewport), saved palette, alpha slider.
4. **EasingInput** — popover with draggable Bézier curve. Shift constrains a handle. Named preset row at top.
5. **SelectInput** (registry choices) — uses L1 preview in each option. Search-filter input. Star/favorite toggle.

### Multi-select plumbing

Every input accepts a `value: T | typeof MIXED` and an `onChange: (v: T) => void` that propagates to all selected targets. The store handles "edit this property across N selected nodes."

### Notes

After L4 lands, every form field in the app feels different. This is the single highest "feels like a product" boost per dollar.

---

## L5 — Systems pass

**Status:** todo
**Effort:** ~1 week (each sub-item is S–M)
**Depends on:** —
**Affects:** sweeping; see sub-tickets below.

### Sub-tickets

- **L5-toast:** Wire `useToast()` to every service rejection. ([src/services/*.ts](src/services/), [src/hooks/useAutosave.ts](src/hooks/useAutosave.ts), [src/services/aiChatService.ts](src/services/aiChatService.ts) etc.) (S)
- **L5-undo-names:** Add `actionName` to every history snapshot. Render in undo/redo tooltips and a history palette popover. ([src/stores/historyStore.ts](src/stores/historyStore.ts)) (S)
- **L5-undo-grouping:** Coalesce rapid mutations into one history entry (drag start→end = one undo). (M)
- **L5-error-boundary:** ErrorBoundary `componentDidCatch` logs error + componentStack. Optional dev-only panel that lists recent crashes. (S; partly covered by B2)
- **L5-tokens:** Define design tokens — semantic colors (`surface`, `surface-hover`, `text-error`, `accent`), type scale, motion durations + easings. Add to `tailwind.config.ts` and migrate ad-hoc Tailwind incrementally. (M; foundation work)
- **L5-copy-paste:** Implement clipboard for nodes + keyframes + formations. Ctrl+C/V/X. ID remap on paste. Paste at canvas cursor. (M)
- **L5-cmd-palette:** Extend Ctrl+K from node-search-only to action-search-too. Fuzzy match across nodes + formations + colors + commands ("toggle grid", "bake show", "export CSV"). Recent commands at top. Action descriptions inline. (M)
- **L5-tooltips:** One `<Tooltip>` component used everywhere. 300ms delay / 200ms dismiss. Keyboard-accessible. Terse copy on every non-obvious affordance. (S; ongoing)
- **L5-focus-traps:** Add focus traps to every modal (Welcome, Export, Shortcuts, AI Settings). Visible focus ring with 2px offset. (M)

Each sub-item is small. The whole pass is roughly a week, but each piece is shippable on its own.

### Notes

This is the single highest "feels like a real product" lift per hour. After L5, the app stops hiding its failures, undo says what it's undoing, copy/paste works, every action is in the command palette.
