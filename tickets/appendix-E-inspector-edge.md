# Appendix E — Inspector: Edge specifics

---

## E-01 Allocation mode

**Status:** todo • **Effort:** M
**Affects:** [src/components/inspectors/EdgeInspector.tsx](src/components/inspectors/EdgeInspector.tsx) (or wherever edge inspector lives)

**Current:** badge on edge shows mode.
**Figma-perfect:** dropdown in inspector + on the edge itself; constraint explanation tooltip; red warning with reason on violation; preview affected drones in viewport on hover.

---

## E-02 Drone count / percent

**Status:** todo • **Effort:** S (with C-01)
**Affects:** [src/components/inspectors/EdgeInspector.tsx](src/components/inspectors/EdgeInspector.tsx)

**Current:** edit via badge.
**Figma-perfect:** L4 NumberInput with drag-scrub; dual count + percent display; highlight affected drones in viewport during edit; undo on change.
