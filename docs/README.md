📢 Use this project, [contribute](https://github.com/{OrganizationName}/{AppName}) to it or open issues to help evolve it using [Store Discussion](https://github.com/vtex-apps/store-discussion).

# YouTube Shorts Widget

<!-- DOCS-IGNORE:start -->
<!-- ALL-CONTRIBUTORS-BADGE:START - Do not remove or modify this section -->
[![All Contributors](https://img.shields.io/badge/all_contributors-0-orange.svg?style=flat-square)](#contributors-)
<!-- ALL-CONTRIBUTORS-BADGE:END -->
<!-- DOCS-IGNORE:end -->

Floating widget that renders a YouTube embed (Shorts or video) on the storefront.

Current behavior (updated):

- Draggable by any non-interactive area of the card.
- Resizable from borders/corners on desktop (keeps 9:16 aspect ratio).
- Hover controls with progress, play/pause and volume (volume slider opens vertically).
- Controls remain visible when video is paused.
- Video header (title + author/channel from YouTube metadata) appears on hover (desktop) and on tap (mobile).
- Floating `×` close button.
- Optional infinite loop playback (`looping` prop).
- Auto reset/reload when the SPA route changes.
- Dedicated mobile behavior for viewports below `1024px`:
  - Fixed widget size (no manual resize).
  - Widget remains draggable by touch.
  - Dedicated control overlay with auto-hide on tap interactions.
  - Fullscreen button for video.
- Hover visual effects use `transition: .3s ease-in-out` in interactive UI controls.

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
      "shortsUrl": "https://www.youtube.com/shorts/dQw4w9WgXcQ",
      "startOnLoad": true,
      "muted": true,
      "closable": true,
      "looping": true,
      "desktopAnchor": "bottom-right",
      "desktopOffsetX": 16,
      "desktopOffsetY": 16,
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
| `shortsUrl` | `string` | YouTube URL (Shorts or `watch?v=<id>`). | `''` |
| `startOnLoad` | `boolean` | If `true`, mounts the iframe and starts playback when the block loads. | `true` |
| `muted` | `boolean` | If `true`, starts the embed muted (helps with autoplay). | `true` |
| `closable` | `boolean` | If `true`, shows the `×` close button and allows unmounting. | `true` |
| `looping` | `boolean` | If `true`, the video restarts automatically when it ends (infinite loop). | `true` |
| `desktopAnchor` | `top-left` \| `top-right` \| `bottom-left` \| `bottom-right` | Initial widget anchor in desktop view. | `'bottom-right'` |
| `desktopOffsetX` | `number` | Horizontal offset in desktop view (px). | `16` |
| `desktopOffsetY` | `number` | Vertical offset in desktop view (px). | `16` |
| `mobileAnchor` | `top-left` \| `top-right` \| `bottom-left` \| `bottom-right` | Initial widget anchor in mobile view (`<1024px`). | `'bottom-right'` |
| `mobileOffsetX` | `number` | Horizontal offset in mobile view (px). | `12` |
| `mobileOffsetY` | `number` | Vertical offset in mobile view (px). | `12` |

### Notes

- The widget only renders when `shortsUrl` contains a valid YouTube video URL/ID.
- Supported formats: direct ID, `youtu.be/<id>`, `youtube.com/shorts/<id>`, `youtube.com/watch?v=<id>`, `youtube.com/embed/<id>`.
- Looping uses YouTube embed loop params and a fallback replay when the player reaches the `ended` state.
- Playback state is reset when the store SPA URL changes.
- Widget position is recalculated from the configured anchor/offsets on full reload and SPA route changes.
- Mobile mode is considered when viewport width is lower than `1024px`.
- Position controls:
  - `desktopAnchor`, `desktopOffsetX`, `desktopOffsetY` define initial position in desktop.
  - `mobileAnchor`, `mobileOffsetX`, `mobileOffsetY` define initial position in mobile.
- Mobile interaction:
  - Tap shows controls for a short period.
  - Fullscreen is available via dedicated control button.
  - Dragging is enabled; edge-based resize is disabled.

## Development Log (This chat)

Implemented in this iteration:

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

## Modus Operandi *(not mandatory)*

- If `startOnLoad` is disabled, users must click `Tocar para iniciar` to mount/start the player.
- Desktop controls are shown while hovering, and remain visible when paused.
- Mobile controls are shown on tap and auto-hide.
- Dragging ignores interactive elements (buttons/inputs), to avoid accidental moves while using controls.

## Customization

`In order to apply CSS customizations in this and other blocks, follow the instructions given in the recipe on [Using CSS Handles for store customization](https://vtex.io/docs/recipes/style/using-css-handles-for-store-customization).`

`No CSS Handles are available yet for the app customization.`

<!-- DOCS-IGNORE:start -->

## Contributors ✨

Thanks goes to these wonderful people:

<!-- ALL-CONTRIBUTORS-LIST:START - Do not remove or modify this section -->
<!-- prettier-ignore-start -->
<!-- markdownlint-disable -->
<!-- markdownlint-enable -->
<!-- prettier-ignore-end -->
<!-- ALL-CONTRIBUTORS-LIST:END -->

This project follows the [all-contributors](https://github.com/all-contributors/all-contributors) specification. Contributions of any kind are welcome!

<!-- DOCS-IGNORE:end -->

----
