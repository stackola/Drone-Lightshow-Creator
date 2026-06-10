# Operating principles

These aren't tickets in their own right; they're the standard every ticket is judged against. Referenced from individual tickets as `(P1)`, `(P3)`, etc.

- **P1 — Edits are believable in real time.** No stale states; no "scrub to see your change." (B1 is the prerequisite.)
- **P2 — Direct manipulation beats forms.** Where two paths exist (inspector field vs 3D handle), the handle is the loved one. (L2 enables.)
- **P3 — Every input is a craft item.** Drag-scrub, math expressions, units, nudge, mixed-value indicators, tab order, snap. (L4 enables.)
- **P4 — Motion design is built in, not bolted on.** Deliberate transitions (60–180ms). Panels ease. Selection grows. (L5-tokens enables.)
- **P5 — Keyboard is a first-class surface.** Every action has a shortcut. Power users never touch the mouse for the common loop. (L5-cmd-palette enables.)
- **P6 — Errors are first-class UI.** No silent catches. Every recoverable failure has a banner with a suggested fix. (L5-toast enables.)
- **P7 — Visual hierarchy is deliberate.** Density, type, color, contrast — all chosen. Dark-mode-first.
- **P8 — Performance is invisible.** 60 fps. Worker boundaries crossed without UI freeze. Real progress on long ops.
- **P9 — What you see is what you ship.** Live preview = bake output within documented tolerance. CI-asserted.
- **P10 — Empty/loading/error states are designed.** Every panel has all three.

Every ticket implicitly satisfies these unless explicitly opted out. If a ticket's implementation can't satisfy a relevant principle, that's a sign it should be re-scoped or rejected.
