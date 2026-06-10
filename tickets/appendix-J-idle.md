# Appendix J — Idle behaviors

**All J-tickets depend on B3.** The behavior implementations are wrong today (they discard `homePos`). UX work on top of broken behavior would be wasted. B3 fixes the underlying math; J-tickets layer UX on top of fixed behaviors.

---

## J-01 Hover

**Status:** todo • **Effort:** S • **Depends on:** —
**Affects:** [src/registries/idleBehaviors.ts](src/registries/idleBehaviors.ts), inspector

**Current:** center + altitude fields. (The one that works.)
**Figma-perfect:** crosshair indicator at center XZ in viewport; altitude slider with safe-band visualization (green within geofence, red outside); stacking indicator if multiple idles share altitude.

---

## J-02 Orbit

**Status:** todo • **Effort:** M • **Depends on:** B3, L2, L1
**Affects:** [src/registries/idleBehaviors.ts](src/registries/idleBehaviors.ts), inspector

**Figma-perfect (post-B3, "small orbit around home"):** draw a small orbit circle in viewport via L2 radius handle; speed slider; pair-spacing indicator on orbit; altitude adjustment handle; direction toggle (CW/CCW); period display ("completes in 6s").

---

## J-03 Figure 8

**Status:** todo • **Effort:** M • **Depends on:** B3, L1
**Affects:** [src/registries/idleBehaviors.ts](src/registries/idleBehaviors.ts)

**Figma-perfect:** figure-8 lemniscate curve overlay in viewport; drag lobes to scale; speed slider; stacking-density indicator; collision heatmap; aspect-ratio slider.

---

## J-04 Breathe

**Status:** todo • **Effort:** M • **Depends on:** B3, L1, L4
**Affects:** [src/registries/idleBehaviors.ts](src/registries/idleBehaviors.ts)

**Figma-perfect:** min/max radius slider pair with breathing preview; frequency dial; amplitude slider; breathing-phase color map per drone; "feels-like" descriptive label (shallow → deep).

---

## J-05 Swarm

**Status:** todo • **Effort:** L • **Depends on:** B3, L1
**Affects:** [src/registries/idleBehaviors.ts](src/registries/idleBehaviors.ts)

**Figma-perfect:** animation preview in viewport; speed slider (chaos intensity); radius bounding box (adjustable); seed randomization button for new pattern; coherence slider (0=chaotic, 1=coordinated); per-drone max velocity shown.

---

## J-06 Sparkle

**Status:** todo • **Effort:** M • **Depends on:** B3, L1
**Affects:** [src/registries/idleBehaviors.ts](src/registries/idleBehaviors.ts)

**Figma-perfect:** radius slider with pulsing ring preview; frequency control for vertical bob; amplitude controls for radial pulse + vertical bob; color-flicker toggle synchronized to pulse; particle-density slider.

---

## J-07 Pulse

**Status:** todo • **Effort:** M • **Depends on:** B3, L1
**Affects:** [src/registries/idleBehaviors.ts](src/registries/idleBehaviors.ts)

**Figma-perfect:** radius slider with expanding/contracting ring preview; speed slider; phase-offset slider (radial vs vertical); separate amplitude sliders for radius + height; combined breathing-effect preview.

---

## J-08 Wave

**Status:** todo • **Effort:** M • **Depends on:** B3, L1
**Affects:** [src/registries/idleBehaviors.ts](src/registries/idleBehaviors.ts)

**Figma-perfect:** radius slider with ring outline; speed slider showing wave propagation; amplitude dial; wavelength indicator; wave direction toggle.

---

## J-09 Spin

**Status:** todo • **Effort:** S • **Depends on:** B3, L1, L2
**Affects:** [src/registries/idleBehaviors.ts](src/registries/idleBehaviors.ts)

**Figma-perfect:** L2 radius handle; speed slider with animated rotation preview; direction toggle (CW/CCW); period display; tangential-velocity safety margin indicator.

---

## J-10 Drift

**Status:** todo • **Effort:** M • **Depends on:** B3, L1, L2
**Affects:** [src/registries/idleBehaviors.ts](src/registries/idleBehaviors.ts)

**Figma-perfect:** radius slider; speed slider; L2 direction picker (angle dial or XZ vector); drift-magnitude slider; trajectory preview showing net spiral drift.
