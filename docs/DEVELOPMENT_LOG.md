# Development Log

## Scope Covered In This Chat

- Added desktop/mobile split behavior using viewport threshold `<1024px`.
- Added configurable initial position system:
  - `desktopAnchor`, `desktopOffsetX`, `desktopOffsetY`
  - `mobileAnchor`, `mobileOffsetX`, `mobileOffsetY`
- Added position reset behavior after:
  - Full page reload
  - SPA route transitions (`pushState`, `replaceState`, `popstate`)
- Added controls visibility when video is paused (desktop).
- Added YouTube metadata header overlay (title + author/channel).
- Standardized hover transitions in interactive controls to `.3s ease-in-out`.
- Implemented mobile dedicated controls area:
  - Tap-to-show controls
  - Auto-hide controls
  - Fullscreen button
- Mobile behavior currently:
  - Fixed widget size (no manual resize gesture)
  - Drag enabled

## Pending Adjustments / TODOs

- Make mobile fixed size configurable via schema prop (example: `mobileFixedWidth`), instead of hardcoded constant.
- Review if desktop should preserve user drag position across route changes (currently resets to configured anchor by design).
- Add optional prop for mobile controls auto-hide timeout (currently fixed).
- Add optional prop to disable fullscreen button on mobile if store policy requires.
- Evaluate adding CSS Handles for style customization (currently none).
- Adjust size and positioning of all widget icons (play, pause, volume, mute, close).
- Fix/adjust the noticeable delay when starting to drag the widget after the tap-to-pause + long-press-to-drag interaction change (likely tied to `LONG_PRESS_MS` / gesture discrimination).

## Potential Issues / Risks

- Fullscreen API behavior may vary on iOS Safari and WebView contexts.
- `requestFullscreen` on iframe may be blocked in some browser/security contexts.
- YouTube metadata (`getVideoData`) can be unavailable temporarily on certain loading timings.
- Mobile drag and tap-to-toggle controls can conflict in edge cases with very quick gestures.
- The component patches browser history methods for SPA detection; other scripts may also patch them.

## Known Technical Debt

- Main component is large and combines:
  - player lifecycle
  - drag/resize
  - desktop UI controls
  - mobile UI controls
  Consider extracting into:
  - `useYoutubePlayer` hook
  - `useWidgetDragResize` hook
  - `MobileControls` and `DesktopControls` components
- Inline styles are extensive; moving to CSS handles or scoped style map would improve maintainability.

## Test Plan Pending

### Functional

- Desktop:
  - Drag works across viewport bounds.
  - Resize works from edges/corners and keeps 9:16 ratio.
  - Controls appear on hover and remain visible while paused.
  - Metadata header appears on hover.
- Mobile (`<1024px`):
  - Drag works reliably on touch.
  - Resize gestures do not change size.
  - Controls appear on tap and auto-hide.
  - Fullscreen button enters/exits fullscreen.
  - Play/pause, seek and volume controls work after repeated interactions.

### Navigation / Lifecycle

- Reload page and verify position resets to configured anchor/offset.
- Navigate between SPA pages and confirm:
  - Widget reinitializes correctly
  - Position resets correctly
  - No duplicated players or orphaned iframe instances

### Compatibility

- Chrome desktop/mobile emulation
- Safari iOS
- Samsung Internet / Android Chrome
- VTEX store environment with real production scripts

## Regression Checks Recommended

- `closable` still unmounts widget and destroys player safely.
- `startOnLoad=false` still waits for click/tap to mount iframe.
- `muted` and volume synchronization still behave correctly.
- `looping` still restarts playback on `ENDED`.

## Notes For Next Iteration

- Prioritize browser matrix tests for fullscreen and touch drag.
- If mobile UX still feels crowded, evaluate:
  - larger controls
  - reduced control set in compact mode
  - separate mobile control row with fewer actions
