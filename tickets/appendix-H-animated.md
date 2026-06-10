# Appendix H — Animated formations

Hardcoded keyframe loops today. Each needs parameters exposed + L1 preview + animation contract tests.

---

## H-01 Apple Tree (Shake & Drop)

**Status:** todo • **Effort:** L • **Depends on:** L1, L4
**Affects:** [src/registries/formationLibrary.ts](src/registries/formationLibrary.ts)

**Current:** 50 drones, fixed 8s animation, no exposed parameters.
**Figma-perfect:**
- Inspector timeline scrubber with frame preview on hover.
- Three parameter groups exposed (tree stiffness, apple mass, drop speed) all draggable via L4 sliders.
- Keyframe editor for position + color across the animation.
- Physics warnings (apple hits max velocity).
- Shake-intensity heatmap on the tree.
- L1 looping animated preview.

---

## H-02 Firework Burst

**Status:** todo • **Effort:** M • **Depends on:** L1, L4
**Affects:** [src/registries/formationLibrary.ts](src/registries/formationLibrary.ts)

**Current:** 60 drones, fixed rapid expansion + rainbow.
**Figma-perfect:** editable start-radius + expansion-distance; timeline scrubber; particle-count slider; gravity slider; color palette override; loop toggle with fade-in/out.

---

## H-03 Breathing Sphere

**Status:** todo • **Effort:** M • **Depends on:** L1, L4
**Affects:** [src/registries/formationLibrary.ts](src/registries/formationLibrary.ts)

**Current:** 80 drones, 4s loop, blue pulse, hardcoded.
**Figma-perfect:** min/max radius slider pair; frequency slider; color palette for pulse; easing picker; amplitude dial.
