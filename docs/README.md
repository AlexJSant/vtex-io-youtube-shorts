# YouTube Shorts Widget

Floating widget that renders a YouTube embed (Shorts or video) on the storefront.

Current behavior (updated):

- Mounts only after the page `load` event, so the widget never competes with the
  storefront's main content (see *Mount lifecycle* below).
- Draggable by any non-interactive area of the card, plus a dedicated drag handle bar
  attached under the card (see *Drag handle* below).
- Resizable from borders/corners on desktop, preserving the configured aspect ratio.
- Hover controls with progress, play/pause and volume.
- Volume control uses a single visual component: circular button in idle state, expanding upward on hover to reveal the vertical slider.
- Volume expansion is overlayed and does not shift neighboring controls.
- Dock mode is active when the viewport width is below `DOCK_ACTIVATION_MAX_WIDTH`
  (internal constant), and **always** when `aspectRatio` is `widescreen` or
  `forceCompactMode` is enabled.
- In dock mode, the widget starts docked at the right side of the viewport, vertically centered.
- Docked desktop state hides by position offset, keeping a visible slice; hover on the dock slice reveals the full card.
- If still docked, leaving hover hides it again.
- Docked compact state hides the card and keeps a gray bubble visible on the right edge.
- Controls remain visible when video is paused.
- Floating `×` close button.
- Optional infinite loop playback (`looping` prop).
- Auto reset/reload when the SPA route changes.
- Compact mode, automatic for viewports below `1024px` and forceable on any width via
  `forceCompactMode`:
  - Fixed widget size (no manual resize).
  - Widget remains draggable.
  - Video hidden behind the side bubble; tapping it opens the player fullscreen.
  - Native YouTube controls inside the embed.
- Optional native YouTube controls on any viewport (`nativeYoutubeControls` / `liveMode`),
  enabling the player's own fullscreen and "watch on YouTube" actions.
- Optional 16:9 aspect ratio (`aspectRatio` / `liveMode`) with a wider resize range.
- Hover visual effects use `transition: .3s ease-in-out` in interactive UI controls.
- Action button hover color is handled via CSS `:hover` classes (instead of React hover state for button color).

### Drag handle

A horizontal bar sits directly under the card's bottom edge, with a centered 6-dot grip
icon. It exists because native YouTube controls make the iframe swallow pointer events —
without it, the card could not be moved in those modes.

- Spans the full card width and follows it while resizing.
- Starts dragging immediately, with no tap-to-pause side effect.
- Hidden while the widget is docked and while in compact fullscreen.
- While it is visible, the video keeps only its top corners rounded, so the handle
  closes the assembly without a visible seam.

### Mount lifecycle

The widget renders `null` until the page finishes loading, then measures the viewport
and mounts. Three constraints shaped this:

- **Performance.** The dominant cost of this app is the YouTube iframe plus the
  `iframe_api` script. Holding the mount back keeps both out of the critical path.
- **Hydration.** Viewport-dependent state cannot be initialized from `window`, or the
  SSR markup (always desktop) and the client render diverge. React then discards and
  re-renders the subtree, and in production builds the mismatch corrupts sibling nodes.
  Rendering `null` on the server and on the first client render keeps both identical.
- **DOM ownership.** The `<iframe>` is created imperatively by `useYouTubePlayer`
  inside a React-owned `<div>` host, because `YT.Player#destroy()` removes its own node
  from the DOM. If React owned that node, its own later removal would throw
  `NotFoundError: removeChild` and unmount the whole page tree.

In SPA navigation the `load` event does not fire again, but `readyState` stays
`complete`, so a later remount releases immediately.

![Media Placeholder](https://user-images.githubusercontent.com/52087100/71204177-42ca4f80-227e-11ea-89e6-e92e65370c69.png)

## Configuration

1. Adding the app as a theme dependency in the `manifest.json` file (of your *store theme*):

```json
{
  "dependencies": {
    "sunhouse.youtube-shorts-widget": "0.0.1"
  }
}
```

2. Declaring the app block in a template (`youtube-shorts-widget`).

Example (`blocks.json` / `blocks.jsonc`) snippet:

```jsonc
{
  "flex-layout.col#pdp-sidebar": {
    "children": [
      "youtube-shorts-widget"
    ]
  },
  "youtube-shorts-widget": {
    "props": {
      "shortsUrl": "https://www.youtube.com/embed/dQw4w9WgXcQ",
      "startOnLoad": true,
      "closable": true,
      "looping": true,
      "forceCompactMode": false,
      "liveMode": false,
      "nativeYoutubeControls": false,
      "aspectRatio": "vertical",
      "desktopAnchor": "bottom-right",
      "desktopOffsetX": 32,
      "desktopOffsetY": 108,
      "mobileAnchor": "bottom-right",
      "mobileOffsetX": 12,
      "mobileOffsetY": 12
    }
  }
}
```

### Blocks exported by this app

| Block name | Description |
| ----------- | ----------- |
| `youtube-shorts-widget` | Floating YouTube widget (draggable, responsive desktop/mobile controls). |

### `youtube-shorts-widget` props

| Prop name | Type | Description | Default value |
| ---------- | ---- | ----------- | ------------- |
| `shortsUrl` | `string` | YouTube URL. Preferred format: `https://www.youtube.com/embed/{id}`. | `''` |
| `startOnLoad` | `boolean` | If `true`, mounts the iframe and starts playback when the block loads. | `true` |
| `closable` | `boolean` | If `true`, shows the `×` close button and allows unmounting. | `true` |
| `looping` | `boolean` | If `true`, the video restarts automatically when it ends (infinite loop). | `true` |
| `forceCompactMode` | `boolean` | Forces compact mode (video hidden behind the right-side bubble) on any viewport width, not only below `1024px`. | `false` |
| `liveMode` | `boolean` | Shortcut that enables native YouTube controls **and** the 16:9 ratio at once. Equivalent to setting `nativeYoutubeControls` and `aspectRatio: 'widescreen'`. | `false` |
| `nativeYoutubeControls` | `boolean` | Replaces the custom control/drag overlay with the native YouTube controls (fullscreen, watch on YouTube). The card is still moved by the drag handle. | `false` |
| `aspectRatio` | `'vertical'` \| `'widescreen'` | Card aspect ratio: `vertical` is 9:16 (Shorts/Reels), `widescreen` is 16:9. | `'vertical'` |
| `desktopAnchor` | `top-left` \| `top-right` \| `bottom-left` \| `bottom-right` | Initial widget anchor in desktop view. | `'bottom-right'` |
| `desktopOffsetX` | `number` | Horizontal offset in desktop view (px). | `32` |
| `desktopOffsetY` | `number` | Vertical offset in desktop view (px). | `108` |
| `mobileAnchor` | `top-left` \| `top-right` \| `bottom-left` \| `bottom-right` | Initial widget anchor in mobile view (`<1024px`). | `'bottom-right'` |
| `mobileOffsetX` | `number` | Horizontal offset in mobile view (px). | `12` |
| `mobileOffsetY` | `number` | Vertical offset in mobile view (px). | `12` |

> Note: `desktopAnchor`, `desktopOffsetX`, `desktopOffsetY`, `mobileAnchor`, `mobileOffsetX`, and `mobileOffsetY` are not exposed in Site Editor controls. Keep using code/block props for these values.

> The three display props are independent and can be combined freely. `liveMode` is only
> a convenience preset: `nativeYoutubeControls` gives you native controls while keeping
> the vertical format, and `aspectRatio: 'widescreen'` gives you 16:9 while keeping the
> custom controls.

### Notes

- The widget only renders when `shortsUrl` contains a valid YouTube video URL/ID.
- Supported formats: direct ID, `youtu.be/<id>`, `youtube.com/shorts/<id>`, `youtube.com/watch?v=<id>`, `youtube.com/embed/<id>`.
- Looping uses YouTube embed loop params and a fallback replay when the player reaches the `ended` state.
- Playback state is reset when the store SPA URL changes. Route changes are detected by
  `pathname` only: the runtime rewrites its own query string and hash, which is not
  navigation.
- Widget position is recalculated from the configured anchor/offsets on full reload and SPA route changes.
- The `history` patch that detects SPA navigation (`react/useRouteChange.ts`) is
  installed once per page, shared by every instance, and only after page load. It is
  never reverted: reverting per instance restored a stale `history.pushState` on
  remount and broke storefront navigation.
- Compact mode is considered when viewport width is lower than `1024px`, or whenever `forceCompactMode` is enabled.
- Dock mode is considered when viewport width is lower than `DOCK_ACTIVATION_MAX_WIDTH` (currently `1620` in `react/YoutubeShortsWidget.tsx`), and is always active for `aspectRatio: 'widescreen'` and for `forceCompactMode`.
- Horizontal geometry uses `getViewportWidth()` (`react/viewport.ts`) instead of `window.innerWidth`, because the latter includes the desktop scrollbar and pushes right-anchored fixed elements under it.
- Resize ranges: vertical `200–350px`; widescreen `240–1280px`. Widescreen resize is additionally capped by the available viewport height.
- With native controls, only the top/left/right edges resize the card; the bottom edge is left to the YouTube control bar.
- Position controls:
  - `desktopAnchor`, `desktopOffsetX`, `desktopOffsetY` define initial position in desktop.
  - `mobileAnchor`, `mobileOffsetX`, `mobileOffsetY` define initial position in mobile.
- Internally, dock state changes triggered by initial positioning are handled through the dock hook API (`applyDockMode`) to keep widget code decoupled from dock state internals.
- Initial position props are intentionally hidden from Site Editor and should be configured only via code/props.
- Compact interaction:
  - The video is hidden while docked; the side bubble opens it fullscreen.
  - Controls inside the embed are the native YouTube ones.
  - Dragging is enabled; edge-based resize is disabled.
- Audio on load:
  - There is no `muted` prop anymore.
  - Initial volume defaults to `20%` (`DEFAULT_INITIAL_VOLUME`).
  - If the widget loads already docked, initial volume is `0%` (muted).

## Development Log (This chat)

Implemented in this iteration:

- Refactor and internal architecture:
  - Extracted player lifecycle and controls state to `useYouTubePlayer`.
  - Extracted drag/resize interactions to `useDragResize`.
  - Extracted dock state/timers/position memo to `useDock`.
  - Moved visual hover-only button color changes to CSS `:hover` classes.
- Playback and controls:
  - Added controls visibility while paused.
  - Added top header overlay with YouTube metadata (`title`, `author`).
  - Added mobile controls auto-show/auto-hide behavior.
- Desktop/mobile behavior split:
  - Added viewport-based mode (`<1024px` = mobile).
  - Kept drag in both desktop and mobile.
  - Kept resize only on desktop.
  - Added fixed-size behavior on mobile.
- Position system:
  - Added configurable start anchors and offsets for desktop and mobile.
  - Reapply configured position on full reload and SPA route transitions.
- Visual consistency:
  - Standardized hover/transitional effects on controls to `.3s ease-in-out`.
- Mobile fullscreen:
  - Added fullscreen action button in mobile controls.
  - Uses Fullscreen API (`requestFullscreen`, with webkit fallback).

Later iteration (superseding parts of the list above):

- Added the drag handle bar under the card.
- Added `forceCompactMode`, `liveMode`, `nativeYoutubeControls` and `aspectRatio` props.
- Compact mode replaced the custom mobile control overlay with native YouTube controls,
  so the tap-to-show/auto-hide overlay and the YouTube metadata header are no longer
  rendered.
- Aspect ratio and width limits became configurable (9:16 and 16:9).
- Fixed the drag start delay and the right-edge offset caused by the desktop scrollbar.

Stability iteration (see *Mount lifecycle* above):

- Fixed a crash that unmounted the entire page tree, caused by React and the YouTube
  IFrame API both owning the `<iframe>` node.
- Fixed the SSR/client hydration mismatch.
- Replaced the per-instance `history` monkey patch with a single shared install.
- Deferred the whole mount to the page `load` event.

New files: `react/usePageReady.ts`, `react/useRouteChange.ts`.

See `docs/DEVELOPMENT_LOG.md` for the detailed record.

## Modus Operandi *(not mandatory)*

- If `startOnLoad` is disabled, users must click `Tocar para iniciar` to mount/start the player.
- Desktop controls are shown while hovering, and remain visible when paused.
- Mobile controls are shown on tap and auto-hide.
- Dragging ignores interactive elements (buttons/inputs), to avoid accidental moves while using controls.

## Customization

`In order to apply CSS customizations in this and other blocks, follow the instructions given in the recipe on [Using CSS Handles for store customization](https://vtex.io/docs/recipes/style/using-css-handles-for-store-customization).`

`No CSS Handles are available yet for the app customization.`
