# Active ticket queue

This file is the resumable to-do list. If a future Claude Code session needs to pick up where this one left off, read [NIGHT_LOG.md](NIGHT_LOG.md) first, then start the highest-priority item below.

**Each loop iteration must start by reading this file + the [tickets/](tickets/) folder.** Do not work on speculative polish before confirming there's no ticketed work that needs doing.

**Last update:** 2026-05-22 ~10:44 UTC. Unit tests 765/765 pass. Playwright e2e 42/42 pass on Chromium. typecheck + build clean.

## What's still pending (highest priority first)

### Big tickets

- **S1 full** — derived-signal eval pipeline. Mutation-counter cache is in place + shared between editor and audience canvases; eval now runs once per frame across viewports. Remaining: hoist into a true Zustand-derived selector so React subscribers can avoid useFrame entirely. Multi-day.
- **S4 step 12** — real Bézier handles per keyframe (drag in/out tangents on the curve canvas). The cubic-bezier easing now lives in the EasingSelect popover (see shipped); this is the in-canvas tangent-drag version. Multi-day.
- **Standalone/'s fate** — extract `@drones/core` package or deprecate. Needs user decision before any work starts.

### Medium tickets

- **L4 ColorInput adoption** — `inputs/ColorInput.tsx` exists; adopt it at the inline-swatch sites that still use a raw `<input type="color">` (not in `ColorProgramEditor` — the existing `HexColorPicker` there is better UX).
- **Demo coverage gap** — `apple-tree-shake` library formation already tuned (droneCount 50, canopy radius 9 → 1.52 m sunflower spacing, apple cluster radius 1.28, trunk 10 drones over 15 m). All 8 shipped demos ship zero violations including cinematic which uses apple-tree. Further arc-length redistribution would be a polish nicety, not a fix; deferred.
- **O-04 keyboard shortcuts** — mostly done (camera 1/2/3/4, GG, P, F, W/E/R, Ctrl+G/Shift+G group/ungroup, Ctrl+H mute, Ctrl+L lock with full coverage: field + keyboard + FormationGizmo + MultiSelectGizmo + all 5 L2 handles + inspector body gated via `pointer-events-none opacity-60` + LockedBanner with one-click unlock + lock icon on Formation/Idle/Transition cards; shift+arrow nudge). Still pending: A→… align-mode keyboard prefix sequences.
- **O-06 multi-select** — partial (type breakdown chip + Start-time/Altitude nudge rows + Align/Distribute starts in inspector; combined amber bounding box in 3D viewport across selected formations; **amber centroid translate gizmo** that drags all selected formations by a shared delta, respecting per-formation keyframe vs base-transform routing). Still pending: rotate/scale around centroid (translate-only ships now; rotate/scale around a moving anchor is a separate design decision), mixed-value indicators in single-select inputs (L4), selection survives panel resize.

### Smaller / lower priority

- **Sphere generator magic numbers** — currently uses goldenRatio inline. Already self-documenting; deferred.
- **Design-token migration** — backgrounds + text + borders done app-wide. Remaining 2 slate refs (`GroupNode text-slate-900` for dark-text-on-light contrast; `TimelineRulerPanel` default fallback consistent with palette-based peers) are intentional, not pre-token leftovers. Effectively complete.
- **Sphere generator arc-length redistribution** — would help fireworks demo's collapse sphere edge cases; deferred since the demo passes now.

## Recently shipped (newest first)

- **Readable-label sweep** (20:14–20:46): formation/transition/idle node cards, timeline ruler bars, inspector headers, edge-inspector source/target, violations panel, NodeSearchPalette, FlowEdge count badge, AssetPanel library + import-type buttons, "+ New Static Formation" button — all resolve to display names + descriptive tooltips. Plus `e2e/labels.spec.ts` (4 regression tests). E2e: 30 → 42 tests.
- **All 8 demos ship zero physics violations** (18:17–19:35): tightened simple-linear + split/merge (welcome templates) and the registry demos (galaxy, fireworks, heartbeat, cinematic, logo-reveal) via per-demo + generator-side fixes. Arc-length redistribution in the heart generator; spiral `spacing` repurposed as `innerRadius`; breathing-sphere rMin bump; firework-burst startRadius bump; apple-tree canopy radius bump.
- **S1 partial** — DroneCloud + DroneHoverIndicator share `_evalCache` (module-level), halving per-frame eval work when audience viewport is open.
- **B-09** — selection bounding-box + RGB local axes overlay on the selected formation.
- **F key** — frame-selection in 3D viewport.
- **Multi-select inspector** — type-chip breakdown + Start-time / Altitude nudge rows + Delete Selected, all undoable.
- **Drag-and-drop** — node drag now snapshots history (was a no-op for undo before).
- **Bundle split** — 6 vendor chunks, main 1.8MB → 490KB.
- **aiWriteTools split** — 1066-LOC god module → 19-LOC barrel + 6 domain modules.
- **All 5 L2 handle primitives** + 5 adoption wrappers.
- **L4 NumberInput / VectorInput / ColorInput / RegistrySelect / EasingSelect** with cubic-bezier popover.
- **L1 RegistryItemPreview** adopted in 5 sites.
- **L3 AI tool body slots** for ~46 of ~49 tools.
- **L5 systems pass** complete.
- **B1 / B2 / B3 / B3a** bleeding fixes.
- **Playwright e2e infra** + 42 tests + 9 visual snapshots.

## Verification commands

```bash
pnpm typecheck                                  # tsc --noEmit
pnpm test                                       # vitest (50 files, 667 tests)
npx playwright test --project=chromium          # e2e (42 tests on Chromium)
pnpm build                                      # vite build
pnpm dev                                        # browser preview
```

If the postprocessing crash recurs: `rm -rf node_modules/.vite/` and restart `pnpm dev`. The package is pinned at 2.19.1 in `package.json` + `pnpm-lock.yaml`.

## How to resume autonomously

The session uses `ScheduleWakeup` with a 60s cadence and the `<<autonomous-loop-dynamic>>` sentinel. On each wake:

1. **Read this file + [tickets/INDEX.md](tickets/INDEX.md) first.** Pick from the pending list above before doing speculative polish.
2. Do the work; run `pnpm typecheck && pnpm test`; fix any break before continuing.
3. Append the change to `NIGHT_LOG.md`.
4. Update or remove items in this file.
5. `ScheduleWakeup` 60s for the next iteration.

When the conversation runs out of context, the next fresh Claude session can read this file + `NIGHT_LOG.md` + `tickets/` to continue.
