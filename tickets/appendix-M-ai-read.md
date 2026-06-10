# Appendix M — AI read tools (~16)

Read tools today return raw JSON. Each becomes an L3 card with a structured view.

---

## M-01 get_show_summary

Metrics card (drones / nodes / duration / violations) in large type; color badges (green/yellow/red); formation chip list; "open details" link. Effort: S.

## M-02 get_graph / get_node / get_timing

Tabbed view: Graph (node + edge list with search), Node (selected details), Timing (Gantt chart). Hover highlights node on canvas. Copy JSON button. Expand/collapse details. Effort: S.

## M-03 get_formations + get_formation_points

Thumbnail grid using L1; click for 3D scatter plot of points; stats (min/max altitude, bbox, spacing distribution); export CSV. Effort: S.

## M-04 get_violations

Violation list panel sorted by severity; each shows node, message, detail, auto-fix suggestion; per-violation "fix this" button; group by type; highlight affected node on canvas; one-click "fix all" shortcut. **Effort: M**.

## M-05 get_constraints + get_drone_pool

Settings card with inline L4 sliders; visual limit bands on timeline; constraint dial layout; "edit" button auto-revalidates. Effort: S.

## M-06 evaluate_at_time

Scrubber timeline; drag any time → viewport updates live; drone list shows first 10 expandable; color swatches; stats (centroid, bbox, velocity distribution); 3D points in background; CSV snapshot export. **Effort: M**.

## M-07 get_available_* (generators / transitions / idle / color programs)

Icon grid with L1 previews; hover for description; click to assign (context-aware); search filter; favorite/pin frequently-used to top. Effort: S each.

## M-08 critique_show (aiFormationCritic)

**Currently built but not wired.** Critique card with severity badges; group by category (pacing / variety / color / altitude / idle utilization); per-suggestion "apply suggestion" button linking to relevant write tool; confidence score; side-by-side before/after preview. **Effort: M.**
