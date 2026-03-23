# Development Log

## Current State (after latest chat)

- Dock behavior was fully reworked and stabilized.
- Dock activation now uses a dedicated viewport rule:
  - `DOCK_ACTIVATION_MAX_WIDTH` in `react/YoutubeShortsWidget.tsx` (currently `1620`).
- Docked placement now follows the latest product decision:
  - right side of viewport (using `offsetX`),
  - vertically centered.
- On load, when dock mode is active, widget starts docked.

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
- Docked audio behavior:
  - if autoplay starts while docked, video starts muted,
  - mouse over on dock-revealed card unmutes,
  - mouse leave while still docked mutes again.
- This behavior is documented in schema description for `startOnLoad`.

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
- Component remains large (player lifecycle + drag/resize + dock + controls in one file).
- Future improvement:
  - split into hooks/components (`useDockBehavior`, `useYoutubePlayer`, etc.),
  - optionally expose some dock constants as advanced props.

