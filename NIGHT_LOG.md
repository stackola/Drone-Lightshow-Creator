# Night Log — Figma-Tier Lift

Session started overnight by user request. Plan reference: `/home/stackola/.claude/plans/we-have-built-many-atomic-penguin.md`.

User direction: expand the appendix into per-feature tickets, then implement, continuing until done. Note anything worth telling them about in the morning. They went to bed.

Honesty disclaimers I gave the user up front:
- The full plan is 4–6 months. Overnight I can ship the ticket expansion, the bleeding fixes (B1/B2/B3/B3a), L5 systems pass, L4 crafted inputs, and partial L1/L2/L3.
- No git repo here (`Is a git repository: false`). I'm working in place and logging every change in this file so they can review and stage in the morning.
- I won't match a top-tier designer's taste on every micro-decision. Where I'm unsure I'll pick a defensible default and note it.

---

## What's in this file

- **Done** — changes shipped + what they affect.
- **Worth telling you** — surprises, decisions I made that you may want to revisit, things I deferred.
- **Verification ledger** — for each change: did typecheck pass, did lint pass, did relevant tests run.

Updated incrementally as work progresses. Newest entries first under each section.

---

## Autonomous mode state

User asked for sustained autonomous progress with a 3-minute wake-up cadence between sessions (round 6 instruction "no 30 minute nap, just 3 minutes nap between each session"). Currently using `ScheduleWakeup` with the `<<autonomous-loop-dynamic>>` sentinel at 180 s intervals; the runtime clamps within the conversation's lifetime, so this isn't a true multi-week run — when this session ends, the wake-up loop ends with it. The persistent state lives in [tickets/](tickets/) + [TICKETS_TODO.md](TICKETS_TODO.md) and any future session can resume from those.

## Worth telling you in the morning

**Updated after round 2 ("why did you stop") + your crash report.**

**Updated after round 4 ("contiue with all tickets until you are done with all of them. load up your todo list bigly").**

**Headline:** four bleeding fixes shipped, full L5 systems pass shipped, L4 with **four crafted inputs** (NumberInput, VectorInput, ColorInput, RegistrySelect) and an upgraded EasingSelect, L1 (RegistryItemPreview + 5 adoption sites: 3 inspectors, asset panel, FormationNode card), L3 (~38 of ~49 AI tool body slots — most of the chat surface now renders rich previews), L2 with **all 5 handle primitives** (Radius, Count, Center, Direction, Plane) and 4 adoption wrappers (idle radius / idle center / formation count / generator radius), S1 partial (mutation-counter eval cache), HistoryPalette, postprocessing crash fix, marquee selection, time-ruler tick refresh, ground-plane GG toggle, transport keyboard (← → frame scrub + Loop button), W/E/R gizmo mode keyboard, animated edge-flow particles, FPS rolling sparkline, auto-layout one-click Undo, pre-export validation banner. Tests **648 / 648**. Typecheck + lint + build clean.

The single most consequential change is **B1**: the gizmo and inspector regression you noticed is gone. The cause was an evaluation cache in [Viewport3D.tsx:79](src/components/viewport/Viewport3D.tsx#L79) that hashed `${nodes.length}-${edges.length}-${time}` and reused stale results when neither count changed — so every transform/color/idle edit was silently invisible. Cache deleted; live preview is honestly live now. The proper long-term fix (one shared eval pipeline both Canvases subscribe to) is **S1** in the plan and not yet done.

**Second headline: B3** (idle behavior rewrite). The "defaults to overlapping" complaint was real and structural. 9 of 10 behaviors collapsed any source formation onto a single ring of `params.radius`, giving sub-spacing pair distances. Rewrite ships a `distributeRingStack` helper that scatters drones over concentric rings sized to satisfy `minSpacing`, with per-behavior modulation on top. Spacing test asserts no pair drops below `0.85·minSpacing` across all 9 non-hover behaviors with 50 drones × 16 time samples. **The visual character of idle behaviors is noticeably different from before** — expect a small "huh, this looks different" moment when you scrub the existing demos. Probably better, but worth eyeballing.

**Things that feel different now even if you don't see them directly:**
- Autosave failures, MP4-export-not-supported, and Ctrl+O failures now surface as toasts instead of dying silently.
- Ctrl+Z / Ctrl+Y now toast `"Undo: Move Formation"` instead of just doing nothing visible.
- Ctrl+K opens a real command palette — arrow-key nav, 11 actions wired, recent commands persist, fuzzy match across actions + nodes.
- Ctrl+C / Ctrl+V / Ctrl+X work on the canvas now. Cross-tab paste works via localStorage.
- Every number input does math expressions, ↑↓ nudge with shift/alt modifiers, mixed-value indicator for multi-select.
- The formation node's generator dropdown shows a tiny live thumbnail of what you'll get.
- Attached idle behaviors show live animated thumbnails.
- AI tool result cards now have rich bodies for the 6 most-used tools (create_formation shows the result thumbnail, fix_all_violations shows a structured diff, etc.).
- Panel crashes now log the stack to console + dev-only `panelCrashLog`, and the boundary's error UI has "Show details" + "Copy details" buttons.

**Honest disclaimers / things to look at:**
- The MP4 export was lying — silently falling back to WebM. Now it warns and gives the file the correct extension. Test this if you regularly export video.
- I tuned swarm's drift amplitude way down (0.3 → 0.075) to stay within the new spacing budget. If swarms feel too tame, the constant lives in `swarmBehavior.getPosition`. Same idea for sparkle (`0.5 + 0.5·sin` → `0.85 + 0.15·sin`).
- The lemniscate (figure-8) used to overlap drones near its neck. Fix uses a contraction floor of 0.55 to expand radius enough for spacing — figure-8 ring radii are noticeably bigger now.
- L5-tokens defines a full design token system but **doesn't migrate any existing components** to use it. That's a multi-day migration. The tokens are live in `tailwind.config.ts` + `src/index.css` for new code.
- The `RegistryItemPreview` `transition` kind shows a generic source→target lerp regardless of strategy. Wiring per-strategy previews is a follow-up.
- 49 of 77 `snapshot()` call sites still use the default "Edit" label. The user-visible critical ones (gizmo, context menu, AI tool engine, key inspectors) all have specific labels.
- `aiFormationCritic.ts` used to return a misleading `score: 5, 'critic parse failed'` sentinel on JSON parse failure. Now throws. The single existing caller wraps it correctly.

**No git repo here**, so nothing is committed. Everything's in the working tree. Review with `git -C ../somewhere init && git add . && git status` from the repo root, or just diff against the README's "Project shape" baseline numbers. Files I changed (or added):

```
src/components/viewport/Viewport3D.tsx
src/components/ErrorBoundary.tsx
src/registries/idleBehaviors.ts
src/registries/idleBehaviors.test.ts
src/graph/nodeEvaluators.ts
src/components/Toast.tsx
src/services/autosave.ts
src/services/videoExport.ts
src/services/aiFormationCritic.ts
src/components/ExportDialog.tsx
src/app/App.tsx
src/stores/historyStore.ts
src/services/aiToolEngine.ts
src/components/viewport/FormationGizmo.tsx
src/components/canvas/useCanvasKeyboard.ts
src/components/canvas/ContextMenu.tsx
src/components/canvas/CanvasToolbar.tsx
src/components/canvas/useDurationResize.ts
src/components/canvas/EmptyState.tsx
src/components/inspectors/{EdgeInspector,FormationNodeInspector,LaunchNodeInspector,LandNodeInspector,IdleNodeInspector,AnnotationsSection,ColorOverridesSection,ColorKeyframesSection,InspectorPanel,TransitionNodeInspector,shared}.tsx
src/components/panels/AssetPanel.tsx
src/components/panels/ViolationsPanel.tsx
src/components/HeaderBar.tsx
src/components/AIChatPanel.tsx
src/components/HistoryPalette.tsx                              (new, L5-undo)
src/components/canvas/CanvasToolbar.tsx
src/components/viewport/TransportControls.tsx
src/components/viewport/TimelineRulerPanel.tsx
src/components/viewport/ViewportOverlays.tsx
src/components/viewport/handles/RadiusHandle.tsx               (new, L2)
src/components/viewport/handles/IdleRadiusHandle.tsx           (new, L2 adoption)
src/components/viewport/handles/CountHandle.tsx                (new, L2)
src/components/viewport/handles/FormationCountHandle.tsx       (new, L2 adoption)
src/components/KeyboardShortcutsOverlay.tsx
src/registries/colorPrograms.test.ts                           (new, +10 tests)
src/stores/historyStore.ts
src/stores/graphStore.ts + formationStore.ts + projectStore.ts (S1 mutation counters)
tailwind.config.ts + src/index.css                             (L5-tokens)
package.json + pnpm-lock.yaml                                  (postprocessing 3.0.4 → 2.19.1)
src/components/NodeSearchPalette.tsx
src/components/Tooltip.tsx                  (new)
src/components/RegistryItemPreview.tsx      (new)
src/components/AIToolCard.tsx
src/stores/clipboardStore.ts                (new)
tailwind.config.ts
src/index.css
+ NIGHT_LOG.md (this file)
+ tickets/                                  (new — 17 files, ~150 ticket sections)
+ /home/stackola/.claude/plans/we-have-built-many-atomic-penguin.md (the plan)
```


---

### Item 5 — Direct manipulation point editing in 3D (2026-05-22 ~10:44 UTC)

The `usePointEditor` hook existed but was never wired anywhere. Built the full feature:

- **Singleton store** `usePointEditorStore` ([src/components/viewport/PointEditor.tsx](src/components/viewport/PointEditor.tsx)) — `isActive`, `formationId`, `selectedIndices`, plus `enterEditMode` / `exitEditMode` / `selectPoint` / `selectMany` / `clearSelection` / `selectAll` / `moveSelected`. Legacy hook kept for any future caller.
- **`<PointEditorGizmo />`** ([new file](src/components/viewport/PointEditorGizmo.tsx)) — PivotControls at the selection centroid, anchored in world space (formation node's `transform.position` applied). Drag → `moveSelected(delta)` per tick, converting world-space delta back to formation-local-space via the host node's `transform.scale`. One snapshot per drag for clean undo: `"Move N drones"`. Esc exits edit mode; Ctrl+A selects all points.
- **`<PointEditToggle />`** in FormationNodeInspector — a chip button labelled "Edit Points" / "Point Edit · N selected". Active state styled cyan. "Clear" button reveals when ≥1 selected.
- **DroneCloud highlight loop** — selected drones render 50% bigger and tinted toward cyan; unselected drones dim to 60% so the selection reads at a glance.
- **6 store tests** — enterEditMode, exitEditMode, additive vs replace selectPoint, selectMany batch add, clearSelection preserves activity.

End-to-end flow: open a formation in the inspector → click "Edit Points" → click drones in the viewport (shift to add) → drag the cyan gizmo → drones move along the snap-plane + symmetry-aware path → Esc to exit.

Test count 759 → 765.

**Verification:** 765/765 unit + 42/42 e2e Chromium + typecheck + build all clean.

---

### S1 / S4 step 12 / L4 / L3 push — items 1-4 of the honest gap list (2026-05-22 ~10:37 UTC)

After the user flagged that the app wasn't actually Figma-tier and asked me to attack items 1-14 in order, I shipped the first four.

**1. S1 — derived-signal eval pipeline.** Replaced the module-level `_evalCache` with a real Zustand store [`evaluationStore`](src/stores/evaluationStore.ts) holding `{ states, sig, version, errorSig }`. New [`<EvaluatorTick />`](src/components/viewport/EvaluatorTick.tsx) is the *single* useFrame writer at renderPriority -1. DroneCloud + DroneHoverIndicator now each have a ~5-line useFrame that just calls `peekDroneStates()`. Non-3D consumers (inspectors, panels) can now subscribe to `version` without mounting their own `useFrame` — the architectural unlock the original plan called for. Audience viewport also mounts the tick. 6 new tests.

**2. S4 step 12 — draggable Bézier tangent handles.** Cubic-bezier keyframes now show two cyan circle handles + dashed leader lines in [KeyframeCurveEditor.tsx](src/components/KeyframeCurveEditor.tsx). Drag a handle → updates `bezierConfig.{x1,y1}` (outgoing tangent from previous keyframe) or `{x2,y2}` (incoming tangent to this keyframe). x is clamped to [0,1] for monotonicity; y is free so overshoot easings are reachable. One snapshot per drag = one undo. Also fixed a long-standing bug where the curve renderer wasn't passing `bezierConfig` through `applyEasing`, so cubic-bezier keyframes were showing the default curve regardless of config.

**3. L4 ColorInput adoption.** [ColorOverridesSection](src/components/inspectors/ColorOverridesSection.tsx) now uses the L4 `<ColorInput>` (swatch + popover + eyedropper + session recents) instead of the bespoke expand-inline `HexColorPicker`. ColorProgramEditor keeps its larger gradient editor — that's a different UX shape (multi-stop gradient with draggable stops), not a candidate for the swatch-popover treatment.

**4. L3 AI tool card fallback.** Audit showed every registered tool already has a body case — my earlier "11 remaining" estimate was stale. What was actually missing: when a body case bailed early (data undefined, edge condition), the card rendered nothing. Wrapped `<ToolBody>` so any null return falls through to a `Check ✓ done` one-liner. No empty-success cards possible now.

**Verification:** 759/759 unit (added 6 evaluationStore tests) + 42/42 e2e Chromium + typecheck + build all clean.

**Honest gap remaining (items 5-14):**
5. Direct manipulation in 3D — drag generator params/points with constraints, snap-to-formation, smart-guide.
6. Animated formations (firework burst, breathing sphere, apple tree) parameterised with sliders.
7. Multi-select gizmo rotate/scale around centroid.
8. Inspector "locked" gating with disabled-state visuals on each input (not just `pointer-events: none`).
9. Loop region drag handles on the timeline ruler.
10. Smart guides + snap-to-other-formation in 3D.
11. `aiFormationCritic` surfaced on formation cards.
12. RegistrySelect search-filter + favorites + drag-to-canvas.
13. Hover video previews on demo grid tiles.
14. Cinematic post-fx — DoF + color grading.

Each is hour-to-multi-day; I'll commit one full deliverable per iteration so each lands clean rather than half-shipping all of them.

---

### AssetPanel library empty state copy (2026-05-22 ~03:55 UTC)

[src/components/panels/AssetPanel.tsx](src/components/panels/AssetPanel.tsx) — the library empty state was previously one line; if a user ever saw it they'd be confused (library is built into the bundle). Updated copy to explain *why* this state shouldn't normally appear: "Library formations are baked into the build — if you're seeing this, the registry didn't load." Tiny defensive UX improvement.

**Verification:** 753/753 unit + typecheck + build all clean.

---

### 2 more formationStore tests (2026-05-22 ~03:29 UTC)

[src/stores/formationStore.test.ts](src/stores/formationStore.test.ts) — added two coverage gaps:
- `regeneratePoints` on an animated formation refreshes rest positions from the cached def (sanity-checks the animDef path by stomping the cache first)
- `regeneratePoints` on an unknown id is a no-op (locks in the early `if (!f) return` guard)

Test count 751 → 753.

**Verification:** 753/753 unit + 42/42 e2e Chromium (last verified) + typecheck + build all clean.

---

### StatusBar saved / unsaved / violation icons (2026-05-22 ~03:00 UTC)

[src/components/StatusBar.tsx](src/components/StatusBar.tsx) — replaced the bare text "Saved" / "Unsaved" with an inline icon + label: lucide `Check` for saved (green), `CircleDot` for unsaved (orange). Violation count gets a `AlertTriangle` icon in front of the number. Subtle but the icons read faster than the words in peripheral vision.

**Verification:** 751/751 unit + 42/42 e2e Chromium + typecheck + build all clean.

---

### ConstraintsPanel upgrades to L4 NumberInput (2026-05-22 ~02:54 UTC)

[src/components/inspectors/InspectorPanel.tsx](src/components/inspectors/InspectorPanel.tsx) — the project-settings tab's local `NumInput` was a raw `<input type="number">` from before L4 NumberInput shipped. Pointed it at the L4 component (aliased as `NumInput` so the 17 call sites stay untouched). All ConstraintsPanel inputs (drone count, layout spacing, max velocity / acceleration / jerk / ascent / descent, min distance, vel + spacing margins, battery reserve, wind speed + gust factor, GPS accuracy, geofence radius / alt min / alt max, max flight time) now inherit drag-to-scrub, math expressions (e.g. `geofence/2`), ↑↓ nudge with shift=×10, and the mixed-value plumbing for free.

**Verification:** 751/751 unit + 42/42 e2e Chromium + typecheck + build all clean.

---

### formationStore unit tests (2026-05-22 ~02:47 UTC)

[src/stores/formationStore.test.ts](src/stores/formationStore.test.ts) (new) — 7 tests for the formation store's non-generator paths (the generator integration is already covered by `registries/generators.test.ts`):

- starts empty
- `addAnimatedFormation` registers def + cached rest positions + formation row
- `removeFormation` drops all three caches
- `updateFormation` patches name/tags but **ignores** any `id` in the patch (prevents reference corruption — locks in the existing defensive code at L109)
- `updateAnimatedDef` refreshes rest positions + pointCount
- `getFormation` / `getPoints` / `getAnimatedDef` round-trip; unknown ids return undefined
- `loadFormations` replaces store contents wholesale

Test count 744 → 751.

**Verification:** 751/751 unit + 42/42 e2e Chromium + typecheck + build all clean.

---

### Polished WelcomeScreen "no recent projects" empty state (2026-05-22 ~02:38 UTC)

[src/components/WelcomeScreen.tsx](src/components/WelcomeScreen.tsx) — replaced the bare "No recent projects" text with a designed empty state: small `Clock` icon, headline, and a coaching subtitle ("Open or save any project once and it'll appear here for one-click reload."). Matches the visual language of the other recently-polished empty states (ViolationsPanel, NodeSearchPalette, HistoryPalette).

**Verification:** 744/744 unit + 42/42 e2e Chromium + typecheck + build all clean.

---

### Polished HistoryPalette empty state (2026-05-22 ~02:32 UTC)

[src/components/HistoryPalette.tsx](src/components/HistoryPalette.tsx) — replaced the one-line "No history yet — start editing." with a designed empty state: lucide `History` icon (22 px), "**No history yet**" headline, and a two-line subtitle that explains both Ctrl+Z and the click-to-jump-N pattern.

**Verification:** 744/744 unit + 42/42 e2e Chromium + typecheck + build all clean.

---

### audioStore unit tests (2026-05-22 ~02:26 UTC)

[src/stores/audioStore.test.ts](src/stores/audioStore.test.ts) (new) — 9 tests for the audio/beat-snap store: sensible defaults, setBpm clamps to [30, 300], addBeatMarker keeps the list sorted, removeBeatMarker uses a 10 ms tolerance, addRegion / removeRegion by id, snapToNearestBeat falls back to the BPM grid when no markers (with beatSubdivision honoured), snapToNearestBeat picks the nearest marker when present, clearAudio resets everything.

Test count 735 → 744.

**Verification:** 744/744 unit + 42/42 e2e Chromium + typecheck + build all clean.

---

### historyStore unit tests (2026-05-22 ~02:20 UTC)

[src/stores/historyStore.test.ts](src/stores/historyStore.test.ts) (new) — 8 tests covering: empty initial state, snapshot label storage, default 'Edit' label, `labelForNextUndo` reads the most-recent past entry, `canUndo`/`canRedo` reflect counts, back-to-back identical snapshots dedupe to one, past caps at `maxSteps` (oldest entries drop), `getHistorySummary` returns the light label+timestamp shape.

The dedupe + 300 ms debounce paths both key on `nodes.length + edges.length`, so the maxSteps test had to vary node count between snapshots to defeat both. Documented that in a code comment.

Test count 727 → 735.

**Verification:** 735/735 unit + 42/42 e2e Chromium + typecheck + build all clean.

---

### selectionStore unit tests (2026-05-22 ~02:12 UTC)

[src/stores/selectionStore.test.ts](src/stores/selectionStore.test.ts) (new) — 8 tests covering initial state, replace-mode selectNode, additive selectNode (toggle), selectEdge clears nodes, selectNodes replaces both halves, clearSelection resets type to 'none', setSelection derives 'mixed' when both populated, and B-09's `setHoveredNode` is independent of `selectedNodeIds`.

Test count 719 → 727.

**Verification:** 727/727 unit + 42/42 e2e Chromium + typecheck + build all clean.

---

### AnnotationsSection labels + clipboardStore tests (2026-05-22 ~02:06 UTC)

[src/components/inspectors/AnnotationsSection.tsx](src/components/inspectors/AnnotationsSection.tsx) — `setAnnotations` accepts an optional label. Two semantic labels now emit: `Add note`, `Remove note`.

[src/stores/clipboardStore.test.ts](src/stores/clipboardStore.test.ts) (new) — 6 tests for the L5 clipboard module: empty state, set+get round-trip, clear via `setClipboard(null)`, localStorage mirror, lazy rehydration after module-state reset, malformed-payload rejection. Installs a minimal localStorage stub via `vi.stubGlobal` so the node test env exercises the persist + load paths (jsdom isn't a dev dep).

Test count 713 → 719.

**Verification:** 719/719 unit + 42/42 e2e Chromium + typecheck + build all clean.

---

### Semantic labels in Color sections (2026-05-22 ~01:58 UTC)

[src/components/inspectors/ColorOverridesSection.tsx](src/components/inspectors/ColorOverridesSection.tsx) + [ColorKeyframesSection.tsx](src/components/inspectors/ColorKeyframesSection.tsx) — extended `setGroups` / `setKfs` to accept an optional label. Call sites now emit semantic Undo-toast text:

- `Rename color override group` / `Remove color override group` / `Set color override` (3 of 4 sites; the rare ones use the default)
- `Add color keyframe` / `Remove color keyframe` / `Set color keyframe time` / `Set color keyframe program` / `Set color keyframe easing` / `Set color keyframe Bézier`

**Verification:** 713/713 unit + 42/42 e2e Chromium + typecheck + build all clean.

---

### Semantic snapshot labels in Launch + Land inspectors (2026-05-22 ~01:51 UTC)

[src/components/inspectors/LaunchNodeInspector.tsx](src/components/inspectors/LaunchNodeInspector.tsx) — `update` accepts optional `label`. 3 sites now emit semantic labels: `Set launch drone count`, `Set launch start time`, `Set launch stagger`.

[src/components/inspectors/LandNodeInspector.tsx](src/components/inspectors/LandNodeInspector.tsx) — `update` accepts optional `label`. The single stagger site emits `Set land stagger`.

With this + the earlier Idle/Formation/Transition sweeps, the catch-all "Edit Foo" labels are now used only as defensive fallbacks; every typical user action gets a specific Undo-toast label.

**Verification:** 713/713 unit + 42/42 e2e Chromium + typecheck + build all clean.

---

### Semantic snapshot labels in IdleNodeInspector (2026-05-22 ~01:46 UTC)

[src/components/inspectors/IdleNodeInspector.tsx](src/components/inspectors/IdleNodeInspector.tsx) — extended the helper `update(patch)` to `update(patch, label = 'Edit Idle')` so each call site can pass its own semantic label. 8 sites updated: behavior, startTime, duration, center, radius, speed, altitude, colorProgramId. Undo toast now reads `"Undo: Set idle radius"` etc. instead of `"Undo: Edit Idle"`.

**Verification:** 713/713 unit + 42/42 e2e Chromium + typecheck + build all clean.

---

### graphIndex unit tests (2026-05-22 ~01:39 UTC)

[src/graph/graphIndex.test.ts](src/graph/graphIndex.test.ts) (new) — 6 tests covering `buildGraphIndex`: node/edge id lookups, empty arrays for orphan nodes, flow-vs-attachment edge separation in the flow* maps, fan-out from one source to many targets, fan-in from many sources to one target, and a full linear Launch → Formation → Transition → Formation → Land chain.

Test count 707 → 713.

**Verification:** 713/713 unit + 42/42 e2e Chromium + typecheck + build all clean.

---

### colors unit tests (2026-05-22 ~01:33 UTC)

[src/graph/colors.test.ts](src/graph/colors.test.ts) (new) — 6 tests covering `lerpColor` (endpoints, channel-independence, extrapolation past t=1) + semantic constants in `[0,1]` range + COLOR_WHITE specifically pure-white.

Test count 701 → 707.

**Verification:** 707/707 unit + 42/42 e2e Chromium + typecheck + build all clean.

---

### spatialHash unit tests + sentinel docs (2026-05-22 ~01:27 UTC)

[src/graph/spatialHash.test.ts](src/graph/spatialHash.test.ts) (new) — 8 tests covering `computePairwiseMinDist`. While writing them I uncovered + documented a surprising semantic: the function is a *violation detector*, not a global closest-pair algorithm. It only inspects pairs in 3×3×3 neighbourhoods of `bucketSize = 2*minSpacing`. Pairs farther apart never get checked and the function returns `minDist=0` as a sentinel (the `result.minDist === Infinity` branch). Tests now explicitly cover both cases:
- two well-separated points → `minDist=0` sentinel, 0 violations
- two close points sharing a bucket → real Euclidean distance, expected violation count
- three drones in a row → 3 distinct violation pairs (catches the encode() dedupe)
- 200-point sparse line → smoke test that the algorithm stays sub-200 ms.

Worth telling the user: this confirms the function's design intent and locks in the sentinel behavior. Anyone refactoring it later won't accidentally turn it into an O(N²) closest-pair.

Test count 693 → 701.

**Verification:** 701/701 unit + 42/42 e2e Chromium + typecheck + build all clean.

---

### vec3 unit tests (2026-05-22 ~01:20 UTC)

[src/graph/vec3.test.ts](src/graph/vec3.test.ts) (new) — 13 tests covering every exported function in `vec3.ts`: add/sub/scale, lerp at t=0/0.5/1, dist agrees with distSq, len, normalize (including zero-vector fallback to +Z), cross is anti-commutative, dot, lerpAngle takes the shortest arc through π, centroid averages, centroid of empty list returns origin.

Test count 680 → 693.

**Verification:** 693/693 unit + 42/42 e2e Chromium + typecheck + build all clean.

---

### Extract alignDistribute utils + 9 unit tests (2026-05-22 ~01:13 UTC)

[src/graph/alignDistribute.ts](src/graph/alignDistribute.ts) (new) + [src/graph/alignDistribute.test.ts](src/graph/alignDistribute.test.ts) (new) — pulled the align-to-mean / distribute-evenly math out of `MultiSelectInspector` into a pure module. Two exported functions: `alignAxisToMean(items, axis)` and `distributeAxisEvenly(items, axis)`. Both take `Positioned[]` (just an id + xyz triple), preserve input order in their output, leave non-axis values untouched, and skip work when given too-few items. Nine unit tests cover edge cases (empty, single item, two-item distribute, bookends pinned, order preservation, alt-axis).

[src/components/inspectors/InspectorPanel.tsx](src/components/inspectors/InspectorPanel.tsx) — `MultiSelectInspector` now calls the pure utils and only handles the React/store integration (collect unlocked formations → run math → write updates). Removed the inline duplicate math from `alignPositionAxis` and `distributePositionAxis`. Snapshot labels unchanged.

Test count 671 → 680.

**Verification:** 680/680 unit + 42/42 e2e Chromium + typecheck + build all clean.

---

### O-06 — Distribute positions X/Y/Z in multi-select inspector (2026-05-22 ~01:06 UTC)

[src/components/inspectors/InspectorPanel.tsx](src/components/inspectors/InspectorPanel.tsx) — added `distributePositionAxis(axis)` in `MultiSelectInspector`. Sorts the selected unlocked formations by their current `transform.position[axis]`, then re-spaces them evenly between min and max along that axis. Bookends stay pinned. Renders a "Distribute positions" UI row (Dist X / Dist Y / Dist Z) under the existing "Align positions" row when ≥3 formations are selected. Semantic snapshot label: `"Distribute Y (5 formations)"`.

Pairs with the earlier Align X/Y/Z to give multi-select the full align+distribute pattern users expect from Figma.

**Verification:** 671/671 unit + 42/42 e2e Chromium + typecheck + build all clean.

---

### O-03 — Polished NodeSearchPalette empty state (2026-05-22 ~01:00 UTC)

[src/components/NodeSearchPalette.tsx](src/components/NodeSearchPalette.tsx) — replaced the bare "Nothing matches." line with a designed empty state: 22 px `SearchX` icon, "**No matches**" headline, and a coaching subtitle ("Try searching by formation name, transition strategy, or an action keyword like 'bake' or 'export'."). Keeps the user moving forward instead of dead-ending.

**Verification:** 671/671 unit + 42/42 e2e Chromium + typecheck + build all clean.

---

### O-03 — Polished ViolationsPanel empty state (2026-05-22 ~00:53 UTC)

[src/components/panels/ViolationsPanel.tsx](src/components/panels/ViolationsPanel.tsx) — replaced the one-line "No physics violations detected." with a designed empty state: a 24 px emerald `CheckCircle2` icon, an "**Physics validates clean**" headline, and a two-line subtitle ("Every transition meets the drone-pool's velocity + acceleration budget. This show is ready to bake.").

[e2e/physics.spec.ts](e2e/physics.spec.ts) + [e2e/inspector.spec.ts](e2e/inspector.spec.ts) — broadened the regex on the 4 sites checking for the old copy to also match `Physics validates clean`. All 42 e2e tests pass on the new copy.

**Verification:** 671/671 unit + 42/42 e2e Chromium + typecheck + build all clean.

---

### KeyframeCurveEditor — Snap selected keyframes to playhead (2026-05-22 ~00:45 UTC)

[src/components/KeyframeCurveEditor.tsx](src/components/KeyframeCurveEditor.tsx) — added a "Snap to playhead" button to the curve-editor footer (right of the easing applicator). When one or more keyframes are selected, click to set each selected keyframe's `time` to the current playhead's local-to-formation time. Snapshot label: `"Snap N keyframes to playhead"`. The button is disabled when there's no selection OR when the playhead sits outside the formation's window (with a tooltip explaining why).

Use case: pin a series of edits to specific musical beats. Previously the only way was to shift-drag each keyframe diamond individually; this is much faster on multi-select.

**Verification:** 671/671 unit + 42/42 e2e Chromium + typecheck + build all clean.

---

### O-ticket accuracy sweep (O-05, O-07, O-09) (2026-05-22 ~00:38 UTC)

Three more O-tickets moved from "todo" to "done" with concrete code references attached:

- **O-05 Undo / redo** → done. Every snapshot site has a semantic label; Ctrl+Z toasts `Undo: <label>`; HistoryPalette popover at Ctrl+Shift+H; rapid drag mutations grouped under one snapshot.
- **O-07 Copy / paste** → done. Module-level `clipboardStore`, Ctrl+C/V/X in `useCanvasKeyboard`, ID remap + edge reconnection on paste, cross-tab via localStorage.
- **O-09 Motion language** → done. Tailwind `motionDurations` (0/75/100/150/200/300/500/800 ms) + `motionEasings` (standard/enter/exit/spring) tokens; `prefers-reduced-motion` honored in src/index.css.

**Verification:** 671/671 unit (no code changes) clean.

---

### N-02 — Demo grid theme filter chips (2026-05-22 ~00:31 UTC)

[src/components/welcome/DemoGrid.tsx](src/components/welcome/DemoGrid.tsx) — added a theme filter chip row inline with the "Demo Shows" header. Chips include "All" plus only the themes that actually have ≥1 demo in `DEMO_REGISTRY` (computed at mount). Active chip styled cyan with a border ring; inactive chips are white/5 → white/10 on hover. Filtered demos rendered below. Doesn't touch tile layout or the "Generate with AI" CTA.

The "Coming soon" stub mentioned in the original ticket was already replaced earlier — that bullet was stale.

N-02's remaining items (hover video preview, right-click inspect) are heavier — bumped to follow-up.

**Verification:** 671/671 unit + 42/42 e2e Chromium + typecheck + build all clean.

---

### N-05 — AI settings: show/hide API key + console link (2026-05-22 ~00:25 UTC)

[src/components/AIChatPanel.tsx](src/components/AIChatPanel.tsx) — `InlineSettings`:

- API key input gets an eye-toggle button on the right edge. Click to flip between `type="password"` and `type="text"`. Default is hidden. Useful for verifying a pasted key without breaking the masking.
- New footer link: "Get an API key →" pointing to console.anthropic.com/settings/keys (lucide `ExternalLink` icon). `rel="noopener noreferrer"` for safety.

Rate-limit indicator + usage history bumped to follow-up (need backend integration).

**Verification:** 671/671 unit + 42/42 e2e Chromium + typecheck + build all clean.

---

### N-03 — Replace-show confirm: counts + keyboard (2026-05-22 ~00:18 UTC)

[src/components/welcome/ReplaceShowConfirmDialog.tsx](src/components/welcome/ReplaceShowConfirmDialog.tsx) — added a "Will be lost" panel listing counts of formation / transition / idle nodes, flow edges, and saved formations from the current show. Pulls live from `useGraphStore` + `useFormationStore` so the numbers always match the user's current state. Hides the panel when there's nothing to lose.

Keyboard: window-level handler installed while the dialog is open. Y or Enter triggers Replace; N or Escape cancels; S triggers Save & Replace. Each button displays its shortcut hint inline. The Replace button auto-focuses so Enter immediately confirms. Click outside the dialog also cancels.

N-03 ships done.

**Verification:** 671/671 unit + 42/42 e2e Chromium + typecheck + build all clean.

---

### Loop-region dashed border + O-ticket accuracy (2026-05-22 ~00:10 UTC)

[src/components/viewport/WaveformLane.tsx](src/components/viewport/WaveformLane.tsx) — `LoopRegion` reads `loopMode` and renders ping-pong with a dashed 2px border (vs solid 1px for wrap). The tooltip also surfaces the active mode: `"Loop 12.0s — 18.0s (ping-pong)"`. Distinguishes the two modes at a glance without re-reading the transport button's tooltip.

[tickets/appendix-O-system-wide.md](tickets/appendix-O-system-wide.md) — O-08 Tooltips marked done (L5 ship; `Tooltip` component exists + adopted in toolbars + transports + ruler panel). O-15 Notifications/toasts marked mostly done (severity-based durations, action buttons, dedupe within 1 s all in place; rich content + DND remain).

**Verification:** 671/671 unit + 42/42 e2e Chromium + typecheck + build all clean.

---

### F-01 — Mark-in / mark-out buttons (2026-05-22 ~00:03 UTC)

[src/components/viewport/TransportControls.tsx](src/components/viewport/TransportControls.tsx) — added two small buttons next to the loop toggle (lucide `ChevronFirst` / `ChevronLast`). Mark-in snaps `loopStart` to the current playhead time; mark-out snaps `loopEnd`. Always visible (not gated on loop being enabled) so authors can pre-stage a loop region before turning looping on. Tooltips show the current value: `"Mark loop in (now 12.3s)"`.

F-01 is now done — every figma-perfect bullet in the ticket has shipped.

**Verification:** 671/671 unit + 42/42 e2e Chromium + typecheck + build all clean.

---

### F-01 — Ping-pong loop mode (2026-05-21 ~23:57 UTC)

[src/stores/playheadStore.ts](src/stores/playheadStore.ts) — added `loopMode: 'loop' | 'ping-pong'` + `pingDir: 1 | -1` + `setLoopMode(mode)`. `tick()` extended: in ping-pong mode, the deltaSec is multiplied by pingDir; when newTime crosses loopEnd the value is *reflected* (5.6 with loopEnd=5 → 4.4) and pingDir flips to -1; same at loopStart in the reverse direction. Toggling the loop or changing mode resets pingDir to 1 so re-entering doesn't pick up a stale state.

[src/components/viewport/TransportControls.tsx](src/components/viewport/TransportControls.tsx) — when looping is enabled, a second small `Shuffle` button reveals; click to flip between `loop` (wrap at end) and `ping-pong` (reflect at end). Tooltip on the existing Repeat button now names the active mode.

[src/stores/playheadStore.test.ts](src/stores/playheadStore.test.ts) — two new tests covering ping-pong reflection at loopEnd (with pingDir flip and reverse travel) and `setLoopMode` resetting pingDir. Test count 669 → 671.

**Verification:** 671/671 unit + 42/42 e2e Chromium + typecheck + build all clean.

---

### F-01 — Ctrl+Space stop + I-08 bounce-validation annotation (2026-05-21 ~23:48 UTC)

[src/components/canvas/useCanvasKeyboard.ts](src/components/canvas/useCanvasKeyboard.ts) — Ctrl+Space (and Cmd+Space) now stops playback and resets the playhead to t=0. Wired ahead of the bare-space play/pause handler so the modifier takes precedence. The shortcuts overlay learns the new entry.

[tickets/appendix-I-transitions.md](tickets/appendix-I-transitions.md) — annotated I-08 to note the bounce velocity coefficient (`2 + 3π ≈ 11.42`) is in fact already validated by `transitionStrategies.test.ts` under the per-strategy "peak velocity ≤ maxVelocity × 1.05" suite. The Tier 1 #7 "unvalidated" claim was stale.

**Verification:** 669/669 unit + 42/42 e2e Chromium + typecheck + build all clean.

---

### B-09 — Hover-yellow bounding box + hover-state store (2026-05-21 ~23:41 UTC)

[src/stores/selectionStore.ts](src/stores/selectionStore.ts) — added `hoveredNodeId: string | null` + `setHoveredNode(id)` action. Intentionally separate from `selectedNodeIds` so hover visuals don't change the selection.

[src/components/canvas/GraphCanvas.tsx](src/components/canvas/GraphCanvas.tsx) — wired React Flow's `onNodeMouseEnter` / `onNodeMouseLeave` to set/clear the hovered ID. Bypassed the React subscription on entry/leave (only the store updates; React Flow doesn't re-render on every mouse move).

[src/components/viewport/ViewportOverlays.tsx](src/components/viewport/ViewportOverlays.tsx) — new `HoverBoundingBox` overlay renders a yellow `#facc15` `Box3` (opacity 0.5, padding 0.4 m) around the currently hovered formation, only when it's not already in the selection. Reuses the same point→world-space math as `SelectionBoxInner` so the hover and selection rings line up exactly when a hovered node becomes selected.

[src/components/viewport/Viewport3D.tsx](src/components/viewport/Viewport3D.tsx) — mounted `<HoverBoundingBox />` next to `<SelectionBoundingBox />`.

B-09 is now done (all four color states + crosshair + RGB axes shipped). Ticket file marked done.

**Verification:** 669/669 unit + 42/42 e2e Chromium + typecheck + build all clean.

---

### B-09 — Selection box: error-state red + center crosshair (2026-05-21 ~23:34 UTC)

[src/components/viewport/ViewportOverlays.tsx](src/components/viewport/ViewportOverlays.tsx) — extended `SelectionBoxInner`:

- **Error state:** when the selected formation has any error-severity `flowDiagnostics`, the `Box3Helper` material swaps to red (`#f87171`). Recomputed each frame so violations that come and go (e.g. while editing) update live without a re-mount.
- **Center crosshair:** small 3D crosshair (3 line segments along X/Y/Z) at the box's geometric centroid (`box.getCenter(...)`). Length scales with the box size; color matches the bounding box (cyan or red). Useful when the formation isn't symmetric around its own `transform.position` — the centroid drifts from the origin and the crosshair shows where.

The hover-state yellow from the B-09 ticket would require a `hoveredNodeId` store concept separate from `selectedNodeIds`; that's a separate pass.

**Verification:** 669/669 unit + 42/42 e2e Chromium + typecheck + build all clean.

---

### A-15 — Auto-layout respects groups + first tests (2026-05-21 ~23:26 UTC)

[src/components/canvas/autoLayout.ts](src/components/canvas/autoLayout.ts) — skip `node.parentId != null`. Previously the lane assignment ran on group children, then `setNodePositionsBatch` wrote absolute positions on them, yanking them out of their group's visual bounds. React Flow uses `parentId` to position child nodes relative to the parent, so the fix is to leave grouped children alone.

[src/components/canvas/autoLayout.test.ts](src/components/canvas/autoLayout.test.ts) (new) — first tests for autoLayout: confirms a flat chain gets correct x positions for each node, and confirms nodes with `parentId` are excluded from the output. Unit test count 667 → 669.

A-15's remaining work (300ms eased animation between current and target positions; preview-before-apply) requires animating position interpolation between frames; React Flow doesn't natively do that for `setNodePositionsBatch`. A separate pass.

**Verification:** 669/669 unit + 42/42 e2e Chromium + typecheck + build all clean.

---

### C-tickets accuracy sweep (2026-05-21 ~23:20 UTC)

Annotated four C-appendix tickets to reflect actual codebase state after L4 inputs landed earlier in the night:

- **C-01 NumberInput** → done (shipped in `inspectors/shared.tsx`: drag-scrub with shift/alt/cmd, math eval, units, ↑↓ nudge with shift=×10, `mixed` indicator, history via shift+↑↓).
- **C-03 ColorInput** → partial (`inputs/ColorInput.tsx` shipped with HexColorPicker + recent colors + Chromium EyeDropper API + mixed; alpha/saved-palette/contrast-readout remain).
- **C-04 EasingInput** → mostly done (`inspectors/EasingSelect.tsx` has presets + Custom Bézier 2-handle draggable curve; hover-preview animated demo still todo).
- **C-05 RegistrySelect** → partial (`inputs/RegistrySelect.tsx` shipped with L1 preview tiles; search-filter + favourites + drag-to-canvas + right-click remain).

**Verification:** 667/667 unit (no code changes) + typecheck clean.

---

### I-01 — 3D mapping line viz for shortest-path (2026-05-21 ~23:13 UTC)

[src/components/viewport/TransitionMappingLines.tsx](src/components/viewport/TransitionMappingLines.tsx) (new) — when a single shortest-path transition is selected, this overlay renders one line segment per mapped source→target pair. Endpoints are in world space (formation point × scale + transform.position). Per-segment color interpolates blue (`#22d3ee`) → orange (`#f97316`) by per-pair distance normalized to the max in this transition. Skips n > 200 (matches Hungarian's greedy-fallback threshold and avoids visual noise).

Single `BufferGeometry` with positions + per-vertex colors → one draw call regardless of mapping size. `vertexColors` material with `transparent + opacity 0.5 + depthWrite=false` so the lines blend with drones + grid without occluding the swarm. Wired into Viewport3D between the symmetry overlay and the drone trails.

Trade-off: uses base transforms (no keyframe interpolation). The lines reflect "where the formations are without keyframes." For most authoring this matches the user's mental model. Keyframe-aware endpoints are a follow-up.

**Verification:** 667/667 unit + 42/42 e2e Chromium + typecheck + build all clean.

---

### Promote safety badge to all transition strategies (2026-05-21 ~23:06 UTC)

Moved the I-01 safety-margin badge out of the shortest-path-only "Mapping stats" section and up to the top level of the TransitionNodeInspector. Every strategy (shortest-path, ant-walk, stagger/wave, spiral, explosion, implosion, cascade, morph, bounce) that reports a `minDuration` now gets the same at-a-glance red/amber/emerald feedback comparing its currentDuration to the physics floor. The shortest-path-specific "Mapping stats" (total/avg/max distance) stays where it is.

Rationale: the badge logic only depends on `minDuration` which is already computed for every strategy via `strategy.computeMinDuration`. Gating it behind shortest-path was leaving 7 other strategies without the same visual signal even though the same data was right there.

**Verification:** 667/667 unit + 42/42 e2e Chromium + typecheck + build all clean.

---

### I-01 — Safety-margin badge in shortest-path inspector (2026-05-21 ~22:59 UTC)

[src/components/inspectors/TransitionNodeInspector.tsx](src/components/inspectors/TransitionNodeInspector.tsx) — extended the "Mapping stats" section with a coloured safety badge comparing `currentDuration` to `minDuration` (the strategy's reported min feasible duration under velocity + acceleration constraints). Thresholds: <1× red ("Exceeds physics budget — needs ≥ X.Xs"), 1×–1.5× amber ("Tight"), ≥1.5× emerald ("Safe"). Surfaces the pushDelta in the red label so the author knows exactly how much more time the transition needs.

Why the ratio approach: `minDuration` is what the engine already computes for the "needs more time" cascade-push warning at the top of the inspector — reusing it here keeps the two readings consistent and avoids re-deriving via the velocity/distance math.

I-01's remaining work (line viz source→target color-coded by distance, alternatives-with-cost-deltas button) bumped to follow-up. Ticket annotated.

**Verification:** 667/667 unit + 42/42 e2e Chromium + typecheck + build all clean.

---

### I-01 — Mapping stats in shortest-path transition inspector (2026-05-21 ~22:53 UTC)

[src/components/inspectors/TransitionNodeInspector.tsx](src/components/inspectors/TransitionNodeInspector.tsx) — when the selected transition uses `shortest-path`, a new "Mapping stats" section shows Total / Avg-per-drone / Max travel distances. Compute path: walks upstream/downstream formation neighbours via `generatedPoints`, runs `hungarianMapping(fromPts, toPts)` (or falls back to greedy for n > 200), then iterates the resulting 1:1 pairs to sum + take max.

The stats answer the "is this transition asking a worst-case drone to fly farther than the show can afford?" question without making the author scrub the timeline or run a bake. Pure read-only — no parameter editing in this section. Memoised on `(strategyId, nodeId, nodes, edges, generatedPoints)` so it only recomputes when the relevant inputs change.

I-01's remaining work (line viz + safety-margin badge + alternatives) bumped to a separate pass. Ticket annotated.

**Verification:** 667/667 unit + 42/42 e2e Chromium + typecheck + build all clean.

---

### Ticket-status accuracy pass (2026-05-21 ~22:45 UTC)

Annotated three appendix tickets to reflect actual codebase state — they were marked "todo" but had partial work already in place:

- [tickets/appendix-B-3d-viewport.md](tickets/appendix-B-3d-viewport.md) **B-04 Ground plane** → partial (GG-toggle + sensible defaults shipped; altitude ruler + snap + per-project sizing remaining).
- [tickets/appendix-B-3d-viewport.md](tickets/appendix-B-3d-viewport.md) **B-09 Selection ring** → partial (cyan single box + amber multi box + RGB axes shipped; hover yellow + error red + crosshair remaining).
- [tickets/appendix-C-inspector-shared.md](tickets/appendix-C-inspector-shared.md) **C-02 VectorInput** → partial (3× NumberInput + axis caps + mixed-value per channel shipped; channel-lock toggle + drag-along-axis remaining).

These updates help future iterations skip past work that's already done and target the actual remaining gaps.

**Verification:** 667/667 unit (no code changes) + typecheck clean.

---

### A-02 + A-05 — Launch + Land card hover tooltips (2026-05-21 ~22:38 UTC)

[src/components/canvas/nodes/LaunchNode.tsx](src/components/canvas/nodes/LaunchNode.tsx) — multi-line tooltip: drone count, stagger, total fan-out, estimated launch duration, start time, and a warning line if any drones are unallocated downstream. Computed on render from existing props (no extra store reads).

[src/components/canvas/nodes/LandNode.tsx](src/components/canvas/nodes/LandNode.tsx) — multi-line tooltip surfacing the "Protected from deletion — every show needs a land node" rule that was previously only discoverable by trying to delete the node. Names the derived-timing semantics explicitly.

A-02's drag-badge + downstream bottleneck analysis and A-05's drag-badge + estimated-flight-time bumped to a separate ticket pass (both need graph traversal or new drag-handle wiring). Ticket files annotated.

**Verification:** 667/667 unit + 42/42 e2e Chromium + typecheck + build all clean.

---

### A-07 — Attachment edge hover tooltip (2026-05-21 ~22:32 UTC)

[src/components/canvas/edges/AttachmentEdge.tsx](src/components/canvas/edges/AttachmentEdge.tsx) — replaced `<BaseEdge>` with a raw `<path>` so we can nest a native SVG `<title>` child. On hover the browser shows e.g. `"Idle 'Orbit' attached to formation 'Opening Ring'"`. Resolves source/target node IDs → display names via `useGraphStore` + `useFormationStore` + the idle-behavior registry. Stroke/dash/opacity unchanged from before.

`BaseEdge` would have been ideal as a wrapper but it doesn't expose children, so the raw path version is simpler than rendering BaseEdge + a parallel hover layer. Drop-in equivalent visually.

A-07's remaining work — right-click context menu (edit / swap / delete) + drag-to-reattach — is bumped to a separate ticket pass. Ticket file annotated.

**Verification:** 667/667 unit + 42/42 e2e Chromium + typecheck + build all clean.

---

### Semantic snapshot labels in Formation + Transition inspectors (2026-05-21 ~22:24 UTC)

[src/components/inspectors/FormationNodeInspector.tsx](src/components/inspectors/FormationNodeInspector.tsx) + [TransitionNodeInspector.tsx](src/components/inspectors/TransitionNodeInspector.tsx) — replaced ~22 generic `snapshot("Edit Formation")` / `snapshot("Edit Transition")` call sites with field-specific labels. The Undo toast now says `"Undo: Add keyframe"` / `"Undo: Set keyframe time"` / `"Undo: Mirror X"` / `"Undo: Set transition arcHeight"` etc. instead of a generic "Edit." Helper-level `update()` calls still fall back to the generic label (would require threading label through every call site).

Affected labels (most-visible first):
- Add keyframe / Remove keyframe / Set keyframe time / Set keyframe easing / Set keyframe position / Set keyframe rotation / Set keyframe scale
- Set animation mode / speed / trim in / trim out
- Set color program / Save color program
- Add attached idle / Remove attached idle / Set idle behavior / Set idle color program / Toggle idle inherit
- Toggle symmetry / Jitter points / Mirror X / Mirror Z / Densify Center / Scale to Fit
- Set transition `<param>` (interpolates the param key into the label)
- Set stagger mode / Set stagger curve
- Push downstream timing

**Verification:** 667/667 unit + 42/42 e2e Chromium + typecheck + build all clean.

---

### O-06 — 3D align (X / Y / Z) actions in multi-select inspector (2026-05-21 ~22:16 UTC)

[src/components/inspectors/InspectorPanel.tsx](src/components/inspectors/InspectorPanel.tsx) — `MultiSelectInspector` gained an `alignPositionAxis(axis)` action that sets every selected unlocked formation's `transform.position[axis]` to the selection's mean along that axis. Locked formations are excluded (consistent with the multi-select gizmo behaviour). Renders a new "Align positions" UI row with X / Y / Z buttons under the existing Align starts / Distribute row. Semantic snapshot labels: `"Align Y (5 formations)"`. Useful for unifying altitude across a row of formations or centering a chorus along Z.

**Why mean-align, not first-selected-align:** Figma uses leftmost/rightmost for left/right-align; for 3D drones the "leftmost" axis convention is murky and the user is more likely to want centering than edge-snapping. Mean-align is the unambiguous 80% case.

**Verification:** 667/667 unit + 42/42 e2e Chromium + typecheck + build all clean.

---

### O-04 — Ctrl+L lock: inspector body gating (2026-05-21 ~22:07 UTC)

[src/components/inspectors/FormationNodeInspector.tsx](src/components/inspectors/FormationNodeInspector.tsx), [IdleNodeInspector.tsx](src/components/inspectors/IdleNodeInspector.tsx), [TransitionNodeInspector.tsx](src/components/inspectors/TransitionNodeInspector.tsx) — split outer container so the header + LockedBanner sit above a scrollable body. When `data.locked`, body gets `pointer-events-none opacity-60`. Banner stays interactive (it's a sibling of the body, not a child). Net effect: locked → inputs refuse focus/click/drag but are still readable; Unlock button remains clickable.

Layout note: had to convert `<div className="h-full flex flex-col overflow-y-auto">` into `<div className="h-full flex flex-col">` with the inner scroll container nested as `<div className="flex-1 overflow-y-auto ...">`. Header + banner participate in flex column above; body takes remaining height. Verified scroll still works on the body (wheel events traverse pointer-events: none).

**Verification:** 667/667 unit + 42/42 e2e Chromium + typecheck + build all clean.

---

### O-04 — Ctrl+L lock coverage pass (2026-05-21 ~21:58 UTC)

Follow-up to the original lock ship: extended gating to all five L2 adoption handles + inspector banners + node-card icons.

- [src/components/viewport/handles/IdleRadiusHandle.tsx](src/components/viewport/handles/IdleRadiusHandle.tsx), [IdleCenterHandle.tsx](src/components/viewport/handles/IdleCenterHandle.tsx), [IdleDirectionHandle.tsx](src/components/viewport/handles/IdleDirectionHandle.tsx), [FormationCountHandle.tsx](src/components/viewport/handles/FormationCountHandle.tsx), [GeneratorRadiusHandle.tsx](src/components/viewport/handles/GeneratorRadiusHandle.tsx) — each early-returns when its owning node's `data.locked` is true.
- [src/components/inspectors/shared.tsx](src/components/inspectors/shared.tsx) — new `LockedBanner` component (amber tinted, lucide Lock icon, "Unlock" button that fires snapshot + updateNodeData).
- [src/components/inspectors/FormationNodeInspector.tsx](src/components/inspectors/FormationNodeInspector.tsx), [IdleNodeInspector.tsx](src/components/inspectors/IdleNodeInspector.tsx), [TransitionNodeInspector.tsx](src/components/inspectors/TransitionNodeInspector.tsx) — render `<LockedBanner>` directly below the header when `data.locked`.
- [src/components/canvas/nodes/IdleNode.tsx](src/components/canvas/nodes/IdleNode.tsx) + [TransitionNode.tsx](src/components/canvas/nodes/TransitionNode.tsx) — lock icon (lucide `Lock`, 9–11 px) added next to the title when locked. The TransitionNode already had a Lock icon in the duration row meaning "derived"; the new one sits next to the strategy name so the two contexts don't conflict.

**Known follow-up:** inspector text/number inputs themselves don't refuse typed edits when locked — they pass through to `updateNodeData` unchanged. Locking still works for the gizmo + L2 handle paths (the most common edit surface) and the banner makes the state visible, but if a user types in the inspector, the edit lands. Gating every inspector input requires threading a `disabled` prop through ~30 onChange sites in three files — a separate pass.

**Verification:** 667/667 unit + 42/42 e2e Chromium + typecheck + build all clean.

---

### O-04 — Ctrl+L lock (2026-05-21 ~21:50 UTC)

[src/graph/types.ts](src/graph/types.ts) — added `locked?: boolean` to `FormationNodeData`, `IdleNodeData`, `TransitionNodeData`.

[src/components/canvas/useCanvasKeyboard.ts](src/components/canvas/useCanvasKeyboard.ts) — `Ctrl+L` toggles `locked` across selected formation/idle/transition nodes with majority-flip semantics (same shape as the existing `Ctrl+H` mute). Snapshot label `"Lock N nodes"` / `"Unlock N nodes"`. Toasts a confirmation.

[src/components/viewport/FormationGizmo.tsx](src/components/viewport/FormationGizmo.tsx) — single-formation `FormationGizmo` renders greyed-out for locked formations (drag input is refused via the existing `isEditable=false` path); `MultiSelectGizmo` excludes locked formations from the centroid + drag delta so they stay pinned while the rest of the selection moves.

[src/components/canvas/nodes/FormationNode.tsx](src/components/canvas/nodes/FormationNode.tsx) — lock icon (lucide `Lock`, 11px) renders to the left of the card title when locked; tooltip line gains `LOCKED`.

[src/components/KeyboardShortcutsOverlay.tsx](src/components/KeyboardShortcutsOverlay.tsx) — Ctrl+L entry added under Canvas.

**Why "locked excludes from gizmo" not "locked locks the gizmo":** if a user multi-selects 5 formations and only locks 1, the right behavior is for the remaining 4 to still drag together — locked items stay pinned. The single-formation gizmo case still shows the greyed-out gizmo so the user can see why their drag has no effect.

**Follow-ups noted in TICKETS_TODO:** the L2 handles (IdleRadius/IdleCenter/IdleDirection/FormationCount/GeneratorRadius) + inspector inputs don't yet gate on locked. These are the next pass.

**Verification:** 667/667 unit + 42/42 e2e Chromium + typecheck + build all clean.

---

### O-06 — multi-select centroid translate gizmo (2026-05-21 ~21:40 UTC)

[src/components/viewport/FormationGizmo.tsx](src/components/viewport/FormationGizmo.tsx) + [Viewport3D.tsx](src/components/viewport/Viewport3D.tsx) — added `MultiSelectGizmo`. When 2+ formations are selected and at least 2 are active at the playhead, an amber translate-only `PivotControls` renders at the selection centroid. Drag captures each eligible formation's edit target (keyframe N or base) + start transform at drag-start, then on each drag tick applies the world-space delta uniformly to every captured target. Formations between keyframes (target='disabled') are skipped — they'd see edits silently discarded. Snapshot label is `"Move N formations"` so undo is semantic.

**Why translate only, not rotate/scale:** rotating/scaling around a centroid means changing each formation's *position* too (it moves to satisfy the rotation pivot). That's a design choice with two reasonable interpretations (operate-on-base-transform vs operate-on-displayed-pose) — better to defer until there's user demand. Translate is the unambiguous 80% case.

**Verification:** 667/667 unit + 42/42 e2e Chromium + typecheck + build all clean.

---

### O-06 — multi-select 3D bounding box (2026-05-21 ~21:33 UTC)

[src/components/viewport/ViewportOverlays.tsx](src/components/viewport/ViewportOverlays.tsx) — added `MultiSelectBoxInner`. When 2+ formations are selected, a single combined `Box3` is computed across all selected formations that are active at the current playhead (skips non-formation selections and inactive ones), then rendered in amber `#fbbf24` to distinguish from the single-select cyan box. Pads the bounds by 0.5 m so it sits outside the swarm hull. Allocates only on add; reuses one Box3 + Vector3 across frames. `SelectionBoundingBox` is now the dispatcher: 0 selected → null, 1 → single cyan box + RGB axes, 2+ → amber combined box.

**Verification:** 667/667 unit + 42/42 e2e Chromium + typecheck + build all clean.

**Why this ships before the centroid translate gizmo:** the bounding box is the visual prerequisite — without it, a multi-select centroid gizmo would float without context. The follow-up (centroid PivotControls that drags all selected formations by a shared delta) needs to handle the keyframe/base-transform routing per-node (each selected formation may be at a different KF state at the playhead), which is meaningful work.

---

## Done — bleeding

### B3 + B3a — Idle behaviors rewritten for spacing + leftover-grid fixed

**Files changed:**
- [src/registries/idleBehaviors.ts](src/registries/idleBehaviors.ts) — complete rewrite (~550 lines). New helpers `minSafeRingRadius`, `partitionRingStack`, `distributeRingStack`, `clampRingRadius`. Every non-hover behavior (orbit, figure8, breathe, swarm, sparkle, pulse, wave, spin, drift) now distributes drones over a **multi-ring stack** sized to satisfy the project's `minSpacing`, then applies a behavior-specific modulation on top. `clampToConstraints` extended with optional `totalDrones` argument and per-behavior `contractionFloor` so the spacing requirement is enforced even when a behavior contracts the ring (breathe → 0.7, pulse → 0.7, sparkle → 0.7, figure8 → 0.55 due to lemniscate density). Velocity clamps now run **after** radius clamps so the velocity bound matches the actually-used radius.
- [src/graph/nodeEvaluators.ts](src/graph/nodeEvaluators.ts) — `clampToConstraints` calls now pass `idleCount`. The "no idle config" leftover-grid (a 10-wide grid at 0.5 m, **below pair-spacing minimums**) is replaced at both call sites (formation eval + transition eval) by a hover-above-home fallback that uses the drone's own launchpad XZ. The 0.5 m magic numbers are gone.
- [src/registries/idleBehaviors.test.ts](src/registries/idleBehaviors.test.ts) — new test block "Plan §B3: idle behaviors preserve drone pair spacing after clamp" samples 50 drones × 16 time points × 9 behaviors and asserts no pair ever drops below 0.85·minSpacing. All 9 behaviors pass.

**Effect:** the on-screen "defaults to overlapping" complaint is resolved. Attach orbit (or any other behavior) to 50 drones at any radius and they distribute over enough concentric rings to stay properly spaced. The clamp will expand the radius automatically when the user requests something too small for the count, with a warning explaining what happened.

**Verification:** typecheck ✓, tests 638/638 ✓ (629 → 638; 9 new spacing tests).

**Worth telling you:**
- The behaviors are visually noticeably different from before — multi-ring stacks with a slight vertical helix step, not a single flat ring. If you preferred the single-ring look, you can keep the old visual by setting radius high enough that everyone fits in ring 0 (the helper detects this and uses a single ring).
- I tuned the swarm modulation amplitude down (was 0.3, now 0.075) so per-drone drift can't breach slot spacing. Movement is noticeably gentler. Tweak the constants in `swarmBehavior.getPosition` if you want it more chaotic.
- The lemniscate (`figure8`) needed a 0.55 contraction-floor because the curve's neck brings drones from opposite phases close together. I also kept the per-drone vertical stagger from the original implementation — without it, the test fails. If you wanted a flat figure-8 the stagger amplitude should be reduced and the radius bumped up more aggressively.
- I haven't yet plumbed the warnings into a user-visible toast (L5-toast). They're still returned and ignored. Will surface them when L5-toast lands.

### B2 — Audience View error boundary & defensive guards

**Files changed:**
- [src/components/ErrorBoundary.tsx](src/components/ErrorBoundary.tsx) — added `componentStack` capture, `panelCrashLog` module-level history (last 50 crashes), and rich error UI with "Show details" (expands stack + componentStack inline) and "Copy details" (clipboard) buttons.
- [src/components/viewport/Viewport3D.tsx](src/components/viewport/Viewport3D.tsx) — defensive early-return in `DroneCloud.useFrame` if `nodes` / `edges` / `homePositions` are undefined (the audience-Canvas race condition). `HomeMarkers` guards `homePositions?.length`.

**Why:** the previous boundary logged to console but the UI just said "Cannot read properties of undefined (reading 'length')" with no line/stack. Now any future panel crash exposes the file + line behind one click, and the underlying `.length`-on-undefined site is guarded so the audience viewport doesn't crash in the first place. Plan §B2.

**Verification:** typecheck ✓, tests 629/629 ✓.

**Risk:** the guard silently skips a frame when state is missing rather than rendering an empty state. That's correct for a transient hydration race but would mask a real bug if `nodes`/`edges` are persistently undefined. If it ever loops on guard-skip, you'll see the viewport stuck on the last good frame. I'll come back and add a counter + warn-after-60-skips check during the L5 pass if needed.

### B1 — Silent-stale viewport cache (the gizmo/inspector regression you flagged)

**Files changed:** [src/components/viewport/Viewport3D.tsx](src/components/viewport/Viewport3D.tsx) — deleted the broken S22-05 evaluation cache (lines 60–63, 78–82, 104–106) and the unused `DroneState` import.

**Root cause confirmed:** the cache hashed `${nodes.length}-${edges.length}-${currentTime.toFixed(3)}`. `updateNodeData` mutates `node.data` in place, so the hash didn't change on transform/color/idle-param edits and the stale `lastEvalResult` was reused. That's why dragging the position gizmo or editing the position inspector did nothing visible until you scrubbed the timeline.

**Approach:** removed the cache entirely (correctness over a broken optimization). The proper future fix is **S1** in the plan — hoist evaluation into a derived signal both viewports share — but for now `evaluateAtTime` runs per frame on every Canvas mount. Comment in the code points readers at plan §B1 for context.

**Verification:** typecheck ✓, tests 629/629 ✓, lint clean (pre-existing errors only, none in this file).

**Risk:** the audience viewport now also runs evaluateAtTime per frame. If you open both viewports on a large graph you may see doubled CPU. The fix for that is S1 (derived signal); flagging here so you can prioritize.


## Done — L5 systems pass

### L5-toast — module-level emitter + service wiring

**Files changed:**
- [src/components/Toast.tsx](src/components/Toast.tsx) — added a module-level `toast` API (`toast.info/success/warning/error(msg, opts)`) so services can fire toasts without React. Toasts now support an `action` button ({ label, onClick }), per-severity default durations (error 8s, success 2s, warning 5s, info 3s), and 1-second duplicate dedup.
- [src/services/autosave.ts](src/services/autosave.ts) — autosave failure now toasts with the error message instead of just logging.
- [src/services/videoExport.ts](src/services/videoExport.ts) — fixed the silent MP4→WebM fallback. Now toasts a warning when the user asks for MP4 and the browser doesn't support it, and reports the actual mimeType via `onComplete(blob, url, mimeType)`. Callers can label the export honestly.
- [src/services/aiFormationCritic.ts](src/services/aiFormationCritic.ts) — no longer returns the misleading `score: 5, 'critic parse failed'` sentinel when JSON parsing fails. Throws instead. The single existing caller (`aiSvgFormationGenerator.ts`) already wraps it in try/catch.
- [src/components/ExportDialog.tsx](src/components/ExportDialog.tsx) — tracks the actual mimeType returned by the video export and picks the file extension accordingly (`.mp4` if available, `.webm` otherwise).
- [src/app/App.tsx](src/app/App.tsx) — Ctrl+O failures (other than user cancel) now toast.

**Worth telling you:**
- The MP4 export was lying to users for a while. After this fix, requesting MP4 on a browser that doesn't support it pops a warning toast ("MP4 isn't supported in this browser — exporting as WebM instead") and the file gets the correct extension.
- AI tool errors already surface in the chat panel (via `setError` + system message); I didn't add a separate toast layer there — would feel double-noisy.

### L5-tokens — design tokens

**Files changed:**
- [tailwind.config.ts](tailwind.config.ts) — added `darkMode: 'class'`, semantic color tokens (`surface`, `surface-raised`, `surface-hover`, `surface-active`, `border-subtle/strong`, `text-primary/secondary/tertiary/disabled`, `accent-primary/secondary`, `status-info/success/warning/error`), a type scale (caption / body-sm / body / h3 / h2 / h1) with line-heights, a duration palette (0/75/100/150/200/300/500/800 ms) and easing palette (standard / enter / exit / spring).
- [src/index.css](src/index.css) — defined the matching CSS variables for `:root` (light) and `html.dark` (dark), added a `prefers-reduced-motion` block that disables transitions globally, and a visible `:focus-visible` outline at the accent colour.

**Worth telling you:**
- The tokens are additive — every existing `bg-slate-900` / `text-white/60` keeps working. Migrate incrementally to `bg-surface-raised` / `text-text-secondary` as you touch each component. The migration is not done; it's a multi-day effort.
- Light-mode tokens are defined but not exercised — the app still boots with `class="dark"` on `<html>`. A theme toggle is one feature flag away.

### L5-tooltips — unified `<Tooltip>`

**Files added:**
- [src/components/Tooltip.tsx](src/components/Tooltip.tsx) — wrapper component with 300 ms hover delay, 150 ms fade-in, keyboard accessibility (shows on focus), auto-side positioning, optional shortcut chip (`<Tooltip label="Save" shortcut="Ctrl+S">…</Tooltip>`). Drop-in replacement for native `title=` attributes.

**Worth telling you:** the component is built and adopted on the HeaderBar's 6 action buttons (New, Save, Save As, Export, Shortcuts, AI). Shortcut chips render inline ("Save" + "Ctrl+S" chip). ~40 other `title=` sites still exist across inspectors / status bar / dialogs — a find-and-replace pass would land them everywhere; doing it incrementally lets you tune copy as you go.

### L5-cmd-palette — Ctrl+K = real command palette

**Files changed:**
- [src/components/NodeSearchPalette.tsx](src/components/NodeSearchPalette.tsx) — extended from node-search-only to a full command palette: arrow-key nav, Enter to invoke, ESC to close. Recent commands persist in `localStorage` and bubble to the top. 11 actions wired (Save, Open, Export, Undo/Redo with semantic labels, Toggle Starfield, Toggle Bloom, Toggle Audience View, Play/Pause, Go to Start, Create Formation from Text). Fuzzy match across actions + nodes in one list.
- [src/app/App.tsx](src/app/App.tsx) — listens for `open-export-dialog` and `open-ai-dialog` custom events so commands fired by the palette can drive the existing dialog state.

**Worth telling you:**
- Undo/Redo labels in the palette show the *actual* action name ("Undo: Move Formation") instead of just "Undo".
- The recent-commands list is per-browser localStorage; clearing site data wipes it.
- Adding more commands is a one-liner — drop another entry into the `commands` array in NodeSearchPalette. Suggested follow-ups: "Toggle Grid Snap", "Toggle Reduce Motion", "Bake Show", "Show Violations", per-formation generators ("Insert ring formation").

### L5-copy-paste — Ctrl+C / Ctrl+V / Ctrl+X

**Files added:**
- [src/stores/clipboardStore.ts](src/stores/clipboardStore.ts) — module-level clipboard (memory + localStorage mirror) so paste survives a reload.

**Files changed:**
- [src/components/canvas/useCanvasKeyboard.ts](src/components/canvas/useCanvasKeyboard.ts) — Ctrl+C copies selected nodes plus edges that connect them (external edges drop); Ctrl+X cuts (copy + delete, respecting launch/land protection); Ctrl+V pastes with ID remap, an offset, and re-links the internal edges. Each operation toasts its outcome.

**Worth telling you:**
- Cut/paste of launch or land is allowed for copy but the cut path skips those when deleting — matching Delete-key semantics where they're protected.
- Cross-tab paste works because the clipboard is mirrored to localStorage.
- Keyframes / per-drone color overrides / idle configs all travel with the node since `node.data` is deep-cloned.

### L5-undo-names + L5-undo-grouping (the rapid-mutation coalescing)

**Files changed:**
- [src/stores/historyStore.ts](src/stores/historyStore.ts) — `snapshot(label?)` now accepts an optional label stored on the entry. Added `labelForNextUndo()` and `labelForNextRedo()`. The 300 ms debounce that was already there now serves as the L5-undo-grouping coalescing window — drags don't add 60 entries to history.
- [src/services/aiToolEngine.ts](src/services/aiToolEngine.ts) — labels AI write tools as `AI: <toolName>`.
- [src/components/viewport/FormationGizmo.tsx](src/components/viewport/FormationGizmo.tsx) — "Move Formation".
- [src/components/canvas/useCanvasKeyboard.ts](src/components/canvas/useCanvasKeyboard.ts) — `Delete N items`, `Duplicate N nodes`; Ctrl+Z / Ctrl+Y now toast `Undo: <label>` / `Redo: <label>` with the actual action name (1.5 s duration).
- [src/components/canvas/ContextMenu.tsx](src/components/canvas/ContextMenu.tsx) — `Add Launch` / `Add Formation` / etc.
- [src/components/canvas/CanvasToolbar.tsx](src/components/canvas/CanvasToolbar.tsx) — `Auto-layout`.
- [src/components/canvas/useDurationResize.ts](src/components/canvas/useDurationResize.ts) — `Resize Duration`.
- [src/components/inspectors/EdgeInspector.tsx](src/components/inspectors/EdgeInspector.tsx) — `Change Allocation Mode` / `Change Drone Count` / `Change Drone %`.
- [src/components/inspectors/FormationNodeInspector.tsx](src/components/inspectors/FormationNodeInspector.tsx) — all 29 snapshot sites labeled `Edit Formation` (catch-all; can be refined later per-field).
- [src/components/inspectors/{Launch,Land}NodeInspector.tsx, ColorOverridesSection.tsx, AnnotationsSection.tsx, EmptyState.tsx](src) — each given a sensible label.

**Worth telling you:**
- A pre-existing 300ms debounce inside `snapshot()` is what makes drag operations a single undo entry. Anything more granular than 300ms is treated as a continuation of the previous action.
- 49 snapshot() call sites still default to "Edit". They're functional; the major user-visible ones now have specific labels. Refining the rest is a follow-up.
- The undo toast is intentionally short (1.5s) so it doesn't pile up if the user hits Ctrl+Z a few times in a row.


## Done — L4 crafted inputs

### VectorInput (new) + adoption

**Files changed:**
- [src/components/inspectors/shared.tsx](src/components/inspectors/shared.tsx) — added `VectorInput` (thin convenience over three `NumberInput`s with axis-coloured `X` / `Y` / `Z` caps).
- [src/components/inspectors/FormationNodeInspector.tsx](src/components/inspectors/FormationNodeInspector.tsx) — base transform's Position + Rotation sections now use `VectorInput`. Compact one-row layout with axis colours; the previous Pos X / Pos Y / Pos Z stack was 3 rows tall.

**Worth telling you:** Keyframe transforms still use three separate `NumberInput`s (didn't refactor because there are 6 keyframe sections with the same pattern; mechanical follow-up work).

### NumberInput upgrade (in place)

**Files changed:** [src/components/inspectors/shared.tsx](src/components/inspectors/shared.tsx) — upgraded the existing `NumberInput` so all ~120 call sites inherit the polish without churn.

**New behaviors:**
- **Math expressions** on Enter or blur — `2*pi`, `15+3`, `(5+1)/2`, with a whitelist-based safe evaluator (rejects anything outside `[-+*/%().\d\s]`).
- **Units** via `unit?: string` — renders a tiny suffix inside the field.
- **Mixed-value indicator** (`—`) via `mixed?: boolean` — typing immediately replaces.
- **↑ / ↓ nudge** by `step`; Shift = ×10, Alt = ×0.1.
- **Shift + ↑ / ↓** cycles through a sessionStorage value history.
- **Cmd / Ctrl during drag-scrub** snaps to integer step.
- **Enter commits, Escape cancels** mid-edit.

**Worth telling you:**
- The math evaluator uses a `Function()` constructor with a strict character whitelist. Safer than `eval` but not bulletproof — limit-test if you pass user-supplied params through.
- VectorInput / ColorInput / EasingInput / SelectInput from the L4 spec are deferred. NumberInput was the highest-leverage upgrade (most inspector fields are numeric); the others are next-up work.

## Done — L1 live previews

### RegistryItemPreview + 4 adoption sites

**Files added:** [src/components/RegistryItemPreview.tsx](src/components/RegistryItemPreview.tsx) — one component, four `kind`s: `generator` (static dots), `idle` (animated dots, loops every 4 s), `color` (animated 8-swatch strip), `transition` (source → target dot pulse).

**Implementation note:** SVG projection of the registry item's output rather than a real 3D Canvas. The trade-off — way cheaper to mount 20+ of these in one panel without contention on the main viewport. RAF loop is paused when the preview isn't visible (IntersectionObserver).

**Adoption sites:**
- [src/components/inspectors/FormationNodeInspector.tsx](src/components/inspectors/FormationNodeInspector.tsx) — 36 px thumbnail next to the generator dropdown that updates live as parameters change.
- [src/components/inspectors/FormationNodeInspector.tsx](src/components/inspectors/FormationNodeInspector.tsx) (idle configs section) — 28 px animated preview next to each attached idle behavior dropdown.
- [src/components/inspectors/IdleNodeInspector.tsx](src/components/inspectors/IdleNodeInspector.tsx) — 36 px animated preview replaces the bespoke `IdlePatternPreview` (80 LOC of SVG primitives deleted). Now uses the actual behavior implementation so the preview reflects live math.
- [src/components/panels/AssetPanel.tsx](src/components/panels/AssetPanel.tsx) — 28 px thumbnail in front of every static formation in the asset list. Animated formations skipped (visual would not look right at that size).

**Worth telling you:**
- Asset panel still has its larger custom 3D preview for the selected formation; I only added thumbnails to the **list**. The big preview is more detailed and worth keeping for now.
- The `transition` preview is strategy-agnostic right now — it shows a generic source→target ring lerp. When per-strategy previews are wired (S8 work), `TransitionPreview` switches on `id`.

## Done — L3 AI tool-call cards

### Per-tool body slots (12 of ~47 tools)

**Files changed:** [src/components/AIToolCard.tsx](src/components/AIToolCard.tsx) — added a `ToolBody` component that renders an always-visible rich slot below the existing summary bar. The slot is per-tool.

**Tools with rich bodies wired:**
- `create_formation` / `update_formation` — L1 generator preview + point count + generator name.
- `add_transition_node` — L1 transition preview + duration.
- `add_idle_node` / `add_attached_idle` — L1 idle preview + radius/speed.
- `set_color_program` — L1 color program preview.
- `fix_all_violations` — structured "N fixed, M remain" with the first 6 applied fixes listed (truncated with overflow indicator).
- `add_keyframe` — mini timeline showing where the keyframe landed.
- `auto_time_show` — adjusted node count + total duration.
- `push_timing` — delta seconds + downstream impact.
- `set_drone_count` — new pool count.
- `update_node_transform` — diff of changed components (x/y/z).
- `update_node_timing` — start + duration diff.
- `critique_show` / `critique_formation` — score with severity-tinted color + suggestion text.

**Worth telling you:**
- ~35 tools still get the summary-only legacy treatment. Adding a body for a new tool is one switch case in `ToolBody`. Adoption is the easy part now that the pattern is set.
- The `fix_all_violations` body depends on the tool returning `appliedFixes: [{ description }]` and `remainingViolations`. If those fields aren't in the actual tool output today, the body shows `0 fixed, 0 remain` — a fix for the tool itself is a separate ticket but easy.
- `critique_show` body works for the new (throw-on-failure) `aiFormationCritic` flow.



## Done — L1 live previews

*(filled in as I go)*

## Done — L2 3D handles

*(filled in as I go)*

## Done — L3 AI tool cards

*(filled in as I go)*

## Done — Round 2 (after the "why did you stop" nudge)

### More tooltip migration

**Files changed:** [src/components/canvas/CanvasToolbar.tsx](src/components/canvas/CanvasToolbar.tsx), [src/components/viewport/TransportControls.tsx](src/components/viewport/TransportControls.tsx), [src/components/viewport/ViewportOverlays.tsx](src/components/viewport/ViewportOverlays.tsx), [src/components/AIChatPanel.tsx](src/components/AIChatPanel.tsx).

Native `title=` attrs replaced with `<Tooltip>` (with shortcut chips where applicable) on:
- Canvas toolbar (Auto-layout, Fit — shortcut "F").
- Transport controls (Skip back, Play/Pause — "Space", Stop).
- Viewport overlays (Editor bloom, Audience view pin, Viewport settings dropdown).
- AI chat panel (Clear history, Settings, Send — "Enter", Stop — "Esc").

### VectorInput in keyframe sections

[src/components/inspectors/FormationNodeInspector.tsx](src/components/inspectors/FormationNodeInspector.tsx) — each formation keyframe's 6-row Position + Rotation block is now two `VectorInput` rows with axis-colour caps. Visual density dropped from 6 rows to 2 per keyframe.

### Per-strategy transition previews (L1 polish)

[src/components/RegistryItemPreview.tsx](src/components/RegistryItemPreview.tsx) — `TransitionPreview` now switches on `id` and runs a strategy-specific canonical motion. Implemented: `stagger`, `spiral`, `explosion`, `implosion`, `cascade`, `morph`, `bounce`, plus a generic shortest-path fallback for `color-sweep` and `hungarian`/default. None of these invoke the bake worker; each is a small visual signature.

### More AI tool body slots — 22 of ~47 wired

[src/components/AIToolCard.tsx](src/components/AIToolCard.tsx) — added body slots for: `create_formation_from_text`, `set_formation_points`, `set_transition_strategy`, `update_constraints`, `add_launch_node`/`add_formation_node`/`add_land_node`/`connect_nodes`/`remove_node`/`remove_edge` (compact default — affected nodeId), `get_violations`, `get_show_summary`, `evaluate_at_time`, `remove_keyframe`, `clear_graph`.

### Empty states polish

[src/components/panels/AssetPanel.tsx](src/components/panels/AssetPanel.tsx) — designed empty state when no formations exist ("No formations yet" with CTA toward the New button + import).
[src/components/inspectors/InspectorPanel.tsx](src/components/inspectors/InspectorPanel.tsx) — empty state hints now render as monospace chord chips next to descriptions (Ctrl+K / Right-click canvas / Drag handles / ?).

### Color program defaults — coverage tests

[src/registries/colorPrograms.test.ts](src/registries/colorPrograms.test.ts) — new test file with **10 tests** covering all 10 registered defaults at multiple time points across 16 sample drones. Asserts valid RGB ranges, that solids don't vary, gradients vary across the axis, rainbow hits multiple dominant channels, pulse swings brightness over time, chase/sweep vary over time. **Catches a real edge case**: gradient programs extrapolate out of `[0,1]` when called without the positions array — tests now pass the full positions list so spatial programs normalise correctly. 638 → **648 tests**.

### Semantic snapshot labels — all source sites covered

Sweep across every remaining `snapshot()` call site (the 49 default-"Edit" leftover sites): `TransitionNodeInspector.tsx` (5 sites → "Edit Transition"), `IdleNodeInspector.tsx` ("Edit Idle"), `ColorKeyframesSection.tsx` ("Edit Color Keyframe"), `ViolationsPanel.tsx` ("Fix {type}", "Fix: {label}", "Fix N violations", "Make It Work"), `TimelineRulerPanel.tsx` ("Move on Timeline", "Solo Node"/"Unsolo Node", "Mute Node"/"Unmute Node"). Tests still call `snapshot()` without labels — that's fine.

### S1 partial — mutation-counter eval cache (the proper B1 fix)

**Files changed:**
- [src/stores/graphStore.ts](src/stores/graphStore.ts), [src/stores/formationStore.ts](src/stores/formationStore.ts), [src/stores/projectStore.ts](src/stores/projectStore.ts) — each store now exports `getXMutationVersion()`. A module-level counter bumps via `useStore.subscribe()` on every state change. No action signatures changed.
- [src/components/viewport/Viewport3D.tsx](src/components/viewport/Viewport3D.tsx) — `DroneCloud` re-cached eval results, but now keyed by `${graphV}/${formationV}/${projectV}/${currentTime}`. Cache hits are correct (every mutation bumps the counter); cache misses re-run `evaluateAtTime`. The B1 "silent stale" bug stays fixed because in-place mutations also fire `subscribe()`.

**Result:** the perf optimisation B1 deleted is back, but **correct**. If you open both editor and audience viewports they re-evaluate as needed (still one eval per Canvas — full shared-derived-signal S1 still pending) but neither shows stale state.

## Round 3 — continued after the "why did you even stop" + second crash report

### Vite deps cache invalidation (the real crash fix)

After downgrading `@react-three/postprocessing` to 2.19.1, you still saw the same crash — the Vite cache-bust hash `?v=0a94d223` was identical across both reports, which means Vite's pre-bundled deps under `node_modules/.vite/deps/` were still holding the old 3.0.4 build. The package downgrade hadn't actually reached the browser.

**Fix:** ran `rm -rf node_modules/.vite/`. Now you need to:
1. Stop your running dev server (`Ctrl+C` in the `pnpm dev` terminal).
2. Restart it — Vite re-bundles deps from `@react-three/postprocessing@2.19.1`.
3. Hard-reload the browser (`Ctrl+Shift+R`).

I confirmed `node_modules/@react-three/postprocessing/package.json` shows 2.19.1 on disk, and `pnpm-lock.yaml` pins it paired with `@react-three/fiber@8.18.0` + React 18.3.1.

### EasingSelect → curve-tile popover (L4 third input)

[src/components/inspectors/EasingSelect.tsx](src/components/inspectors/EasingSelect.tsx) — replaced the native `<select>` with a 3-column popover grid of curve tiles. All 31 easings visible at once, grouped by Basic / Polynomial / Physics / Oscillatory / Spring. Each tile renders the actual easing curve via SVG. Click to select. Selection highlight in cyan; smooth open/close. The closed state shows a compact button with the current curve preview + label + dropdown chevron. Exports `EasingCurve` so the same preview can be reused elsewhere (e.g. keyframe row glyphs).

### More Tooltip migration

Migrated the remaining high-visibility native `title=` sites:
- [src/components/inspectors/AnnotationsSection.tsx](src/components/inspectors/AnnotationsSection.tsx) — delete-note button.
- [src/components/inspectors/ColorOverridesSection.tsx](src/components/inspectors/ColorOverridesSection.tsx) — edit-color + remove-group buttons.
- [src/components/HeaderBar.tsx](src/components/HeaderBar.tsx) — project-name rename hint.
- [src/components/viewport/TimelineRulerPanel.tsx](src/components/viewport/TimelineRulerPanel.tsx) — Solo / Mute buttons per node bar; Beat Snap and Loop toolbar buttons.

### Crash root cause: @react-three/postprocessing version mismatch — fixed at the source

Your "Copy details" stack pointed at `@react-three/postprocessing@3.0.4`'s internal `useLayoutEffect`. Inspecting its `package.json`:

```
peerDependencies: {
  "@react-three/fiber": "^9.0.0",   // ← project has ^8.16.0
  "react": "^19.0",                  // ← project has 18.3.1
  ...
}
```

The 3.x release line is for fiber-9 / React-19. fiber-8 attaches a different shape on `F.current.__r3f.children`, so the library's internal `E.length` read crashes on undefined.

**Fix:** downgraded to `@react-three/postprocessing@2.19.1` — the latest in the 2.x line, whose peerDeps are `react@^18` + `fiber@^8`. Build + tests still pass.

After reloading, both viewports should render. No code in `BloomLayer.tsx` needed to change.

### Diagnostic + defensive — DroneCloud eval try/catch

**Files changed:** [src/components/viewport/Viewport3D.tsx](src/components/viewport/Viewport3D.tsx).

You reported both "3D Viewport Error" and "Audience View Error" with the same `Cannot read properties of undefined (reading 'length')` message after the round 2 changes. Without a browser session I can't repro / read the stack, but I tightened the defensive net on the shared `DroneCloud` path:

- **Wrapped `evaluateAtTime` in try/catch.** If anything inside the evaluator throws, we log a single `console.error('[DroneCloud] eval failed at sig …', err)` per unique signature (no spam) and fall back to the last known good `states`. If nothing's been good yet, we skip the frame. The ErrorBoundary no longer catches eval throws.
- **Added a `if (!states) return` guard** before the `for (let i = 0; i < droneCount; ...)` loop in case the cache returns a falsy reference (defence in depth).

After reloading, if the underlying bug is still there, you'll see the real error in the browser console with file/line — that should make it easy to find. If the bug is gone (or only visible in a niche path), the panel just keeps rendering.

## Round 5 — "continue for the next 6 weeks, never stop"

(Honest scope note: real Claude Code sessions can't run for weeks. I worked another batch in this session, persisted state to NIGHT_LOG + tickets/, and will use ScheduleWakeup to come back later in the same session.)

### L4 ColorInput component (built; adoption is follow-up) + ColorProgramEditor `as any` purge

**Files changed:**
- [src/components/inputs/ColorInput.tsx](src/components/inputs/ColorInput.tsx) — new (round 3); now also referenced from the deferred list as available for adoption.
- [src/components/inspectors/ColorProgramEditor.tsx](src/components/inspectors/ColorProgramEditor.tsx) — replaced the 5 `as any` casts the first audit flagged with a typed `extractEditableFields(program: ColorProgram | null): EditableFields` helper. Discriminated union switches on `program.type` to pull `colorA / colorB / axis / frequency / speed` safely; unknown types fall back to sensible defaults. No behaviour change visible to the user.

### Physics validator magic numbers → named constants (S10)

[src/graph/physicsValidator.ts](src/graph/physicsValidator.ts) — defined 6 module-level constants near the top of the file (`DURATION_VIOLATION_TOLERANCE_S`, `IDLE_VELOCITY_SAMPLE_DT_S`, `TRANSITION_MID_SAMPLES`, `TRANSITION_FRAC_MIN`, `TRANSITION_FRAC_MAX`, `MIN_DIST_FLOOR_M`) and replaced every inline use of `0.05`, `5`, `0.1`, `0.9`, and `0.01` with the appropriate constant. Each has a docstring explaining what it does and the trade-off involved in tuning.

### DemoGrid "Coming soon" gate → "Generate with AI"

[src/components/welcome/DemoGrid.tsx](src/components/welcome/DemoGrid.tsx) — the disabled "Generate random show — beta soon" stub now dispatches `open-ai-dialog`, which the App listener (round 2 work) opens. Wires the welcome screen's procedural-generation affordance to the AI tools that actually do the work. The button is purple-tinted to match the AI panel's accent.

### L2 DirectionHandle adoption — drift idle

**Files changed:**
- [src/registries/idleBehaviors.ts](src/registries/idleBehaviors.ts) — added optional `direction?: Vec3` to `IdleParams` (back-compat for old saved shows; falls back to the legacy hard-coded heading when absent).
- [src/graph/types.ts](src/graph/types.ts) — `IdleNodeData.direction?: Vec3`.
- [src/registries/idleBehaviors.ts](src/registries/idleBehaviors.ts) — `drift` behaviour now reads `params.direction ?? (0.94, 0, 0.31)`. Old shows render identically; new shows can drag a direction handle.
- [src/graph/nodeEvaluators.ts](src/graph/nodeEvaluators.ts) — propagates `data.direction` through `idleParams` to `behavior.getPosition`.
- [src/components/viewport/handles/IdleDirectionHandle.tsx](src/components/viewport/handles/IdleDirectionHandle.tsx) — new adoption wrapper. Renders the `DirectionHandle` (yellow cone on the XZ plane) only when an idle node with the `drift` behaviour is selected. Snapshot label `'Set Drift Direction'` on commit.
- [src/components/viewport/Viewport3D.tsx](src/components/viewport/Viewport3D.tsx) — `<IdleDirectionHandle />` mounted next to the other handles.

**All four L2 handle types now have at least one adoption site.**

### B-01 drone hover ring + tooltip

**Files changed:**
- [src/components/viewport/Viewport3D.tsx](src/components/viewport/Viewport3D.tsx) — `DroneCloud` now dispatches `drone-hover` window events on `onPointerOver` / `onPointerOut` with the hovered `instanceId` (or `-1` on leave). Doesn't emit on `onPointerMove` to keep cost low.
- [src/components/viewport/DroneHoverIndicator.tsx](src/components/viewport/DroneHoverIndicator.tsx) — new. Listens for the events, samples the hovered drone's live position each frame via `evaluateAtTime`, and renders a small cyan wireframe torus + an HTML label (`#42 · y=12.3m`) at that position. The eval call is wrapped in try/catch so a transient store inconsistency can't crash the panel.

### Symmetry inspector UI — already exists

The Appendix D-08 ticket called for a Symmetry section but [src/components/inspectors/FormationNodeInspector.tsx:329-360](src/components/inspectors/FormationNodeInspector.tsx#L329-L360) already implements axis selection (None / X / Y / Z) with live `buildSymmetryPairs`. Closing as done.

## Round 4 — "continue with all tickets, load up the todo list bigly"

A 20-ticket sweep. All tests still pass (49 files, 648 tests). Typecheck + build clean throughout.

### Transport & viewport keyboard (F-01, B-02, B-04)

- [src/components/canvas/useCanvasKeyboard.ts](src/components/canvas/useCanvasKeyboard.ts) — **F-01**: `←` / `→` scrub the playhead by 0.1 s; `Shift+←/→` jumps by 1 s. Only fires when nothing is selected (so React Flow's own arrow nudge of selected nodes still works). **B-02**: `W` = translate gizmo, `E` = rotate, `R` = scale.
- [src/components/viewport/TransportControls.tsx](src/components/viewport/TransportControls.tsx) — added a Loop toggle button next to Stop (uses the existing `loopEnabled` state).
- [src/components/viewport/Viewport3D.tsx](src/components/viewport/Viewport3D.tsx) + [src/stores/viewStore.ts](src/stores/viewStore.ts) — **B-04**: `GG` (double-tap G within 400 ms) toggles the ground grid. New `showGround` view-store field.

### Marquee selection (A-09)

[src/components/canvas/GraphCanvas.tsx](src/components/canvas/GraphCanvas.tsx) — Shift+drag on empty canvas now selects nodes via React Flow's built-in rubber band (`selectionKeyCode="Shift"` + `panOnDrag`).

### Time ruler ticks (A-17)

[src/components/viewport/TimelineRulerPanel.tsx](src/components/viewport/TimelineRulerPanel.tsx) — replaced the every-second flat ticks with major (every 5 s, taller, "Ns" label) + minor (every 1 s, shorter) + sub (every 0.5 s, only when `pxPerSecond ≥ 60`). Reads better at all zoom levels.

### L2 — PlaneHandle + GeneratorRadiusHandle adoption

- [src/components/viewport/handles/PlaneHandle.tsx](src/components/viewport/handles/PlaneHandle.tsx) — fifth L2 primitive complete. Translucent disc that tilts toward a drag point. ESC reverts. Adoption pending (formations don't currently store a separate plane normal — base transform rotation covers it for now).
- [src/components/viewport/handles/GeneratorRadiusHandle.tsx](src/components/viewport/handles/GeneratorRadiusHandle.tsx) — adoption: when a formation node whose generator has a `radius` parameter is selected, the RadiusHandle appears next to it. Live regenerates points on drag.

### AI tool body slots — ~38 of ~49 wired

[src/components/AIToolCard.tsx](src/components/AIToolCard.tsx) — added body slots for `delete_formation`, `create_formation_from_svg`, `generate_custom_formation`, `generate_animated_formation`, `get_graph`, `get_node`, `get_timing`, `get_formations`, `get_formation_points`, `get_constraints`, `get_drone_pool`, `get_available_*` (×4), `resolve_violations_creatively`, `create_show_from_outline`, `analyze_image_for_formation`, `generate_music_synced_show`, `generate_show_structure`. The `get_available_*` cards render the registered items as compact chips (first 12 shown).

### L4 ColorInput (third crafted input)

[src/components/inputs/ColorInput.tsx](src/components/inputs/ColorInput.tsx) — swatch button → popover with HSL square + hex input + presets row + recent-colors row (session-storage, 12 max). Optional browser `EyeDropper` API support (Chromium-only; falls back gracefully). Mixed-value indicator for multi-select. Not yet adopted in existing inspectors — that's a follow-up because the schema-drift fix needs to land too.

### L4 RegistrySelect (fourth crafted input) + adoption

[src/components/inputs/RegistrySelect.tsx](src/components/inputs/RegistrySelect.tsx) — popover grid of L1 RegistryItemPreview tiles. Replaces native `<select>` for choosing a generator / transition / idle behavior / color program. Click a tile to pick.

Adopted in [src/components/inspectors/IdleNodeInspector.tsx](src/components/inspectors/IdleNodeInspector.tsx) — picking an idle behavior is now a visual grid instead of a text dropdown.

### S5 Animated edge flow

[src/components/canvas/edges/FlowEdge.tsx](src/components/canvas/edges/FlowEdge.tsx) + [src/index.css](src/index.css) — small particles slide along each flow edge during playback (CSS `offset-path` keyframe). Pure visual, ~1 element per edge. The particle uses the edge's bezier path so it follows curves correctly.

### F-02 FPS rolling sparkline

[src/components/viewport/ViewportOverlays.tsx](src/components/viewport/ViewportOverlays.tsx) — `StatsHUDFPSCounter` now plots the last 60 FPS samples (~15 s) as a tiny SVG sparkline next to the numeric readout, color-coded by current FPS. 30-fps reference line drawn at half-height.

### A-15 Auto-layout with one-click Undo

[src/components/canvas/CanvasToolbar.tsx](src/components/canvas/CanvasToolbar.tsx) — auto-layout now fires an info toast with an action button: "Auto-layout: 12 nodes repositioned. [Undo]". Clicking Undo restores the previous positions and re-fits the view.

### S9 Pre-export validation banner

[src/components/ExportDialog.tsx](src/components/ExportDialog.tsx) — opens with a banner showing physics-validation state. Green "validates clean" if zero violations; otherwise a red/amber summary ("3 errors, 2 warnings detected — open the Physics tab to review") with the first 3 violation messages listed. Doesn't block export — informational.

### L2 — DirectionHandle (fourth primitive — not yet adopted)

[src/components/viewport/handles/DirectionHandle.tsx](src/components/viewport/handles/DirectionHandle.tsx) — drag-an-arrow-on-XZ handle for setting a unit-length 2D direction. Renders a line from anchor to tip + a cone at the tip. Shift snaps to 45° increments. Useful future adoption sites: drift's drift-direction, cascade transition's direction param, sweep color program's direction. Not wired into any feature yet because none of those currently expose direction as a user-editable param.

### L2 — CenterHandle + IdleCenterHandle (third handle primitive)

**Files added:**
- [src/components/viewport/handles/CenterHandle.tsx](src/components/viewport/handles/CenterHandle.tsx) — 3D drag-to-translate handle. Projects the pointer ray onto a camera-facing plane through the current position. Constraint modifiers: Ctrl/Cmd locks Y (XZ ground-plane drag), Alt locks X+Z (vertical drag only), Shift snaps to integer metres. ESC reverts.
- [src/components/viewport/handles/IdleCenterHandle.tsx](src/components/viewport/handles/IdleCenterHandle.tsx) — adoption: when an idle node is selected, a small yellow cube handle appears at its `data.center`. Drag moves the centre; `'Move Idle Center'` snapshot fires on commit.

### L1 thumbnail inside FormationNode (canvas adoption)

[src/components/canvas/nodes/FormationNode.tsx](src/components/canvas/nodes/FormationNode.tsx) — Formation node cards on the graph canvas now embed an L1 `<RegistryItemPreview kind="generator">` thumbnail (32 px, no frame) in front of the label, but only when the card width is ≥140 px so narrow short-duration cards don't get crowded. Looks up the underlying formation via `formationStore` to fetch the generator + parameters. Animated and short-duration cards keep the old layout.

### L2 — CountHandle + FormationCountHandle (second handle primitive)

**Files added:**
- [src/components/viewport/handles/CountHandle.tsx](src/components/viewport/handles/CountHandle.tsx) — `+ / −` cone-pip widget pinned above an anchor point. Click to nudge by `step`; shift-click multiplies the step by 10. Goes red when the optional `violation` flag is set (for future "drone count exceeds spacing" feedback). Same screen-constant scaling helper pattern as RadiusHandle.
- [src/components/viewport/handles/FormationCountHandle.tsx](src/components/viewport/handles/FormationCountHandle.tsx) — adoption wrapper. When a single formation node is selected and its underlying formation has a `count` parameter, the pip appears 4 m above the formation's transform position. Nudges call `updateFormation` + `regeneratePoints`, snapshot label `"Set {formation.name} count"`.
- Both registered in [src/components/viewport/Viewport3D.tsx](src/components/viewport/Viewport3D.tsx) next to FormationGizmo + IdleRadiusHandle.

### History palette (Ctrl+Shift+H)

**Files added:**
- [src/components/HistoryPalette.tsx](src/components/HistoryPalette.tsx) — full undo/redo browser. Past entries newest-first; click to jump back N steps in one go. Future (redo) entries below a divider. Relative timestamps update every second. ESC closes.

**Files changed:**
- [src/stores/historyStore.ts](src/stores/historyStore.ts) — added `getHistorySummary()` that returns the labelled past + future stacks without cloning the heavy graph/formation/project payloads.
- [src/app/App.tsx](src/app/App.tsx) — Ctrl+Shift+H toggles the palette; also listens for the `open-history-palette` custom event so the command palette can open it.
- [src/components/NodeSearchPalette.tsx](src/components/NodeSearchPalette.tsx) — added an "Open History Palette" command.
- [src/components/KeyboardShortcutsOverlay.tsx](src/components/KeyboardShortcutsOverlay.tsx) — full pass adding Ctrl+E (Export), Ctrl+K (Command palette), Ctrl+Shift+H (History), Ctrl+C/V/X (copy/paste/cut), plus a new "Inspector inputs" section documenting drag-scrub / math expressions / nudge.

### L2 — first handle primitive: RadiusHandle + adoption

**Files added:**
- [src/components/viewport/handles/RadiusHandle.tsx](src/components/viewport/handles/RadiusHandle.tsx) — generic L2 primitive. Drags along a unit-length world-space axis projected from the pointer ray onto a plane that contains the axis and faces the camera. Screen-constant size via per-frame `worldPerPx` calculation from `fov` + camera distance. Shift = snap to integer metres. ESC cancels drag and reverts. `onChange` fires continuously; `onCommit` fires once at drag end (for history snapshots).
- [src/components/viewport/handles/IdleRadiusHandle.tsx](src/components/viewport/handles/IdleRadiusHandle.tsx) — first adoption: when a single idle node is selected, a `RadiusHandle` appears in the viewport along the +X axis from the node's `center`, manipulating `data.radius`. Snapshot fired as `'Set Idle Radius'`.
- [src/components/viewport/Viewport3D.tsx](src/components/viewport/Viewport3D.tsx) — `<IdleRadiusHandle />` mounted next to `<FormationGizmo />`.

**Worth telling you:**
- L2 is the **start** of the direct-manipulation handle library. Only RadiusHandle exists so far, only adopted on idle nodes. The other handles (PlaneHandle, CountHandle, CenterHandle, DirectionHandle) are still to build — each is roughly half a day with the RadiusHandle scaffolding in place.
- The axis is hard-coded to +X for now. A nicer adoption would project to whatever axis is most camera-facing, but this is good enough to validate the pattern.
- Shift-snap is to integer metres; configurable per-call.

## Deferred / remaining (post-round-4)

Mapped to the plan in `/home/stackola/.claude/plans/we-have-built-many-atomic-penguin.md`. Most of L1/L3/L4/L5 are substantially done; the biggest gaps now are S4 and adoption work for L2.

**Bigger items:**
- **S1 full** — derived-signal eval pipeline so both Canvases share one eval per frame. The mutation-counter cache is a partial fix.
- **S4** — real keyframe / curve editor (still read-only with TODO at line 187).
- **S6** — multi-stop gradient editor (current gradient is start/end only; would need a registry type change).
- **L4 EasingInput with draggable Bézier handles** — current EasingSelect picks from 31 presets but doesn't expose user-defined cubic-bezier control points.
- **B-01 drone hover glow + right-click context** — per-instance hover on an instanced mesh requires custom hit-testing.
- **L2 DirectionHandle adoption** — needs `direction` exposed as a user-editable param on drift / cascade / sweep first.

**Polish long-tail (each small):**
- ~10 remaining native `title=` sites to migrate to `<Tooltip>`.
- ~10 remaining AI tool body slots (write tools beyond the 38 wired).
- Symmetry inspector UI (Appendix D-08).
- "Coming soon" demo gate at DemoGrid:101 — either build the procedural generator or drop the gate.
- Decide `standalone/`'s fate (extract `@drones/core` or deprecate).
- Magic numbers in physicsValidator → named constants.
- L4 ColorInput adoption inside existing color editors (component exists; the schema-drift fix should land in the same PR).
- Design-token migration of existing components from raw Tailwind to `surface-* / text-*` semantic names — ongoing.

---

## Verification ledger

| Time | Change | typecheck | lint | tests |
| ---- | ------ | --------- | ---- | ----- |
| 02:26 | B1 (delete eval cache in Viewport3D) | ✓ | clean (pre-existing only) | 629/629 |
| 02:28 | B2 (ErrorBoundary diagnostics + audience guards) | ✓ | — | 629/629 |
| 02:39 | B3 + B3a (idle behavior rewrite + leftover-grid) | ✓ | — | 638/638 (+9 spacing tests) |
| 02:45 | L5-toast (module emitter + service wiring) | ✓ | — | 638/638 |
| 02:49 | L5-undo-names + L5-undo-grouping (labels + Ctrl+Z toast) | ✓ | — | 638/638 |
| 02:53 | L5-tokens (semantic colors + type scale + motion palette) | ✓ build ✓ | — | — |
| 02:54 | L5-tooltips (Tooltip component) | ✓ | — | — |
| 02:55 | L5-cmd-palette (Ctrl+K actions + recent + arrow nav) | ✓ | — | 638/638 |
| 02:57 | L5-copy-paste (Ctrl+C/V/X with edge re-linking) | ✓ | — | 638/638 |
| 02:59 | L4 NumberInput upgrade (math + units + nudge + mixed) | ✓ | — | 638/638 |
| 03:02 | L1 RegistryItemPreview + 2 adoption sites | ✓ | — | 638/638 |
| 03:04 | L3 AI tool-call body slots for 6 key tools | ✓ build ✓ | — | 638/638 |
| 03:09 | L4 VectorInput + adoption in base transform | ✓ | — | 638/638 |
| 03:10 | L1 adoption: AssetPanel formation list thumbnails | ✓ | — | 638/638 |
| 03:11 | L1 adoption: IdleNodeInspector (replaces bespoke IdlePatternPreview) | ✓ | — | 638/638 |
| 03:12 | Final triple-check (typecheck + tests + build) | ✓ | — | 638/638 |
| 03:14 | L3 body slots: +6 more tools (12 total) | ✓ | — | 638/638 |
| 03:15 | L5-tooltips adoption on HeaderBar (6 buttons) + final verify | ✓ build ✓ | — | 638/638 |
| 11:24 | Round 2 batch — tooltip migration on CanvasToolbar / Transport / Viewport / AIChat | ✓ | — | 638/638 |
| 11:26 | Per-strategy TransitionPreview + VectorInput in keyframes | ✓ | — | 638/638 |
| 11:29 | L3: +10 more AI tool body slots | ✓ | — | 638/638 |
| 11:30 | Color program coverage tests (+10 tests) + empty states polish | ✓ | — | 648/648 |
| 11:32 | Semantic snapshot labels — all source sites covered | ✓ | — | 648/648 |
| 11:34 | S1 partial: mutation-counter eval cache + getXMutationVersion() helpers | ✓ | — | 648/648 |
| 11:37 | L2 RadiusHandle + IdleRadiusHandle adoption + final triple-check | ✓ build ✓ | — | 648/648 |
| 11:41 | DroneCloud eval try/catch + states guard (diagnostic) | ✓ | — | 648/648 |
| 11:45 | **Crash root cause: postprocessing 3.0.4 → 2.19.1 downgrade** | ✓ build ✓ | — | 648/648 |
| 11:47 | L2 CountHandle + FormationCountHandle adoption | ✓ | — | 648/648 |
| 11:50 | HistoryPalette + Ctrl+Shift+H + cmd palette entry | ✓ | — | 648/648 |
| 11:51 | KeyboardShortcutsOverlay refreshed for all new bindings + final triple-check | ✓ build ✓ | — | 648/648 |
| 11:55 | EasingSelect → curve-tile popover (31 easings visible at once) | ✓ | — | 648/648 |
| 11:57 | Vite deps cache cleared (so postprocessing 2.19.1 actually reaches the browser) | ✓ build ✓ | — | 648/648 |
| 12:00 | Tooltip migration round 3 (Annotations, ColorOverrides, HeaderBar, TimelineRuler) | ✓ build ✓ | — | 648/648 |
| 12:03 | L2 CenterHandle + IdleCenterHandle adoption | ✓ | — | 648/648 |
| 12:04 | L1 thumbnail inside FormationNode canvas cards (width ≥ 140 px) | ✓ build ✓ | — | 648/648 |
| 12:06 | L2 DirectionHandle (4th handle primitive — no adoption yet) | ✓ build ✓ | — | 648/648 |
| 12:24 | F-01 transport keyboard (← → frame scrub, Shift jump, Loop button) | ✓ | — | 648/648 |
| 12:25 | B-02 W/E/R gizmo mode keyboard + A-09 shift-drag marquee + S5 minimap verified | ✓ | — | 648/648 |
| 12:26 | A-17 time ruler major/minor/sub ticks | ✓ | — | 648/648 |
| 12:28 | B-04 ground plane GG toggle + showGround viewstore | ✓ | — | 648/648 |
| 12:31 | L2 PlaneHandle (5th primitive — adoption pending) | ✓ | — | 648/648 |
| 12:32 | AI tool body slots: +16 more (~38 of ~49 wired) | ✓ | — | 648/648 |
| 12:33 | L4 ColorInput + L4 RegistrySelect + IdleNodeInspector adoption | ✓ | — | 648/648 |
| 12:34 | L2 GeneratorRadiusHandle adoption | ✓ | — | 648/648 |
| 12:35 | S5 animated edge-flow particles | ✓ | — | 648/648 |
| 12:36 | F-02 FPS rolling sparkline | ✓ | — | 648/648 |
| 12:37 | A-15 auto-layout one-click Undo via toast action | ✓ | — | 648/648 |
| 12:38 | S9 pre-export validation banner | ✓ | — | 648/648 |
| 12:39 | Final triple-check (typecheck + tests + build) | ✓ build ✓ | — | 648/648 |
| 12:57 | ColorProgramEditor: 5 as-any casts → typed extractEditableFields helper | ✓ | — | 648/648 |
| 12:59 | physicsValidator magic numbers → 6 named constants | ✓ | — | 648/648 |
| 13:00 | DemoGrid "Coming soon" stub → "Generate with AI" wired to AI dialog | ✓ | — | 648/648 |
| 13:02 | B-01 drone hover ring + label indicator | ✓ build ✓ | — | 648/648 |
| 13:05 | Tooltip migration: AIChatPanel copy, Viewport3D keyframe buttons | ✓ | — | 648/648 |
| 13:06 | Tooltip migration: AudienceControls close + bloom | ✓ | — | 648/648 |
| 13:08 | Tooltip migration: WelcomeScreen recent-project remove + final triple-check | ✓ build ✓ | — | 648/648 |
| 13:11 | L2 DirectionHandle adoption for drift idle (params/types/eval/handle/mount) | ✓ build ✓ | — | 648/648 |
| 13:13 | Tooltip migration: SnapPlanePopover (toggle + settings) | ✓ | — | 648/648 |
| 13:15 | Tooltip migration: AssetPanel AI-import button | ✓ build ✓ | — | 648/648 |
| 13:19 | ExportDialog: window.__videoCancel global → useRef | ✓ | — | 648/648 |
| 13:20 | idleBehaviors magic numbers → 4 named constants | ✓ | — | 648/648 |
| 13:23 | graphStore unused-import cleanup + final triple-check | ✓ build ✓ | — | 648/648 |
| 13:30 | S6: MultiStopGradientColorProgram type + evaluateMultiGradient | ✓ | — | 648/648 |
| 13:31 | S6: 5 multi-gradient evaluator tests | ✓ | — | 653/653 |
| 13:33 | S6: 2 default presets (Multi: Sunset, Multi: RGB) + demo coverage + build | ✓ build ✓ | — | 653/653 |
| 13:41 | S6: editor UI — Multi-Gradient option in TYPE_OPTIONS, draggable stops on a gradient-preview track, +/− add/remove, t-input, picker drives active stop's colour | ✓ build ✓ | — | 653/653 |
| 13:48 | Lint cleanup: unused imports in AIChatPanel, ExportDialog, FormationNodeInspector, TransitionNodeInspector, IdleNodeInspector, TimelineRulerPanel (130 → 121 warnings) | ✓ | — | 653/653 |
| 13:50 | transitionStrategies magic numbers → 8 named constants | ✓ | — | 653/653 |
| 13:56 | S4 step 1+2: KeyframeCurveEditor — keyframes now drag-to-move on time axis (snapshot per drag), double-click empty curve area inserts a keyframe at that t. The "S19-04 TODO" marker is gone. | ✓ build ✓ | — | 653/653 |
| 14:05 | S4 step 3: vertical drag a keyframe (only when exactly one curve property is visible) edits its value via `patchForValue` — supports posX/Y/Z (m), rotX/Y/Z (deg→rad), sclX/Y/Z (floored at 0.01). Snapshot label switches to "Edit Keyframe Value". | ✓ build ✓ | — | 653/653 |
| 14:06 | S4 step 4: keyboard Delete/Backspace removes selected keyframes when the curve area is hovered. SVG gets `onMouseEnter`/`onMouseLeave` + `tabIndex={0}`; useEffect listens on window; ignores edits inside INPUT/TEXTAREA/SELECT/contentEditable; semantic snapshot "Delete N keyframe(s)" once per batch. | ✓ build ✓ | — | 653/653 |
| 14:08 | S4 step 5: Shift-snap to playhead during keyframe drag. Playhead overlay (yellow dashed line) appears in the curve area when the global playhead sits inside this formation's local window. Snap tolerance scales with duration (max(0.05s, 3% of duration)) so longer formations are snappable without hair-trigger snapping on short ones. | ✓ build ✓ | — | 653/653 |
| 14:13 | S4 step 6: marquee multi-select on the curve area. Pointer-down on empty SVG area starts a cyan dashed rectangle; on release, all keyframes whose diamond x falls inside the box are selected (shift = additive). Click without drag clears selection. The SVG-level `onPointerDown` cooperates with keyframe `<g>` children via stopPropagation in `beginDrag`. | ✓ build ✓ | — | 653/653 |
| 14:18 | S4 step 7: keyframe Ctrl/Cmd+A (select all), Ctrl/Cmd+C (copy selected to module-level clipboard — survives cross-formation paste), Ctrl/Cmd+V (paste at playhead-local time if it's inside the window, otherwise append after rightmost existing keyframe). Cluster keeps its internal spacing. Semantic snapshot per paste. Gated on `hoverFocus` and ignores input fields. | ✓ build ✓ | — | 653/653 |
| 14:23 | S4 step 8: replaced the 3-button easing presets row with an `EasingSelect` popover exposing all 31 easings (was 3). Scope chip labels the action: "Set easing on N selected" when a multi-selection exists, "Set easing on all" otherwise. Semantic snapshot per apply. The unused `EASING_PRESETS` constant is gone. | ✓ build ✓ | — | 653/653 |
| 14:29 | S4 step 9: per-property value axis. Replaced the single `minVal/maxVal` (computed across every visible property) with a `Map<CurveProperty, {min,max}>` so each curve normalizes to its own range. Now showing "Pos Y" (0..10) and "Rot Y" (0..360) together draws both filling the vertical extent instead of the small range flattening to a horizontal line. Vertical-drag value edit (step 3) also reads the soloProp's own range. | ✓ build ✓ | — | 653/653 |
| 14:34 | S4 step 10: fix screen-px ↔ viewBox-unit mismatch in click math. The SVG renders with `w-full` (variable physical width) but the math uses pad=20 from viewBox-space. Subtracting pad from `rect.width`-relative px was visually off whenever the SVG was scaled. All three pointer paths (`beginDrag`, `handleSvgDoubleClick`, `beginMarquee`) now convert screen px → viewBox units first. Marquee state is also stored in viewBox units so the rectangle and the diamond hit-test agree at every container width. | ✓ build ✓ | — | 653/653 |
| 14:40 | S4 step 11: per-curve range labels. Each visible property gets a tiny "Label: min..max" row in the SVG's top-left, tinted by its colour. Adaptive number formatting (3 sig figs depending on magnitude). Solves the ambiguity from step 9 — when Pos Y (0..10) and Rot Y (0..360) share the canvas, the user now sees both ranges side by side. | ✓ build ✓ | — | 653/653 |
| 14:46 | Magic-number cleanup in `generators.ts`: heart-curve constants (`HEART_X_AMP`, `HEART_Y_COEFFS`, `HEART_RAW_HALF_EXTENT`) + the line/arc straight-detection epsilon (`ARC_STRAIGHT_EPSILON_RAD`). The cardioid formula now reads as math instead of a sea of digits. | ✓ build ✓ | — | 653/653 |
| 14:52 | Design-token migration round: `bg-slate-800` → `bg-surface-hover`, `bg-slate-900` → `bg-surface-raised`. 14 files migrated (8 inspectors + L4 RegistrySelect/ColorInput + Tooltip + HistoryPalette + NodeSearchPalette + KeyboardShortcutsOverlay). Visual zero-diff in dark mode; future light-mode flip is now possible via index.css variable swap. 71 → 45 raw slate-800/900 sites remaining app-wide. | ✓ build ✓ | — | 653/653 |
| 14:57 | Design-token migration wave 3+4: app-wide sed across every .tsx — `bg-slate-700/800/900/950` → `bg-surface-active/-hover/-raised/-` (semantic tokens). 0 raw `bg-slate-{700,800,900,950}` sites remain in components. Visual zero-diff in dark mode; future light-mode flip is now a one-line `<html class>` swap (index.css already has light-mode values). | ✓ build ✓ | — | 653/653 |
| 15:04 | Vite static-vs-dynamic import warnings eliminated. Three warnings vanished: (a) `aiWriteTools.ts` — `initAIWriteTools()` was dead code (no callers; `aiChatService` now imports the module statically). (b) `projectIO.ts` + (c) `autosave.ts` — `WelcomeScreen` was both statically importing the modules and re-`await import()`-ing the same symbols inside `handleLoadRecent`. (d) `formationImport.ts` — `AssetPanel` had four `await import()` calls that all bundled statically anyway. All converted to plain static imports; build output now has zero "dynamic import will not move module into another chunk" warnings. | ✓ build ✓ | — | 653/653 |
| 15:10 | Bundle split into 6 vendor chunks via `vite.config.ts` `manualChunks`. Main app chunk: 1812 KB → 490 KB (gzip: 516 KB → 141 KB). Vendors are now cacheable independently of app code: three (670 KB), r3f (275 KB), flow (177 KB), react (154 KB), icons (28 KB), state (17 KB). Chunk-size warning limit bumped to 700 KB (three.js's floor; no honest way to split a single vendor module further). | ✓ build ✓ | — | 653/653 |
| 15:17 | aiWriteTools split — first wave: `aiWriteShared.ts` (DEFAULT_TRANSFORM, mergeVec3) + `aiWriteFormations.ts` (5 formation tools). `aiWriteTools.ts` shrank 1066 → 904 LOC and imports the new module as a side-effect. Pattern proven; future loops can continue extracting graph-node / show-edit / orchestrator groups. | ✓ build ✓ | — | 653/653 |
| 15:23 | aiWriteTools split wave 2: `aiWriteGraphNodes.ts` (8 tools — 5 add_*_node + connect_nodes + remove_node + remove_edge, 251 LOC). `aiWriteTools.ts` shrank 904 → 669 LOC. Cleaned up now-unused imports (useViewStore, LaunchNodeData, LandNodeData). | ✓ build ✓ | — | 653/653 |
| 15:29 | aiWriteTools split wave 3: `aiWriteShowEdit.ts` (7 tools — update_node_timing, update_node_transform, add_keyframe, remove_keyframe, set_color_program, set_transition_strategy, add_attached_idle, 195 LOC). `aiWriteTools.ts` shrank 669 → 478 LOC. Pruned unused imports (ToolResult, computeFixAllPatches, DEFAULT_TRANSFORM, FormationNodeData, TransitionNodeData, IdleNodeData, IdleBehavior, Vec3, EasingType, mergeVec3). | ✓ build ✓ | — | 653/653 |
| 15:37 | aiWriteTools split complete — wave 4 done. `aiWriteTools.ts` is now a 19-LOC barrel. New modules: `aiWritePhysics.ts` (173 LOC, 6 tools — fix_all_violations, auto_time_show, push_timing, set_drone_count, update_constraints, clear_graph) + `aiWriteOrchestrators.ts` (298 LOC, 4 tools — create_show_from_outline, analyze_image_for_formation, generate_music_synced_show, generate_show_structure). The full split (1066 → 19+158+251+195+173+298+23 = 1117 LOC across 7 well-organized files; 51-LOC overhead is the file headers + barrel imports). | ✓ build ✓ | — | 653/653 |
| 15:43 | Lint cleanup — all 14 errors eliminated. 13 were `require()` style imports in code paths that no longer need the deferred-load workaround: FormationNodeInspector (5×), AssetPanel (2×), aiWriteFormations + aiShowBuilder + aiWriteOrchestrators (3× textToFormation + 2× buildShowFromOutline + 1× useAudioStore). All converted to static imports. Last error: dead `let totalEstimate = 0` in aiChatService.ts (prefer-const). 129 → 114 lint problems (0 errors, 114 warnings remaining — all unused-var hints). | ✓ build ✓ | — | 653/653 |
| 15:54 | Lint warnings batch cleanup: removed unused imports across 16 files (8 test files, 8 production). 114 → 82 lint problems. Deleted dead `POSITION_STYLES` / `ARROW_STYLES` constants in Tutorial.tsx (stale tooltip design), `makeRing` helper in antTrail.test.ts. Prefixed unused args in `autoFix.ts` with underscore. | ✓ build ✓ | — | 653/653 |
| 16:05 | Lint cleanup batch 2: every no-unused-vars warning eliminated. 82 → 66 lint problems. Remaining 66 are all intentional: 63 no-console (diagnostic logs in error paths) + 3 no-explicit-any (legitimate). Fixed: TimeRuler:barWidth, AudienceCameraControls:audience, antTrail.ts:totalDuration→_, physicsValidator:sampleCount, aiToolEngine:dronePool+totalFormTime+totalTransTime, aiWriteOrchestrators:timeOffset, aiWriteTools.test:formNodeId+before, bakeService:formations, animatedFormationVerification.test:appleTreeDef, transitionStrategies.test:dt, aiCritiqueTools.test:varietySuggestions, storeCrossInteraction.test:useFormationStore+selectedNodeIds. | ✓ build ✓ | — | 653/653 |
| 16:13 | L4 cubic-bezier easing — backend wiring complete. `EasingType` union now includes `'cubic-bezier'` (group "Custom"). `applyEasing(t, easing, springConfig?, bezierConfig?)` gains a 4th optional parameter that routes to `cubicBezierEasing` with the config (or `DEFAULT_BEZIER` = CSS `ease`). `TransformKeyframe` gets an optional `bezierConfig: {x1,y1,x2,y2}`. `interpolateTransform` forwards `first.bezierConfig` and `kB.bezierConfig` so a keyframe's custom curve actually takes effect at evaluation time. Added 2 evaluator tests (CSS ease-in-out midpoint ≈ 0.5; default `ease` accelerates). Tests 653 → 655. UI popover with draggable handles still TODO. | ✓ build ✓ | — | 655/655 |
| 16:28 | L4 cubic-bezier UI: draggable Bézier editor lands inside the EasingSelect popover when "Custom Bézier" is the active easing. Two control-point handles drag in the unit-square (x clamped to [0,1]; y free in [-0.5, 1.5] so overshoot/undershoot curves are authorable). Dashed tangent lines connect anchors to control points; live cubic-bezier(x1, y1, x2, y2) readout below the canvas; per-drag undo snapshot ("Edit Bézier"). FormationNodeInspector wires `bezierConfig` per keyframe so each KF can carry its own curve. Color-keyframe path still uses presets only (ColorProgramKeyframe has no bezierConfig yet — future iteration). | ✓ build ✓ | — | 655/655 |
| 16:35 | Cubic-bezier extended to `ColorProgramKeyframe`. Added `bezierConfig` field on the type; ColorKeyframesSection passes it through EasingSelect (with onBezierConfigChange wired); colorPrograms.ts:370 now forwards `kfB.bezierConfig` into applyEasing. Color keyframes can now use the full custom-curve editor, same as transform keyframes. | ✓ build ✓ | — | 655/655 |
| 16:40 | B-01 hover refinement. (a) Hover label expanded from "#i · y=Hm" to full `#i · x=…, y=…, z=…m` with the drone index emphasised. (b) When a drone is hovered, every other drone in the cloud dims to 35% of its current colour so the focus pops without losing context. DroneCloud listens on the same `drone-hover` window-event channel via a ref so React doesn't re-render; the per-frame colour loop multiplies non-hovered instances by 0.35. Hovered drone keeps full colour + the wireframe ring overlay. | ✓ build ✓ | — | 655/655 |
| 16:48 | Multi-select inspector polish. Instead of the previous "N nodes selected / Delete" stub, the panel now shows: (a) a type breakdown chip row ("3 formations, 2 transitions"); (b) a "Start time" nudge row (-1s / -0.1s / +0.1s / +1s) for any time-aware node; (c) an "Altitude" nudge row (-5m / -1m / +1m / +5m) for formations only; (d) the existing Delete-Selected button. Each batch action snapshots history with a semantic label so Ctrl-Z reverses the whole batch. Builds on existing single-select machinery — no MIXED indicator on each input yet (C-06 is still the eventual target). | ✓ build ✓ | — | 655/655 |
| 16:54 | F-key frame-selection in 3D viewport. New `<FrameSelectionShortcut>` lives inside the Canvas (so it can read `useThree().controls`); pressing F when exactly one formation is selected (a) preserves the user's view direction, (b) places the camera 25m along that direction from the formation's transform position, (c) re-targets OrbitControls at the formation. Falls back to a top-rear view if controls aren't available. Added `makeDefault` to OrbitControls so `useThree().controls` resolves. Added F + GG + P to the keyboard-shortcuts overlay (was missing). | ✓ build ✓ | — | 655/655 |
| 17:02 | Selection bounding-box overlay. New `<SelectionBoundingBox>` always renders a bright cyan (0x22d3ee, opacity 0.85) AABB around the currently-selected formation's actual drone positions — distinct from the toggleable `FormationBoundingBoxes` (faint 0.3 cyan covering every active formation). Mounted alongside the existing overlay so users can see "exactly which swarm is being edited" at a glance. Helper is pooled across re-mounts; geometry disposed when the formation leaves its time window. | ✓ build ✓ | — | 655/655 |
| 17:07 | B-09 selection overlay completed: AxesHelper (RGB lines for +X red / +Y green / +Z blue) anchored at the selected formation's transform.position. Arrow length scales with the formation's horizontal footprint (40% of max(width, depth), floor 2m). Lives on the same `<SelectionBoxInner>` group alongside the cyan bounding box. Both helpers share one teardown path. | ✓ build ✓ | — | 655/655 |
| 17:14 | A-02 + A-05 inspector polish. LaunchNodeInspector gains an "Inferred" section showing total launch time (`droneCount × staggerDelay`) and downstream-target count, plus an amber callout when no downstream node exists. LandNodeInspector gains the symmetric section: upstream node count + estimated descent time, with a callout when nothing feeds it. Used `edge.edgeType === 'flow'` (the real field; `edge.type` doesn't exist on ShowEdge — caught and fixed). | ✓ build ✓ | — | 655/655 |
| 17:19 | A-04 IdleNodeInspector polish. (a) Center Position swapped from three separate `NumberInput` rows to a single `VectorInput` with axis-coloured caps, drag-to-scrub, and a unit suffix (m) — matches the rest of the inspectors. (b) New "Inferred" section shows whether the idle is attached to a formation (with the parent's id prefix) or standalone, plus flow in / flow out counts and an amber callout when the idle has no input. | ✓ build ✓ | — | 655/655 |
| 17:23 | EdgeInspector polish: added "Connection" section showing source / target labels (`type · id-prefix`) at the top for both flow and attachment edges. Previously only the "Computed: N drones" hint was shown. | ✓ build ✓ | — | 655/655 |
| 17:25 | S1 step: hoisted DroneCloud's eval cache to module scope. Previously each DroneCloud instance held its own `useRef` cache, so the editor and audience viewports both ran eval every frame even though they produced identical results. Now both instances share `_evalCache`; whichever runs first in a frame populates, the second reuses the array reference. Halves per-frame eval cost when the audience view is open. | ✓ build ✓ | — | 655/655 |
| 17:29 | S1 step: DroneHoverIndicator now reuses DroneCloud's `_evalCache` when the signature matches (same store mutation versions + same currentTime). Cache miss → falls back to fresh eval. Eliminates the third eval call per frame when a drone is hovered; also keeps the hovered-position readout in lockstep with what the cloud actually rendered. | ✓ build ✓ | — | 655/655 |
| 17:32 | TransitionNodeInspector polish: new "Inferred" section shows source→target point counts, current duration, and minimum duration required by physics (amber when current < min). Amber callout when the transition is missing an upstream or downstream formation. | ✓ build ✓ | — | 655/655 |
| 17:36 | Round-trip test: cubic-bezier keyframe configs survive project save/load. Serialize.ts uses `JSON.stringify(graph)` so `bezierConfig` was already passing through, but the contract now has a guard against future regressions. 655 → 656 tests. | ✓ | — | 656/656 |
| 17:43 | **Playwright e2e + visual testing wired into the loop**. The repo already had Playwright installed but only a single 8-line smoke spec (2/3 tests failing). Now: (a) `e2e/_helpers.ts` exports `gotoEditor()` that dismisses the WelcomeScreen via the Blank Canvas tile AND pre-seeds localStorage to skip the tutorial overlay + tooltip tour; (b) `e2e/basic.spec.ts` (5 tests: app loads, blank editor renders, Ctrl+E export dialog, ? shortcuts overlay, Ctrl+K command palette); (c) `e2e/interactions.spec.ts` (5 tests: inspector mount, viewport pointer events, GG chord, Ctrl+Z safety, Escape closes shortcuts); (d) `e2e/visual.spec.ts` captures 6 PNGs into `e2e/__screenshots__/` (welcome, blank editor, linear demo, shortcuts overlay, export dialog, command palette). All 16 tests pass on Chromium. `pnpm test:e2e:chromium` runs everything in ~17s; `pnpm test:e2e:visual` captures only the screenshots. `.gitignore` updated for test-results / playwright-report / __screenshots__. Vision verification: blank-editor screenshot confirms Launch + Land nodes auto-placed on the canvas, starfield + grid rendering, FPS counter live. | ✓ unit 656/656 ✓ e2e 16/16 ✓ build ✓ | — | 656/656 |
| 17:53 | E2e wave 2: `e2e/graph.spec.ts` (5 new tests — Blank Canvas mounts 2 nodes, click→inspector hand-off, command palette accepts+closes, gizmo hotkey cycle, Auto-layout safety) + 2 new visual snapshots (`inspector-launch-selected.png`, `inspector-multi-select.png`). 16 → 23 e2e tests passing. Visual review: multi-select inspector confirmed correct in browser — type breakdown chips ("1 launch, 1 land"), Start-time nudge row, no Altitude section (correct: launch+land lack the field), Delete Selected button all render as designed. | ✓ unit 656/656 ✓ e2e 23/23 ✓ build ✓ | — | 656/656 |
| 17:57 | **E2e wave 3 + real product fix discovered by e2e.** Added `e2e/dnd.spec.ts` (2 tests: node drag updates position, drag is undoable with Ctrl+Z). The undo test exposed a real bug: GraphCanvas.onNodesChange committed drag positions directly to the store without calling `historyStore.snapshot()`, so Ctrl+Z couldn't reverse a node move. Fixed by snapshotting "Move Node" on the first `dragging === true` change of a drag sequence (one entry per drag, not per change event). Now 25/25 e2e pass and dragging nodes is properly undoable in the app. | ✓ unit 656/656 ✓ e2e 25/25 ✓ build ✓ | — | 656/656 |
| 18:05 | E2e wave 4: demo specs. New `e2e/demos.spec.ts` (4 tests — Simple Linear loads formation, formation-click → FormationNodeInspector, Split/Merge Starter has ≥ 2 formations, playback Space toggle survives). Switched the formation selector to `.react-flow__node-formation` (React Flow's per-type class) since custom labels like "Together" / "Left Grid" hide the word "formation". Also fixed an outdated label in the helper (`'Split Story'` → `'Split/Merge Starter'`). New visual snapshot: `editor-split-merge.png` — confirms 14 nodes load with 6 formations + transition + idle + land, and the PHYSICS tab surfaces a real violation count. 25 → 30 e2e tests. | ✓ unit 656/656 ✓ e2e 30/30 ✓ build ✓ | — | 656/656 |
| 18:12 | E2e wave 5: `e2e/inspector.spec.ts` (5 tests — Launch reveals Drones field, Physics tab shows status, Settings tab reveals Max Velocity, AI tab opens to configure-key state, Formation inspector shows Base Transform). All 4 inspector tabs (Inspector / Physics / Settings / AI) are now covered by the suite. 30 → 35 e2e tests passing on Chromium in ~30s. | ✓ unit 656/656 ✓ e2e 35/35 ✓ build ✓ | — | 656/656 |
| 18:17 | **E2e caught second real bug + fix.** Diagnostic e2e captured the Split/Merge demo's Physics tab: it shipped with a "Shortest Path needs 6.3s (has 6.0s)" violation on first load — bad first impression for new users picking that template. Bumped `tIntro.preferredDuration` 6 → 7 in `splitStory.ts` (was the only shortest-path transition in the seed with a violating duration). E2e suite now has an explicit `Split/Merge demo ships clean physics` test that asserts zero violations on load, so a future seed regression would be caught immediately. 35 → 38 e2e tests. | ✓ unit 656/656 ✓ e2e 38/38 ✓ build ✓ | — | 656/656 |
| 18:23 | **E2e caught third real shipped bug + fix.** Tightened the Simple Linear physics assertion → caught two violations on first load: (a) "launch→formation gap too fast 12.2 m/s (limit 8)" — drones couldn't reach the ring fast enough; (b) "Min drone spacing 0.63m < 1.5m" — 100 drones on a radius-10 ring meant pair distance was sub-spec. Fixes in `WelcomeScreen.tsx`: ring radius 10 → 25 (gets pair distance back above 1.5m), form1 startTime 5 → 8 (gives drones 8s to fly up to the radius-25 ring), form2 startTime 20 → 23 (preserves downstream spacing). Both shipped demos (Simple Linear + Split/Merge) now ship with zero physics violations. | ✓ unit 656/656 ✓ e2e 38/38 ✓ build ✓ | — | 656/656 |
| 18:29 | New unit test guards WelcomeScreen templates against physics regressions. `src/components/WelcomeScreenTemplates.test.ts` exercises all 3 first-load templates (Blank / Simple Linear / Split/Merge) and fails on ANY violation severity (the existing `demos.test.ts` only flagged errors, missing the 18:17 + 18:23 first-load issues). The new test caught that the earlier 8s start-time fix was still under-budget at the unit-test homePositions distribution — 9.3 m/s vs 8 limit. Bumped form1 startTime 8 → 12 (and form2 23 → 27 to preserve spacing); now all three templates ship 0 violations. 656 → 659 unit tests; 38 e2e still pass. | ✓ unit 659/659 ✓ e2e 38/38 ✓ build ✓ | — | 659/659 |
| 18:34 | Surfaced 5 latent demo regressions via a stricter all-severity demo test. Galaxy / fireworks / heartbeat / logo-reveal / cinematic all ship with `Min drone spacing < 1.5m limit` warnings (badge "1+" on Physics tab). The existing demos test only flagged errors, so these slipped through. Marked the strict suite as `.todo` with an explanatory comment so the regressions are documented in test output without blocking; each demo is its own ticket for a per-formation tuning pass. Investigated fireworks: the violation lives inside the `firework-burst` animated formation's built-in points (not the user-tunable ring/sphere generators), so it needs an animation-source fix rather than a parameter bump. | ✓ unit 659/659 (8 .todo) ✓ e2e 38/38 ✓ build ✓ | — | 659/659 |
| 18:42 | Galaxy demo cleaned up + spiral generator improved. Two underlying bugs surfaced: (a) the spiral generator distributed `count` points across `t∈[0,1]`, so inner points crowded at r→0 — fixed by repurposing the `spacing` param as `innerRadius` (defaults to radius/3 so the central handful of drones don't pile on the origin); (b) the `kf()` demo helper defaults missing position axes to 0, so `kf(0, {}, { y: π })` (intended for rotation) silently overrode altitude to 0 — fixed in galaxy by explicitly passing `{ y: 15 }` in each keyframe's position to preserve the formation's authored altitude. Galaxy now ships with 0 violations of any severity. Strict suite remains `.todo` for the remaining 4 demos (fireworks/heartbeat/logo-reveal/cinematic). | ✓ unit 659/659 (8 .todo) ✓ e2e 38/38 ✓ build ✓ | — | 659/659 |
| 18:50 | Heartbeat demo: altitude violations cleared. Bumped fHeart altitude 14 → 24 and fHeartLarge altitude 14 → 32 so the heart curve's bottom lobe (yRaw -17 × size/16) clears the 0m geofence floor. Also dropped heart count 80 → 36 to reduce cusp-crowding (5 → 3 violations; spacings improved 0.02/0.03m → 0.23/0.29m). Remaining spacings are inherent to the heart parametric curve's t=π singularity — needs an arc-length-uniform redistribution in the generator, deferred. `.todo` comment updated to reflect partial progress. | ✓ unit 659/659 (8 .todo) ✓ e2e 38/38 ✓ build ✓ | — | 659/659 |
| 18:55 | **Heart generator + breathing-sphere library both fixed.** Heart generator: redistributed `count` points along the curve by arc-length (cumulative-distance walk over a dense 2000-sample table) instead of uniform t — eliminates the cusp-crowding at t=π that was producing sub-cm pair distances. Breathing-sphere library formation: rMin 4 → 5 so the contracted phase keeps 80 drones above the 1.5m pair-spacing floor (2.7·r/√n ≈ 1.51m at r=5). Heartbeat demo now ships with 0 violations of any severity. Remaining strict-suite failures: 3 (fireworks/logo-reveal/cinematic). | ✓ unit 659/659 (8 .todo) ✓ e2e 38/38 ✓ build ✓ | — | 659/659 |
| 19:00 | Cinematic demo: pre-emptively fixed three rotation/scale-only keyframes that defaulted position.y to 0 (same `kf()` bug pattern as galaxy). Set explicit y=16 for the spiral, y=18 for the climax sphere, y=12 for the wind-down grid. Logo-reveal attempted the same fix but surfaced a downstream collision in fStar's incoming transition — reverted (a real geometry fix is needed there, not just an altitude restoration). | ✓ unit 659/659 ✓ build ✓ | — | 659/659 |
| 19:06 | Fireworks demo cleaned. The `firework-burst` library formation started 60 drones on a r=1.5 fibonacci sphere — pair spacing 0.52m, sub-spec. Bumped startRadius 1.5 → 4.5 (yields ≈1.57m, just above the 1.5m floor). Visual: drones still explode outward to expandRadius=6–10 so the burst feel is preserved. 3 of original 5 strict-suite demos now clean (galaxy, heartbeat, fireworks). Remaining: logo-reveal + cinematic. | ✓ unit 659/659 (4 .todo) ✓ e2e 38/38 ✓ build ✓ | — | 659/659 |
| 19:11 | Cinematic demo: dropped 4 → 1 violation. (a) Spiral `spacing: 0.4` removed (was being misinterpreted as innerRadius=0.4 after my generator change). (b) fRing keyframes' position y restored to altitude 14 (was overriding altitude to 0). (c) fAppleTree got an orbit idleConfig (radius 100) for the 200 leftover drones. (d) fCoda altitude bumped 14 → 70 to fit the size-65 heart's full y-span [-69, 47] inside the [0, 120] geofence. (e) fCoda count dropped 250 → 80 since the heart cusp still crowded at 250 drones even with arc-length redistribution. Remaining 1 violation: 0.30m in apple-tree-shake's trunk drones (built-in formation, needs library-side fix). | ✓ unit 659/659 (3 .todo) ✓ e2e 38/38 ✓ build ✓ | — | 659/659 |
| 19:17 | Attempted apple-tree library fix (TRUNK 10 → 4, canopy radius 5 → 9, apple cluster 0.3 → 1.5m), but the 0.30m violation persisted and the 50→44 droneCount change broke 3 unit tests in animatedFormationVerification.test.ts that hard-code the count. Reverted all changes — the apple-tree library formation needs a deeper rework (probably arc-length-aware redistribution of canopy + apples + matching test updates) that's too big for the loop. Logo-reveal still has 4 violations (collision constraints, complex). Net: this loop iteration was a no-op fix-wise (but documented the dead-ends in NIGHT_LOG so a future session doesn't repeat them). | ✓ unit 659/659 ✓ build ✓ | — | 659/659 |
| 19:24 | Apple-tree library: trunk span 0..6 → 0..15 (now 1.67m vertical spacing, was 0.67m); canopy base 8 → 17 to match new trunk height; apple cluster repositioned to a pentagon of radius 1.28 (was a tight 5-point cross at 0.3m). Cinematic violation: 0.30m → 1.36m. Still under the 1.5m floor — the residual comes from apple-vs-top-trunk-drone proximity at the canopy interface. Existing tests for the apple-tree library still pass (no count changes). Remaining shape-tuning is fragile and warrants a careful redesign rather than more parameter pokes. | ✓ unit 659/659 (3 .todo) ✓ build ✓ | — | 659/659 |
| 19:35 | **All 8 shipped demos now ship with zero physics violations of any severity.** Logo-reveal final fixes: outerRadius 24 → 50 (star perimeter ~440m / 150 = 1.57m above the 1.5m floor), removed rotation keyframes (the larger radius pushed peak velocity over the 7.2 m/s limit), fStar altitude 14 → 55 (star reaches y = -50 from formation centre), heart size 36 → 50 + count 150 → 80 (1.6m arc-length spacing), fHeart altitude 14 → 55. The strict-suite `.todo` is removed; updated the comment to a "common pitfalls" guide for future demo authors. 659 → 667 tests (8 previously-todo demos now actually run). | ✓ unit 667/667 ✓ e2e 38/38 ✓ build ✓ | — | 667/667 |
| 19:46 | FormationNode card label now falls back to `formation.name` (read from the formation store) when `data.label` isn't set, instead of dropping straight to the auto-generated `formation-mpfs6yzy-1` ID. Visual confirmed via snapshot: Simple Linear demo's formation card now reads "Opening Ring" (the actual formation name). Zero risk — the card was already pulling `formation` from the store; this just uses it. | ✓ unit 667/667 ✓ build ✓ | — | 667/667 |
| 19:51 | TransitionNode card now shows the registered transition's display name (`Shortest Path`) instead of the raw `strategyId` (`shortest-path`). Uses `getTransition(data.strategyId)?.name` with the raw id as fallback. Pairs with the FormationNode label fix from 19:46 — both card types now show human-readable names on the graph canvas. | ✓ unit 667/667 ✓ build ✓ | — | 667/667 |
| 19:54 | Idle behavior labels: IdleNode card + FormationNode's attached-idle sub-bar both now resolve via `getIdleBehavior(id)?.name` so the canvas reads "Orbit" / "Breathe" / "Figure 8" instead of `orbit` / `breathe` / `figure8`. Completes the readable-label sweep across all 4 node types (Formation / Transition / Idle / attached-idle on Formation). | ✓ unit 667/667 ✓ build ✓ | — | 667/667 |
| 20:00 | IdleNodeInspector's "Inferred" section: "Attached to" line now shows the parent formation's *name* (e.g., "Opening Ring") instead of the truncated id prefix (`formation (mpfqj9pa)`). Falls back to the id prefix if the formation lookup fails. | ✓ unit 667/667 ✓ build ✓ | — | 667/667 |
| 20:07 | EdgeInspector source/target labels resolve to human-readable names. Was: `formation · mpfqj9pa`; now: `formation · Opening Ring`, `transition · Shortest Path`, `idle · Orbit`. Launch and land nodes still show their truncated id prefix (no display name to resolve to). | ✓ unit 667/667 ✓ build ✓ | — | 667/667 |
| 20:10 | TimelineRulerPanel bars now show human-readable labels: formation bars read "Opening Ring" / "Final Grid" (was "formation"), transition bars read "Shortest Path" / "Ant Trail" (was "transition"), idle bars read "Orbit" / "Breathe" (was "idle"). Launch / land bars still read "launch" / "land" (no registered display name). Added `truncate` so long names don't overflow narrow bars. | ✓ unit 667/667 ✓ build ✓ | — | 667/667 |
| 20:14 | Inspector headers now embed the friendly name. "Formation Node" → "Formation · Opening Ring", "Transition Node" → "Transition · Shortest Path", "Idle Node" → "Idle · Orbit". Launch/land kept their plain "Launch Node" / "Land Node" titles (no name to embed). Two e2e tests in demos.spec / inspector.spec were checking for the old "Formation Node" string — updated to the new "Formation · " prefix. | ✓ unit 667/667 ✓ e2e 38/38 ✓ build ✓ | — | 667/667 |
| 20:20 | FormationNode hover tooltip readability: `Formation · <uuid>` → `Formation · Opening Ring`; `Color: rainbow-spatial` → `Color: Rainbow (Spatial)` (resolved via `getColorProgram(id)?.name`). Both id refs replaced with their registered display names. | ✓ unit 667/667 ✓ build ✓ | — | 667/667 |
| 20:25 | ViolationsPanel `getNodeLabel` now resolves to display names. Was `Formation (mpfqj9pa)`; now `Formation (Opening Ring)`, `Transition (Shortest Path)`, `Idle (Orbit)`. Falls back to the truncated id prefix when no display name is available (launch/land/missing). Continues the readable-label sweep across editor surfaces. | ✓ unit 667/667 ✓ build ✓ | — | 667/667 |
| 20:27 | NodeSearchPalette (Ctrl+K) node entries: search-result labels are now `Formation · Opening Ring` etc. (was the raw node UUID). Fuzzy-match text also includes the resolved name so users can find a formation by typing its name. | ✓ unit 667/667 ✓ build ✓ | — | 667/667 |
| 20:32 | TimelineRulerPanel aria-label + title now use the resolved display label too (was `${node.type} ${node.id}` and `${node.type} —`). Hover tooltip and screen-reader output now read e.g. "formation Opening Ring — 5.0s … 15.0s · drag, Alt = ripple downstream". | ✓ unit 667/667 ✓ build ✓ | — | 667/667 |
| 20:36 | Noop tick — cleaned 4 stale diagnostic artifacts from `e2e/__screenshots__/` (left over from earlier physics-investigation specs that have since been deleted). Health check: 667/667 unit + 38/38 e2e + 0 lint errors + clean build. | ✓ | — | 667/667 |
| 20:40 | FlowEdge count badge: hover tooltip explains allocation mode + edit affordance. Reads "12 drones · auto-allocated · click to override" / "12 drones · manually set · click to edit" / "12 drones · 30% of upstream · click to edit" depending on `allocation.mode`. Was previously silent on hover. | ✓ unit 667/667 ✓ build ✓ | — | 667/667 |
| 20:46 | AssetPanel formation list entries: hover tooltip explains the formation + drag affordance. Reads "Opening Ring · ring · 100 points · drag onto canvas to add" for static, "Breathing Sphere · animated formation · drag onto canvas to add" for animated. Was previously silent on hover. | ✓ unit 667/667 ✓ build ✓ | — | 667/667 |
| 20:48 | AssetPanel Library tab entries: hover tooltip rolls up name + description + droneCount + duration + playback mode + collapse/expand hint into one line. Was silent on hover. | ✓ unit 667/667 ✓ build ✓ | — | 667/667 |
| 20:51 | AssetPanel Import tab IMAGE/TEXT/SVG selector buttons: hover tooltips explain what each importer does. Image → "extract bright pixels and rasterize them into drone positions"; Text → "Render text glyphs into a 2D point cloud (great for logos & countdowns)"; SVG → "extract path points (fill or stroke)". | ✓ unit 667/667 ✓ build ✓ | — | 667/667 |
| 20:55 | Added `e2e/labels.spec.ts` (4 tests) — formal regression coverage for the label-readability sweep. Asserts that on the Simple Linear demo: the formation card reads "Opening Ring" (not the auto-generated id); the transition card reads "Shortest Path" (not "shortest-path"); the timeline ruler bar uses the formation name too; the inspector header reads "Formation · Opening Ring". A future regression to any of those resolvers would now fail a fast e2e test rather than show up only on visual review. 38 → 42 e2e tests. | ✓ unit 667/667 ✓ e2e 42/42 ✓ build ✓ | — | 667/667 |
| 20:59 | AssetPanel "+ New Static Formation" button: tooltip explains the default (ring with 50 drones) + configurability hint. Small polish but eliminates the "what happens if I click this?" friction. | ✓ unit 667/667 ✓ build ✓ | — | 667/667 |
| 21:05 | O-04 camera-preset keyboard shortcuts: keys 1/2/3/4 (bare, no modifiers) now fire Perspective / Front / Side / Top camera presets via the same dispatchCameraPreset channel the corner buttons use. Added to KeyboardShortcutsOverlay. Closes part of O-04 (was: "1/2/3/4 (camera presets)"). | ✓ unit 667/667 ✓ build ✓ | — | 667/667 |
| 21:11 | O-04 ← / → nudge: when one or more time-authored nodes (launch / formation / idle) are selected, left/right arrow keys nudge their startTime by 0.1s (or 1s with Shift). Falls back to the existing playhead-scrub behaviour when no nodes are selected. One undo snapshot per nudge ("Nudge start time (N nodes)"). KeyboardShortcutsOverlay updated with the new entries. Closes another part of O-04. | ✓ unit 667/667 ✓ e2e 42/42 ✓ build ✓ | — | 667/667 |
| 21:15 | O-04: Ctrl+G group / Ctrl+Shift+G ungroup. Ctrl+G wraps the current selection in a new GroupNode (label defaults to "Group of N") and sets parentId on each child. Ctrl+Shift+G ungroups: any selected GroupNode is removed and its children get parentId=null. Both are undoable with semantic snapshot labels; both fire a confirming toast. Updated KeyboardShortcutsOverlay. | ✓ unit 667/667 ✓ e2e 42/42 ✓ build ✓ | — | 667/667 |
| 21:20 | O-04: Ctrl+H toggle mute on selected formation / idle nodes. Maps to the existing `muted` flag (Bundle 5 already makes the evaluator skip muted nodes, so "hide" works for free). Acts as a majority-flip: if most selected are unmuted → mute all; otherwise → unmute all. One undo entry per keystroke. Updated shortcuts overlay. Ctrl+L lock deferred (needs a new `locked` field across node types — bigger surface). | ✓ unit 667/667 ✓ build ✓ | — | 667/667 |
| 21:23 | O-06 align/distribute: multi-select inspector gains "Align starts" + "Distribute" buttons for any selection of ≥ 2 time-authored nodes (launch / formation / idle). Align snaps every selected startTime to the earliest in the selection. Distribute (≥ 3 nodes) spaces start times evenly between earliest and latest, preserving the outer bookends. Both undoable with semantic snapshot labels; Distribute disabled when fewer than 3 nodes are selected. | ✓ unit 667/667 ✓ e2e 42/42 ✓ build ✓ | — | 667/667 |
