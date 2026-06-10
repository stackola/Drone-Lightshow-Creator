# G-03: Preview vs Bake Contract

## Live Preview (`evaluateAtTime`)

- Runs on main thread, must return in <16ms for 60fps scrubbing
- Allowed approximations: no collision avoidance, no velocity limiting, simplified launch/land stagger, skip acceleration constraints
- Uses greedy point matching for transitions (not optimal assignment)
- Produces `DroneState[]` — positions + colors, no trajectory history
- Is NOT deterministic across different graph states (reordering nodes may change preview)

## Bake (`runBake`)

- Runs async (may use setTimeout yields), takes seconds for large shows
- Deterministic: same graph + formations + constraints → same result, always
- Full constraint enforcement: velocity limiting, collision detection, altitude/geofence checks
- Uses optimal assignment (greedy or Hungarian depending on size)
- Produces `BakeResult` with full per-drone trajectories at solver timestep
- Is the export truth — only baked trajectories leave the editor

## Divergence Rules

- Preview and bake may show visually different results. This is expected and acceptable.
- Preview must never be worse than "roughly correct shapes in roughly the right places at roughly the right times"
- If preview and bake diverge by more than 2× drone spacing at any point, that is a bug worth investigating
- The editor must make it visually clear when the user is viewing live preview vs baked result (different opacity, badge, or outline)
