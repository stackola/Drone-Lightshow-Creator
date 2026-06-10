# Appendix N — Dialogs & onboarding

---

## N-01 Welcome screen

**Status:** todo • **Effort:** M • **Depends on:** L1
**Affects:** [src/components/welcome/WelcomeScreen.tsx](src/components/welcome/WelcomeScreen.tsx), [src/components/welcome/DemoGrid.tsx](src/components/welcome/DemoGrid.tsx)

**Current:** blank project / simple linear / split-merge templates + recent projects + demo grid.
**Figma-perfect:** animated intro; tutorial link; "new from AI prompt" button; recent thumbnails; demo categories with video previews; arrow-key nav; Escape / Enter shortcuts.

---

## N-02 Demo grid

**Status:** partial (theme filter chips shipped 2026-05-22 ~00:31; "Coming soon" stub already replaced with "Generate with AI" button earlier; hover video preview + "inspect demo" right-click still todo) • **Effort:** S • **Depends on:** L1
**Affects:** [src/components/welcome/DemoGrid.tsx](src/components/welcome/DemoGrid.tsx)

**Current:** grid of demo tiles (thumbnail strip + name + duration + drone count + theme + feature chips). Above the grid, a "Demo Shows" header and a row of theme filter chips (All / minimalist / narrative / festive / intimate / branded / cinematic — only themes that have at least one demo show). Below the grid, "Generate a show with AI" CTA.
**Figma-perfect remaining:** hover video preview (would need pre-rendered clips); "inspect demo" right-click context menu.

---

## N-03 Replace-show confirm dialog

**Status:** done (counts panel + Y/N/Enter/Escape/S keyboard + click-outside-to-cancel + autoFocus on Replace shipped 2026-05-22 ~00:18) • **Effort:** S
**Affects:** [src/components/welcome/ReplaceShowConfirmDialog.tsx](src/components/welcome/ReplaceShowConfirmDialog.tsx)

**Current:** dialog renders an inline "Will be lost" panel showing counts of formation/transition/idle nodes, flow edges, and saved formations. Keyboard: Y or Enter = Replace; N or Escape = Cancel; S = Save & Replace. Buttons show their shortcut hint inline `(Y)`/`(N)`/`(S)`. Click outside the dialog also cancels. Save & Replace was already present.

---

## N-04 Export dialog

**Status:** todo • **Effort:** M • **Depends on:** S9
**Affects:** [src/components/dialogs/ExportDialog.tsx](src/components/dialogs/ExportDialog.tsx) (or similar)

**Current:** format selector (CSV/JSON/Video); sample rate; coord system; bake progress.
**Figma-perfect:** format tabs with live preview (first 10 CSV rows); coord system diagram; resolution + codec + quality for video; metadata editor (title, creator, date); clipboard copy of settings; undo/redo on parameter changes.

---

## N-05 AI settings dialog

**Status:** mostly done (model selector + hidden-with-show/hide API key + "Get an API key" external link shipped 2026-05-22 ~00:24; rate-limit indicator + usage history still todo, both need backend integration) • **Effort:** S
**Affects:** [src/components/AIChatPanel.tsx](src/components/AIChatPanel.tsx) (`InlineSettings`)

**Current:** Claude API key password input with show/hide eye toggle (lucide `Eye`/`EyeOff`), model dropdown (Sonnet 4.6 / Opus 4.6 / Haiku 4.5), "Get an API key" external link to console.anthropic.com, session-only storage disclaimer.
**Figma-perfect remaining:** rate-limit indicator (live throttling status); usage history; explicit feature toggle separate from API key presence.

---

## N-06 Shortcuts overlay

**Status:** todo • **Effort:** M • **Depends on:** L5-cmd-palette
**Affects:** [src/components/KeyboardShortcutsOverlay.tsx](src/components/KeyboardShortcutsOverlay.tsx)

**Current:** ? key opens modal with all shortcuts grouped.
**Figma-perfect:** search by name or key; context filter; Mac variants; customizable keybindings editor (click then press a key); print to PDF; recently-used at top.

---

## N-07 Crash recovery + tutorial

**Status:** todo • **Effort:** S + M
**Affects:** Crash recovery dialog (where defined), [src/components/Tutorial.tsx](src/components/Tutorial.tsx)

**Crash recovery Figma-perfect:** recovered-session list with timestamps + thumbnails; select to recover / discard; save crash log option.
**Tutorial Figma-perfect:** interactive (highlight canvas → prompt action → wait for completion); keyboard advance; skip option; estimated time; resume later; link to full docs.
