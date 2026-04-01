# Development Log

## Current State (after latest refactor)

- Dock behavior was fully reworked and stabilized.
- Dock activation now uses a dedicated viewport rule:
  - `DOCK_ACTIVATION_MAX_WIDTH` in `react/YoutubeShortsWidget.tsx` (currently `1620`).
- Docked placement now follows the latest product decision:
  - right side of viewport (using `offsetX`),
  - vertically centered.
- On load, when dock mode is active, widget starts docked.
- Core logic was split into dedicated hooks:
  - `react/useDock.ts`
  - `react/useDragResize.ts`
  - `react/useYouTubePlayer.ts`
- `useYouTubePlayer` lifecycle was stabilized to avoid unnecessary iframe recreation:
  - `isPlaying` and `startOnLoad` were removed from the main player init effect dependency list.
  - The effect now reads these values through refs (`isPlayingRef`/`startOnLoadRef`) during `onReady`.
  - This prevents `destroy/create` cycles when users trigger normal play/pause interactions.
- Dock hook API was simplified:
  - removed `dockAnchor` from `useDock` input/dependencies because it did not affect dock position calculation.
  - added `applyDockMode(isDockedMode)` to encapsulate dock state transitions (`isDocked` + hover reset) and reduce coupling with `YoutubeShortsWidget`.
- Hover-only visual states for action buttons were removed from React state and moved to CSS `:hover` rules.

## Dock Rules Implemented

- Docked state (`isDocked=true`) now means the widget is truly attached to dock.
- Undocking happens only via drag:
  - dragging away and releasing outside dock region sets `isDocked=false`.
- Re-docking happens only via drag:
  - dropping back into the right dock region reattaches (`isDocked=true`).
- Dock region logic:
  - based on right-side region,
  - includes 10% tolerance of available right-side dock space.
- Hidden behavior while docked:
  - Desktop: card remains partially visible (slice).
  - Mobile: card hidden, gray bubble visible.
- Hover behavior while docked:
  - Desktop hover reveals full card.
  - Leaving hover hides it again (if still docked).

## Audio / Autoplay Rules Implemented

- `startOnLoad` autoplay remains active.
- There is no public `muted` prop in schema/default props.
- Initial load volume rule:
  - default initial volume is `40%`,
  - when the widget loads already docked, initial volume is forced to `0%` (muted).

## Widget UX and Core Behavior (kept)

- Draggable widget (ignores interactive controls while dragging).
- Desktop resize by edges/corners with 9:16 ratio preserved.
- Mobile fixed-size mode under `<1024px`.
- Hover/tap controls:
  - Desktop hover controls with progress/play/pause/volume.
  - Mobile tap controls with auto-hide.
- YouTube metadata header (title/author) overlay.
- Loop support (`looping`) with ended-state fallback replay.
- SPA route reset/reload handling:
  - internal state reset on route transitions.

## Schema / Config Notes

- Public schema props currently include:
  - `shortsUrl`, `startOnLoad`, `closable`, `looping`,
  - `desktopAnchor`, `desktopOffsetX`, `desktopOffsetY`,
  - `mobileAnchor`, `mobileOffsetX`, `mobileOffsetY`.
- Dock-specific constants remain internal code config (not schema props):
  - `DOCK_ACTIVATION_MAX_WIDTH`,
  - `DOCK_VISIBLE_SLICE_RATIO`,
  - dock region tolerance calculation.

## Known Trade-offs / Follow-ups

- Dock rules are intentionally code-driven and not exposed in Site Editor.
- `YoutubeShortsWidget` became thinner, but still orchestrates layout and rendering of overlays/controls.
- Dock bubble icon was extracted to a small presentational component (`DockBubbleIcon`) to keep main component render block cleaner.
- Future improvement:
  - split visual overlays/controls into smaller presentational components,
  - optionally expose some dock constants as advanced props.

