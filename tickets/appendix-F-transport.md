# Appendix F — Transport & timeline

---

## F-01 Transport controls

**Status:** done (Space play/pause + Ctrl+Space stop + arrow scrub + loop toggle + ping-pong mode + mark-in/out all shipped) • **Effort:** M
**Affects:** [src/components/canvas/useCanvasKeyboard.ts](src/components/canvas/useCanvasKeyboard.ts), [src/components/KeyboardShortcutsOverlay.tsx](src/components/KeyboardShortcutsOverlay.tsx), [src/components/viewport/TransportControls.tsx](src/components/viewport/TransportControls.tsx), [src/stores/playheadStore.ts](src/stores/playheadStore.ts), [src/stores/playheadStore.test.ts](src/stores/playheadStore.test.ts)

**Current:** skip-back / play-pause / stop buttons, MM:SS.f display, speed dropdown, loop toggle + ping-pong sub-mode (lucide `Shuffle` reveals when loop is enabled), mark-in / mark-out buttons (lucide `ChevronFirst` / `ChevronLast`, always visible) that snap `loopStart`/`loopEnd` to the current playhead. Two loop modes:
- `loop`: wrap currentTime from loopEnd → loopStart (legacy).
- `ping-pong`: reflect currentTime at loopEnd, reverse direction; reflect again at loopStart. Direction stored as internal `pingDir: 1 | -1` reset on toggle.
Keyboard: Space = play/pause, Ctrl+Space = stop (pause + reset playhead), ← / → = 0.1s scrub or selected-node nudge, Shift+ ← / → = 1s scrub or coarse nudge.

---

## F-02 FPS readout

**Status:** todo • **Effort:** M
**Affects:** [src/components/StatusBar.tsx](src/components/StatusBar.tsx), new stats overlay

**Current:** FPS in status bar, red when <30.
**Figma-perfect:** rolling graph (last 60 frames) in stats overlay; frame-time breakdown (render vs physics); memory spike alerts; record + replay frame capture for debugging.
