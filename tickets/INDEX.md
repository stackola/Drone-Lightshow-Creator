# Tickets Index

This directory expands the [Figma-tier lift plan](/home/stackola/.claude/plans/we-have-built-many-atomic-penguin.md) into actionable tickets, one section per ticket, grouped into category files.

## Conventions

Each ticket has:
- **ID** (e.g. `B1`, `L5-toast`, `G-01-ring`) — stable across files.
- **Status** — `todo` / `in-progress` / `done` / `blocked`. Updated as work lands.
- **Effort** — S (≤0.5d) / M (0.5–2d) / L (2–5d) / XL (5–15d) / XXL (>15d).
- **Depends on** — other ticket IDs that must land first (or that materially reduce this ticket's effort once they're in).
- **Affects** — file paths the work touches.
- **Current** — one-paragraph snapshot.
- **Figma-perfect** — the target behavior, as concrete behavior points.
- **Notes** — anything I want to remember when picking this up.

## Files

### Phase 0 — Bleeding

- [bleeding.md](bleeding.md) — B1 silent-stale viewport, B2 audience crash, B3 idle behaviors, B3a leftover grid.

### Phase 1 — Leverage

- [leverage.md](leverage.md) — L1 live previews, L2 3D handles, L3 AI tool cards, L4 crafted inputs, L5 systems pass.

### Phase 1–2 — Per-surface roadmap

- [surfaces.md](surfaces.md) — S1 engine, S2 viewport, S3 inspector, S4 keyframes, S5 graph canvas, S6 color programs, S7 AI chat, S8 transitions/idle, S9 export, S10 system-wide hygiene.

### Appendix — Per-feature catalog

- [appendix-A-graph-canvas.md](appendix-A-graph-canvas.md) — 17 tickets
- [appendix-B-3d-viewport.md](appendix-B-3d-viewport.md) — 11 tickets
- [appendix-C-inspector-shared.md](appendix-C-inspector-shared.md) — 6 tickets
- [appendix-D-inspector-formation.md](appendix-D-inspector-formation.md) — 8 tickets
- [appendix-E-inspector-edge.md](appendix-E-inspector-edge.md) — 2 tickets
- [appendix-F-transport.md](appendix-F-transport.md) — 2 tickets
- [appendix-G-generators.md](appendix-G-generators.md) — 7 tickets
- [appendix-H-animated.md](appendix-H-animated.md) — 3 tickets
- [appendix-I-transitions.md](appendix-I-transitions.md) — 8 tickets
- [appendix-J-idle.md](appendix-J-idle.md) — 10 tickets (all depend on B3)
- [appendix-K-color-programs.md](appendix-K-color-programs.md) — 6 tickets
- [appendix-L-ai-write.md](appendix-L-ai-write.md) — ~31 tickets (all benefit from L3)
- [appendix-M-ai-read.md](appendix-M-ai-read.md) — ~8 categories of read tools
- [appendix-N-dialogs.md](appendix-N-dialogs.md) — 7 dialogs + onboarding
- [appendix-O-system-wide.md](appendix-O-system-wide.md) — 17 cross-cutting concerns

### Operating principles (not actionable on their own, but referenced by tickets)

- [principles.md](principles.md) — P1 reactivity, P2 direct manipulation, P3 crafted inputs, P4 motion design, P5 keyboard-first, P6 first-class errors, P7 visual hierarchy, P8 invisible performance, P9 WYSIWYG, P10 designed empty/loading/error states.

## Sequencing summary

1. **Bleeding first** (`bleeding.md`) — non-negotiable. Nothing else ships until.
2. **L5 systems pass** — small per-item, biggest cross-cutting impact.
3. **L4 crafted inputs** — every inspector benefits the day this lands.
4. **L1 + S1** in parallel — preview component + engine reactivity fix.
5. **L2 3D handles** then **S2** viewport surface.
6. **L3 AI cards** then **S7** AI chat surface.
7. **S4** keyframes, **S5** graph canvas, **S8** transitions+idle.
8. **S6, S9, S10** closing the loop.

## Status snapshot — end of night session (2026-05-21 ~03:05)

- **bleeding: 4 / 4 done** — B1 (live preview), B2 (audience boundary), B3 (idle behaviors), B3a (leftover grid).
- **leverage: ~3 / 5 done** — L5 fully landed (toast, undo labels + grouping, tokens, tooltips, cmd palette, copy/paste). L4 partial (NumberInput only). L1 component + 2 adoption sites. L2 not started. L3 base card + 6 per-tool body slots.
- **surfaces: 0 / 10 fully done** — but L5 + L1 + L3 work touched parts of S3/S5/S7/S9/S10. The full S1–S10 marquee work remains.
- **appendix items remaining**: most are unstarted. The leverage projects collectively dent maybe 25–30 appendix tickets indirectly (e.g. every J-* idle behavior now has the spacing-safe substrate; every K-* color program has L1 preview ready to adopt).

See NIGHT_LOG.md for the full per-ticket breakdown and the Deferred section for what's next-up.
