# Appendix K — Color programs

10 programs; ~80 LOC of implementation; no real tests; UX is "pick from dropdown."

---

## K-01 Solid (white / red / blue / green)

**Status:** todo • **Effort:** S • **Depends on:** C-03 (ColorInput)
**Affects:** [src/registries/colorPrograms.ts](src/registries/colorPrograms.ts), [src/components/inspectors/ColorProgramEditor.tsx](src/components/inspectors/ColorProgramEditor.tsx)

**Figma-perfect:** L4 ColorInput (HSL wheel); live preview on 5-drone sample grid; brightness slider; saturation toggle; save-custom-as-template.

---

## K-02 Gradient (blue→red, warm)

**Status:** todo • **Effort:** M
**Affects:** [src/registries/colorPrograms.ts](src/registries/colorPrograms.ts)

**Figma-perfect:** color picker for start/end; axis selector (X/Y/Z); gradient-bar preview; easing selector; reverse button; save custom.

---

## K-03 Rainbow (spatial + index)

**Status:** todo • **Effort:** M
**Affects:** [src/registries/colorPrograms.ts](src/registries/colorPrograms.ts)

**Figma-perfect:** mode toggle (spatial vs index) with live effect; sat/brightness sliders + color-wheel sample; axis selector; hue start/end sliders (red-only, cool-only); preview on sample grid.

---

## K-04 Pulse White

**Status:** todo • **Effort:** M
**Affects:** [src/registries/colorPrograms.ts](src/registries/colorPrograms.ts)

**Figma-perfect:** color picker; frequency slider (Hz) with pulsing preview; amplitude slider; minBrightness slider; phase-offset slider; waveform picker (sine / square / saw).

---

## K-05 Chase RGB

**Status:** todo • **Effort:** M
**Affects:** [src/registries/colorPrograms.ts](src/registries/colorPrograms.ts)

**Figma-perfect:** color-palette editor (add/remove/reorder); speed + width sliders with chase preview; direction toggle; wrap mode (loop/bounce).

---

## K-06 Sweep Cyan→Magenta

**Status:** todo • **Effort:** M • **Depends on:** L2
**Affects:** [src/registries/colorPrograms.ts](src/registries/colorPrograms.ts)

**Figma-perfect:** L2 direction arrow handle in 3D; start/end color pickers; speed + width sliders; phase offset; sweep-in-action preview.
