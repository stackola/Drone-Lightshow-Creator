# Appendix O — System-wide concerns

Cross-cutting items that live in every panel. Many are already itemized as L5 sub-tickets — this file is the per-concern view.

---

## O-01 Error UX

**Status:** todo • **Effort:** XL (~80% covered by L5-toast + L5-error-boundary)
**Affects:** every service file, every try/catch site

**Figma-perfect:** semantic per-domain error messages; inline indicators at problem location; undo from error toast; "fix all" action buttons in error toasts where applicable; error replay log; ErrorBoundary `componentDidCatch` logs to a dev panel.

---

## O-02 Loading states

**Status:** todo • **Effort:** M
**Affects:** Suspense boundaries, every async operation

**Current:** one Suspense "Loading 3D…" fallback; silent autosave; no progress bars on bake/export/AI calls.
**Figma-perfect:** skeleton layouts matching final DOM; progress bars with realistic ETAs on long ops; optimistic UI; anticipatory rendering.

---

## O-03 Empty states

**Status:** todo • **Effort:** M
**Affects:** every panel

**Figma-perfect:** every panel has a designed empty state with a CTA + contextual hint ("right-click to add formation", "select a node to edit").

---

## O-04 Keyboard shortcuts coverage

**Status:** todo • **Effort:** L (most covered by L5-cmd-palette + L5-copy-paste)
**Affects:** [src/components/KeyboardShortcutsOverlay.tsx](src/components/KeyboardShortcutsOverlay.tsx), global key handlers

**Figma-perfect:** Ctrl+C/V/X (copy/paste/cut), Ctrl+G/Shift+G (group/ungroup), Ctrl+L (lock), Ctrl+H (hide), 1/2/3/4 (camera presets), GG (ground toggle), MM (minimap), A→… (align mode), shift+arrow (nudge), shift+F (fit selection).

---

## O-05 Undo / redo

**Status:** done (L5 ship 2026-05-21; semantic action names everywhere, `labelForNextUndo` + toast on each Ctrl+Z, HistoryPalette popover at Ctrl+Shift+H, undo works across panels since the store is global) • **Effort:** M (covered by L5-undo-names + L5-undo-grouping)
**Affects:** [src/stores/historyStore.ts](src/stores/historyStore.ts), [src/components/HistoryPalette.tsx](src/components/HistoryPalette.tsx)

**Shipped:** every snapshot site has a semantic label (`"Move Formation"`, `"Add keyframe"`, `"Mirror X"`, `"Set transition arcHeight"`, etc.); Ctrl+Z toasts `Undo: <label>` for instant feedback; Ctrl+Shift+H opens the history palette with the full undo stack; rapid drag mutations are grouped under one snapshot (e.g. gizmo drag = one entry, not 60).

---

## O-06 Multi-select

**Status:** todo • **Effort:** L (depends on L4)
**Affects:** [src/stores/selectionStore.ts](src/stores/selectionStore.ts), inspector, canvas, 3D

**Figma-perfect:** bounding-box gizmo in canvas + 3D; mixed-value indicators in inspector (L4); batch-edit toolbar; align/distribute actions; selection survives panel resize / mode switch.

---

## O-07 Copy / paste

**Status:** done (L5 ship 2026-05-21; clipboard module at `src/stores/clipboardStore.ts`, Ctrl+C/V/X wired in `useCanvasKeyboard`, ID remap + edge reconnection on paste, paste reproduces selection across tabs via localStorage mirror) • **Effort:** M (covered by L5-copy-paste)
**Affects:** [src/stores/clipboardStore.ts](src/stores/clipboardStore.ts), [src/components/canvas/useCanvasKeyboard.ts](src/components/canvas/useCanvasKeyboard.ts)

**Shipped:** module-level setClipboard/getClipboard/hasClipboard. Ctrl+C copies selected nodes + the edges that connect them; Ctrl+V pastes with regenerated IDs and reattached edges; Ctrl+X cuts. Survives cross-tab via localStorage.

---

## O-08 Tooltips

**Status:** done (L5 ship 2026-05-21; `Tooltip` component lives at [src/components/Tooltip.tsx](src/components/Tooltip.tsx) with 300 ms default delay, focus-accessible, side='auto'/'top'/etc, optional shortcut prop; adopted across CanvasToolbar, TransportControls, TimelineRulerPanel, ViewportSettingsButton, etc.) • **Effort:** S (L5-tooltips)
**Affects:** [src/components/Tooltip.tsx](src/components/Tooltip.tsx) + every control.

---

## O-09 Motion language

**Status:** done (L5 ship 2026-05-21; motion tokens in tailwind config — durations 0/75/100/150/200/300/500/800 ms, easings standard/enter/exit/spring matching Material; `prefers-reduced-motion: reduce` honored in src/index.css) • **Effort:** M (L5-tokens)
**Affects:** [tailwind.config.ts](tailwind.config.ts), [src/index.css](src/index.css)

**Shipped:** `transition-duration-*`/`ease-*` utilities from the motion-token scale; reduced-motion media query kills all transitions/animations except those marked `motion-safe:`.

---

## O-10 Theme / color / typography

**Status:** todo • **Effort:** L (L5-tokens, ongoing migration)
**Affects:** [tailwind.config.ts](tailwind.config.ts), every component

**Figma-perfect:** semantic tokens (`surface`, `surface-hover`, `text-error`, `accent-primary`, etc.); type scale (h1 24/600, h2 20/600, body 14/400, caption 12/500); explicit dark-mode-first with optional light; WCAG AA contrast validated.

---

## O-11 Accessibility

**Status:** todo • **Effort:** L
**Affects:** every interactive component

**Figma-perfect:** `aria-label` on every button/input (not just `title`); focus-lock library on modals; visible focus ring (4px outline, 2px offset); full keyboard nav of all panels; screen-reader labels on status indicators; color contrast 7:1 for text on backgrounds.

---

## O-12 Performance feel

**Status:** todo • **Effort:** M
**Affects:** [src/components/](src/components/), eval pipeline

**Figma-perfect:** 60 fps under all tested loads; lists >50 virtualized; RAF scheduling for expensive updates; input latency <50ms; profile with 1000-node graph; add Web Workers for heavy compute beyond bake.

---

## O-13 Settings & preferences

**Status:** todo • **Effort:** M
**Affects:** new [src/components/SettingsPanel.tsx](src/components/SettingsPanel.tsx), new settings store

**Figma-perfect:** per-user (theme, autosave freq, keyboard layout, grid spacing, cursor size); per-project (drone pool, units, timebase, constraints); sync (OS-level, cloud, or git-backed); import/export prefs as JSON.

---

## O-14 Search / command palette

**Status:** todo • **Effort:** M (L5-cmd-palette)
**Affects:** [src/components/NodeSearchPalette.tsx](src/components/NodeSearchPalette.tsx)

**Figma-perfect:** fuzzy match across nodes + formations + colors + actions + recent commands; type-ahead descriptions; arrow nav; recent at top; bind custom shortcuts inline.

---

## O-15 Notifications / toasts

**Status:** mostly done (L5 ship 2026-05-21; severity-based default durations, action buttons via `opts.action`, duplicate prevention within 1 s, module-level + hook-style emitter, ToastProvider wired in App) • **Effort:** S (L5-toast adoption)
**Affects:** [src/components/Toast.tsx](src/components/Toast.tsx)

**Figma-perfect remaining:** rich content (code blocks, links); do-not-disturb mode for non-urgent — both lower priority.

---

## O-16 Drag-and-drop

**Status:** todo • **Effort:** L
**Affects:** every drag handler

**Figma-perfect:** unified drag affordance library (cursor changes, ghost image, drop-target highlights); keyboard-aware (shift = snap, ctrl = copy); touch support; drag batched as one undo entry.

---

## O-17 Mobile / touch

**Status:** out-of-scope (defensible)

Not required for a power-user editor. Would need a full responsive redesign; would take XL+. Note if revisited.
