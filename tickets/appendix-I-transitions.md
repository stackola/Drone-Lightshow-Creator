# Appendix I — Transition strategies

Each strategy gets a UX lift: live preview, contextual parameter controls, safety badge.

---

## I-01 Shortest Path (Hungarian)

**Status:** mostly done (mapping stats + safety badge + 3D line viz shipped 2026-05-21 ~22:52/22:59/23:13; only "alternatives with cost deltas" remains) • **Effort:** S • **Depends on:** L1
**Affects:** [src/components/inspectors/TransitionNodeInspector.tsx](src/components/inspectors/TransitionNodeInspector.tsx), [src/components/viewport/TransitionMappingLines.tsx](src/components/viewport/TransitionMappingLines.tsx), [src/registries/transitionStrategies.ts](src/registries/transitionStrategies.ts), [src/registries/transitions.ts](src/registries/transitions.ts)

**Current:** when a shortest-path transition is selected, the inspector shows a "Mapping stats" section with Total / Avg-per-drone / Max travel distances. A top-level safety badge (now applies to all strategies) shows red/amber/emerald based on currentDuration vs minDuration ratio. In the 3D viewport, the new `TransitionMappingLines` overlay renders one line segment per mapped source→target pair, color-coded blue→orange by per-pair distance. Skips at n > 200 (Hungarian itself falls back to greedy at that size).
**Figma-perfect remaining:** "show alternatives with cost deltas" button. Optional follow-ups: keyframe-aware endpoint positions (currently uses base transform only), per-formation point-jiggle on hover to disambiguate paths.

---

## I-02 Ant Walk

**Status:** todo • **Effort:** M • **Depends on:** L1, L4
**Affects:** [src/registries/transitions.ts](src/registries/transitions.ts), [src/registries/antWalkPhysics.test.ts](src/registries/antWalkPhysics.test.ts)

**Current:** no parameters.
**Figma-perfect:** pheromone-memory slider; simulated colony paths color-coded by time; collision zones in red; iteration counter; "optimize pheromone grid" button.

---

## I-03 Stagger / Wave

**Status:** todo • **Effort:** M • **Depends on:** L1
**Affects:** [src/registries/transitionStrategies.ts](src/registries/transitionStrategies.ts)

**Current:** numeric stagger fields (amount, mode, curve).
**Figma-perfect:** timeline ramp draggable; mode picker with color-coded delay (red=first → blue=last); arrival-order sweep animation; curve selector; "feels-like" descriptive label ("slow wave" / "chaotic spray" / "snappy stagger").

---

## I-04 Spiral

**Status:** todo • **Effort:** M • **Depends on:** L2
**Affects:** [src/registries/transitionStrategies.ts](src/registries/transitionStrategies.ts)

**Current:** turns / radius / direction fields.
**Figma-perfect:** spiral trajectory overlay in viewport with L2 handles; direction toggle with animated preview; peak-velocity warning; compressed-vs-loose preview comparison.

---

## I-05 Explosion

**Status:** todo • **Effort:** M • **Depends on:** L1, L2
**Affects:** [src/registries/transitionStrategies.ts](src/registries/transitionStrategies.ts)

**Current:** max-radius + gravity.
**Figma-perfect:** scatter-radius slider with expanding-shell preview; gravity dial showing curving paths; two-phase indicator on timeline (scatter / converge); intensity label; velocity heatmap.

---

## I-06 Implosion

**Status:** todo • **Effort:** M
**Affects:** [src/registries/transitionStrategies.ts](src/registries/transitionStrategies.ts)

**Current:** no exposed params; auto-stagger.
**Figma-perfect:** focal-point indicator in viewport; per-drone arrival-time timeline; minimum-approach-distance metric; convergence vs expansion phase toggle; choreography inspector with spacing safety margin.

---

## I-07 Cascade / Domino

**Status:** todo • **Effort:** M • **Depends on:** L2
**Affects:** [src/registries/transitionStrategies.ts](src/registries/transitionStrategies.ts)

**Current:** propagationSpeed + direction.
**Figma-perfect:** direction arrow picker in viewport (L2); light-cone overlay showing propagation region; timeline scrubber showing cascade sweep; wave readout (wavelength, frequency, crest speed); per-region velocity heatmap.

---

## I-08 Morph + Bounce/Spring

**Status:** todo • **Effort:** M (each)
**Affects:** [src/registries/transitionStrategies.ts](src/registries/transitionStrategies.ts)

**Morph current:** arcHeight only. **Morph Figma-perfect:** arc-height slider with 3D arc preview + clearance lines between paths; collision highlighting; "arc shape" gentle→dramatic visual; path-density altitude heatmap; easing picker.

**Bounce current:** damping only; **velocity coefficient (`peakCoef = 2 + 3π ≈ 11.42`) is numerically validated** by `transitionStrategies.test.ts` under "peak velocity at minRequired ≤ maxVelocity × 1.05" — derived from `applyEasing(t, 'ease-out')` quadratic (f'(0)=2) + oscillation `g'(0)=ω=3π`. Tier 1 #7 was stale.
**Bounce Figma-perfect:** damping slider with trajectory curve preview; frequency indicator (bounce count); amplitude slider; settling-time + peak-velocity readout.
