# Selection domains — design

## Problem

Five selection systems coexist and don't compose:

| Store | Owns | Surface |
|---|---|---|
| `selectionStore` | node ids + edge ids | graph canvas, 3D click, timeline bars, inspector routing |
| `pointEditorStore` | per-point indices within one formation | 3D point-edit mode |
| `planesStore.activePlaneId` | the active build plane | PlanesPanel, BuildPlaneWidget |
| `audienceEditStore` | audience placement state | audience viewport |
| gizmo focus | implicit (derived from selectionStore) | FormationGizmo / MultiSelectGizmo |

Symptoms: Escape means different things per surface; Delete acts on graph
selection even while point-editing; entering point edit doesn't visually
demote the formation selection; the gizmo can fight the point gizmo.

## Approach: arbiter, not merger

Do NOT merge the stores — each one's shape is right for its consumers.
Add a tiny coordination layer: `src/stores/selectionDomain.ts`.

```ts
type SelectionDomain = 'graph' | 'points' | 'plane' | 'audience'

interface SelectionDomainState {
  /** Stack, last = active. 'graph' is the permanent root. */
  stack: SelectionDomain[]
  active(): SelectionDomain
  push(d: SelectionDomain): void
  /** Pop the active domain; returns false at the root (caller may then clear). */
  pop(): boolean
}
```

Rules:
1. Entering point edit (`pointEditorStore.enterEditMode`) pushes `points`;
   exiting pops it. Same for audience edit toggle and plane-manipulation focus.
2. **Escape pops the stack**: points → graph → clear graph selection. One
   global Escape handler in the shortcut registry (P4.1) replaces today's
   per-surface Escape listeners.
3. **Delete/Duplicate/Lock route by active domain**: `editorActions.ts`
   checks `active()`; in `points` mode, Delete removes selected points (or
   no-ops) instead of deleting the whole formation node out from under you.
4. **Gizmo mounting derives from the domain**: FormationGizmo renders only
   when domain is `graph`; PointEditorGizmo when `points`. Removes the
   current "yield" checks scattered through SceneSelectionController etc.

## Migration order

1. Add the store + push/pop calls in pointEditorStore / audienceEditStore
   (2 call sites each, additive — nothing reads it yet).
2. Route Escape through it (registry scope, P4.1 dependency).
3. Route editorActions by domain.
4. Derive gizmo mounting.

Each step is independently shippable; consumers that don't know about
domains keep working because the stores themselves are untouched.
