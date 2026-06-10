# Bleeding — Phase 0

Three on-screen defects (one with a sub-item). The lift cannot land on a foundation that hides itself. Nothing in Phase 1+ ships before this set.

---

## B1 — Live preview is silently stale

**Status:** done (2026-05-21)
**Effort:** S (10 min minimum; half day proper)
**Depends on:** —
**Affects:** [src/components/viewport/Viewport3D.tsx](src/components/viewport/Viewport3D.tsx), [src/stores/graphStore.ts](src/stores/graphStore.ts)

### Current

`DroneCloud.useFrame` at [src/components/viewport/Viewport3D.tsx:79](src/components/viewport/Viewport3D.tsx#L79) caches eval results keyed on `${nodes.length}-${edges.length}-${currentTime.toFixed(3)}`. `updateNodeData` mutates `node.data` in place — the hash doesn't change. So every gizmo drag, every inspector edit, every color/transform/idle param change is invisible until the user scrubs the timeline. Comment labels it "S22-05: Evaluation caching."

### Figma-perfect

- Every edit is visible on the next animation frame, with no perceptible lag.
- No invalidation hash gymnastics; the eval pipeline is a derived subscription.
- Editor viewport and audience viewport share one evaluation result per frame (no double work).

### Implementation

Two options:

- **Quick:** delete the cache. `evaluateAtTime` is designed to run sub-16ms — the cache traded correctness for nothing.
- **Right:** introduce a `graphMutationCounter` in the store, bumped on every `set`. Cache by counter + currentTime + droneCount. Or hoist eval out of `useFrame` into a derived store signal both viewports read.

### Notes

This is also exhibit A for P1 (reactivity) and P9 (WYSIWYG). Fix should be the **first** thing landed tonight. Almost every other ticket assumes the fix is in.

---

## B2 — Audience View crash + opaque ErrorBoundary

**Status:** done (2026-05-21) — diagnostics + defensive guards landed. Root-cause investigation deferred to S1 (derived signal eval).
**Effort:** S (15 min diagnostic) + M (defensive guards; 0.5d) + L (root cause: 1d)
**Depends on:** B1 (since the crash sites overlap with the cache code path)
**Affects:** [src/app/App.tsx](src/app/App.tsx), [src/components/viewport/Viewport3D.tsx](src/components/viewport/Viewport3D.tsx), [src/components/ErrorBoundary.tsx](src/components/ErrorBoundary.tsx), [src/stores/graphStore.ts](src/stores/graphStore.ts)

### Current

Opening the audience viewport sometimes throws `Cannot read properties of undefined (reading 'length')`, caught by `<ErrorBoundary panelName="Audience View">`. The boundary doesn't log the stack so you can't tell which `.length` access blew up.

### Figma-perfect

- The audience viewport mounts on every store state without crashing.
- The ErrorBoundary logs the error + componentStack to a dev panel.
- A toast surfaces, with action: "Reload audience view" + "Copy stack."

### Implementation

1. ErrorBoundary `componentDidCatch` adds `console.error(error, info.componentStack)`. (15 min)
2. Guard `.length` accesses in Viewport3D.tsx + nodeEvaluators.ts with `?? 0`. (0.5d)
3. Root cause: store invariants — `nodes` and `edges` should always be `[]`, never undefined. Check store hydration order vs audience-Canvas mount timing.

---

## B3 — Idle behaviors discard `homePos`, collapse formations

**Status:** done (2026-05-21) — see NIGHT_LOG.md for the full story. Behaviors now use a spacing-aware multi-ring stack with per-behavior modulation. 9 new spacing-preservation tests added.
**Effort:** L (2–3d)
**Depends on:** B1 (so we can actually see the fix working)
**Affects:** [src/registries/idleBehaviors.ts](src/registries/idleBehaviors.ts), [src/graph/nodeEvaluators.ts](src/graph/nodeEvaluators.ts), [src/registries/idleBehaviors.test.ts](src/registries/idleBehaviors.test.ts), [src/graph/physicsValidator.ts](src/graph/physicsValidator.ts)

### Current

The `getPosition(droneIndex, totalDrones, time, params, homePos)` API for 9 of 10 idle behaviors discards `homePos` and synthesizes ring positions from `(droneIndex / totalDrones) * 2π`. Attach `orbit` to a 500-drone sphere → drones collapse to a flat ring at radius 5m → 6cm pair spacing → catastrophic overlap.

The exception is `hover`, which uses `homePos` correctly.

`clampToConstraints` derivations for affected behaviors use the *current* (broken) trajectory math, so all velocity coefficients need re-derivation.

### Figma-perfect

- Each non-hover behavior anchors on `homePos` and applies a *modulation* — the formation shape is preserved, the behavior is layered on top.
- Pairwise drone spacing never drops below the project's pair-spacing minimum during any idle.
- Each behavior has a one-line description of what motion it adds to home position ("small orbit around home", "vertical wave across formation", etc.).
- The idle inspector renders a live 3D preview (L1) showing the modulation on a representative formation.

### Behavior-by-behavior target

- **orbit:** `home + (Math.cos(angle), 0, Math.sin(angle)) * radius` where `angle = time * speed + droneIndex * 0.05` (small per-drone phase offset so all drones aren't synchronized).
- **figure8:** `home + lemniscate(angle) * radius` — small figure-8 around home.
- **breathe:** `home + (home - center) * (1 + 0.1 * sin(t*speed))` — radial breathing of the formation outward from its centroid. *(needs the formation centroid to be computed; cheap.)*
- **swarm:** `home + perDroneNoiseVector(droneIndex, time)` — formation shimmers in place.
- **sparkle:** `home + small radial flicker + vertical bob`.
- **pulse:** `home + (home - center) * pulseScale + (0, sin(...)*vy, 0)`.
- **wave:** `home + (0, sin(t*speed + home.x*k + home.z*k), 0) * amp` — vertical wave across the formation.
- **spin:** `home rotated around center by (t*speed)` — rotates the whole formation rigidly.
- **drift:** `home + (driftX*t, 0, driftZ*t)` — formation drifts together.

### Tests

Add a `formationShapePreservation.test.ts` that asserts: for representative source formations (ring, sphere, line, heart), after running each idle behavior for T=0..4s, **min pair distance never drops below `minPairSpacing` of the constraints**.

### Notes

This pairs naturally with B3a (same code region).

---

## B3a — 0.5m leftover-grid fallback

**Status:** done (2026-05-21) — both copy-paste sites in nodeEvaluators.ts replaced with hover-above-home fallback.
**Effort:** S
**Depends on:** B3 (lands in same PR)
**Affects:** [src/graph/nodeEvaluators.ts](src/graph/nodeEvaluators.ts)

### Current

When a formation has more incoming drones than points and no idle behavior is configured, leftovers spawn into a 10-wide grid at 0.5m spacing — well below default pair spacing. [nodeEvaluators.ts:240](src/graph/nodeEvaluators.ts#L240) and [:356](src/graph/nodeEvaluators.ts#L356) (same magic-number block, copy-pasted).

### Figma-perfect

- Without an idle config, leftovers default to a high hover above their own home position (no overlap with formation drones).
- A linter/validation warning surfaces ("Formation has N leftover drones without an idle behavior — using hover fallback").

### Implementation

Replace the grid block with `state.position = { ...ctx.homePositions[di], y: animTransform.position.y + 5 }` or similar. Add validation warning at validate-time so the user knows.
