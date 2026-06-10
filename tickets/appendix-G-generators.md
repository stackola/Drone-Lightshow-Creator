# Appendix G — Static formation generators

Each generator gets a UX lift: form fields → 3D handles + L1 previews + smart defaults.

---

## G-01 Ring

**Status:** todo • **Effort:** M • **Depends on:** L2, L1
**Affects:** [src/registries/generators.ts](src/registries/generators.ts), [src/components/inspectors/](src/components/inspectors/)

**Current:** count + radius fields.
**Figma-perfect:**
- L2 radius handle in viewport, drag for live radius.
- L2 plane/tilt handle to angle the ring.
- L2 count handle (+N/−N pip) with pair-spacing violation warning (drones turn red when too close).
- L1 mini thumbnail in asset panel.
- ESC reverts during drag; Enter commits.
- Smart default: radius auto-scales to satisfy pair-spacing given count.

---

## G-02 Grid

**Status:** todo • **Effort:** L • **Depends on:** L2, L1
**Affects:** [src/registries/generators.ts](src/registries/generators.ts)

**Current:** cols / rows / spacing fields.
**Figma-perfect:**
- Draggable grid outline in viewport — drag edges to resize live (rows + cols + spacing).
- Corner handle for uniform scale.
- Two-finger trackpad gesture adjusts spacing.
- Live row/col count update; auto-clamp to drone-pool size.
- Cell highlight showing inter-drone gap in real time (heatmap if spacing is on the edge of violation).

---

## G-03 Sphere

**Status:** todo • **Effort:** M • **Depends on:** L2, L1
**Affects:** [src/registries/generators.ts](src/registries/generators.ts)

**Current:** count + radius (Fibonacci shell).
**Figma-perfect:** orbit-rotate the sphere in viewport; count slider with pairwise-min-dist badge; "exploded view" toggle showing layers with transparency; hemisphere color-code.

---

## G-04 Spiral

**Status:** todo • **Effort:** L • **Depends on:** L2
**Affects:** [src/registries/generators.ts](src/registries/generators.ts)

**Current:** count / turns / spacing / radius fields.
**Figma-perfect:**
- Drag end-point handle to scale turns + radius together.
- Taper slider with live compression visualization.
- Color drones by position along spiral (red→blue gradient).
- Pitch angle indicator.
- Density heatmap by local spacing.

---

## G-05 Line / arc

**Status:** todo • **Effort:** M • **Depends on:** L2
**Affects:** [src/registries/generators.ts](src/registries/generators.ts)

**Current:** count / length / arc-angle fields.
**Figma-perfect:**
- Draw a line in viewport — endpoint handles set length; midpoint handle arcs.
- Snap to common angles (0°, 45°, 90°).
- Spacing-violation zones in red.
- Real-time path rendering as you adjust angle.

---

## G-06 Heart

**Status:** todo • **Effort:** L • **Depends on:** L2
**Affects:** [src/registries/generators.ts](src/registries/generators.ts)

**Current:** count + size.
**Figma-perfect:** outline in viewport; drag vertices to morph; symmetry toggle to reflect half-heart; density heatmap; save custom morphs as templates.

---

## G-07 Star

**Status:** todo • **Effort:** M • **Depends on:** L2
**Affects:** [src/registries/generators.ts](src/registries/generators.ts)

**Current:** count / points / outer-radius / inner-radius fields.
**Figma-perfect:**
- Drag outer + inner radius handles simultaneously.
- Points-per-star slider with visual count.
- Rotation handle to spin on canvas.
- Color-code by point sharpness (inner vs outer).
