# Appendix L — AI write tools (~31)

**All depend on L3** (tool-call card system). Each gets the base L3 card (title, status, action buttons, undo) plus a per-tool body slot.

Tickets here describe the per-tool body slot. After L3, adoption is hours per tool.

---

## L-01 create_formation

Body slot: L1 thumbnail; point count; "edit parameters" inline button. Effort: S.

## L-02 update_formation

Body slot: before/after thumbnail; old vs new name + point count diff. Effort: S.

## L-03 create_formation_from_text

Body slot: live font preview as text changes; font picker UI; drone-count + scale sliders; plane toggle (front/top); SVG export button. Effort: M.

## L-04 set_formation_points

Body slot: 3D scatter preview (first 50 pts); bounding box; min/max altitude; collision check (flag pairs < minSpacing); diff view on update. Effort: M.

## L-05 add_launch_node

Body slot: timeline-insertion viz; downstream-bottleneck callout; "adjust start time" inline button. Effort: S.

## L-06 add_formation_node

Body slot: L1 thumbnail; duration + altitude; color program preview if assigned; "adjust timing" button. Effort: S.

## L-07 add_transition_node

Body slot: strategy icon + L1 preview; parameter summary; physics safety badge (green/yellow/red); "change strategy" button. Effort: S.

## L-08 add_idle_node

Body slot: behavior icon + L1 preview; timeline slot indicator; "adjust parameters" button; color program shortcut. Effort: S.

## L-09 add_land_node

Body slot: landing-time line; stagger viz (drone descent cascade); estimated ground-touch time. Effort: S.

## L-10 connect_nodes

Body slot: source → target with arrow; edge drawn on canvas with brief highlight. If invalid: compatible-node-types listed. Effort: S.

## L-11 remove_node

Body slot: confirmation: "Remove [Formation: Grand Ring]?" + impact summary ("Affects 2 downstream nodes"). Effort: S.

## L-12 remove_edge

Same as L-11 but for edges. Effort: S.

## L-13 update_node_timing

Body slot: before/after timeline; cascade impact ("5 downstream nodes will shift"); duration validation ("2.3s leaves 0.8s for transition — marginal"). Effort: S.

## L-14 update_node_transform

Body slot: "transform applied to [Formation]"; before/after 3D wireframe preview; "open in 3D editor" shortcut. Effort: S.

## L-15 add_keyframe

Body slot: mini timeline showing all keyframes on the node + new one highlighted; easing curve preview; "edit keyframe" button. Effort: S.

## L-16 remove_keyframe

Body slot: confirmation: "Remove keyframe at 2.5s?"; timeline preview of remaining. Effort: S.

## L-17 set_color_program

Body slot: before/after color swatch row; "change color" button. Effort: S.

## L-18 set_transition_strategy

Body slot: old → new strategy chip; parameter summary; physics safety badge; "adjust parameters" button. Effort: S.

## L-19 add_attached_idle

Body slot: "added [behavior] to [formation], affects N drones"; behavior icon + L1 preview; "adjust parameters" button. Effort: S.

## L-20 fix_all_violations

Body slot: structured "fixed N, M remain" diff; per-fix one-line description with granular undo button; detailed-diff link. **Effort: M** (this is one of the higher-value cards).

## L-21 auto_time_show

Body slot: "set durations on N transitions; total show length now X seconds"; per-transition detail accordion. Effort: M.

## L-22 push_timing

Body slot: timeline preview with affected nodes highlighted, moved visually; "5 nodes shifted by +2.0s." Effort: S.

## L-23 set_drone_count

Body slot: before/after table; impact analysis ("M new drones spawn at home positions"); affected-formation highlights. Effort: M.

## L-24 update_constraints

Body slot: before/after constraints; visual limit bands on timeline; "this reduces max altitude by 5m, check current formations" callout. Effort: M.

## L-25 clear_graph

Body slot: scary confirmation; "This deletes all formations, nodes, and edges"; save-backup option. Effort: S.

## L-26 create_show_from_outline

Body slot: outline review (acts list, formation names, timings, colors); "simulate" button; conflict warnings; progress indicator during build; success card with play button. **Effort: L**.

## L-27 analyze_image_for_formation

Body slot: drag-drop area for image; real-time edge map + suggested drone density; threshold slider; thumbnail; "create formation" button. **Effort: L**.

## L-28 generate_music_synced_show

Body slot: waveform preview with detected beats; style selector (gentle / dynamic / dramatic) with preview; BPM readout; beat-snap viz; generation progress; "regenerate with different style" button. **Effort: L**.

## L-29 generate_show_structure

Body slot: outline preview (acts / durations / colors) in readable format; per-act inline edit; "create show from outline" commit button; "regenerate with different theme" button; complexity slider. **Effort: L**.

## L-30 create_show_outline / variants

Group of structural tools — variants of L-29. Each gets a similar body slot. Effort: S each.

## L-31 misc patches & helpers

Smaller helper write tools — generic card with title + parameter summary + undo. Effort: S each.
