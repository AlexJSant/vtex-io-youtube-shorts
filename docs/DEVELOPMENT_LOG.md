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

## Mobile expanded fullscreen (bolinha → viewport)

- After the dock bubble opens the player in expanded fullscreen, the outer card keeps `pointer-events: none` so drag logic does not capture touches; the fullscreen shell (`mobileFullscreenShellRef`) sets `pointer-events: auto` (plus `isolation: isolate` and close-button touch/compositing hints) so the close control reliably receives taps on small viewports.
- Close calls `exitMobileExpandedToDocked`: leaves expanded/fullscreen state and returns to docked UI; it does **not** set `isClosed` (iframe stays mounted), unlike the desktop `closable` X which unmounts the embed.
- Expanded close button is top-aligned with safe-area padding, anchored on the **left** (`max(10px, env(safe-area-inset-*))` for top and left).

## Schema / Config Notes

- Public schema props currently include:
  - `shortsUrl`, `startOnLoad`, `closable`, `looping`,
  - `forceCompactMode`, `liveMode`, `nativeYoutubeControls`, `aspectRatio`,
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

## Session Summary

All roadmap items below are complete, except item 5, which is an open performance
idea parked for future analysis. In short, this iteration:

1. **Drag handle** — added a full-width grip bar under the card. It became mandatory,
   not cosmetic: with native YouTube controls the iframe swallows pointer events, so
   without the handle the card could not be moved at all.
2. **Compact mode as a prop** — `forceCompactMode` enables the hidden-video + side
   bubble behavior on any screen width. `isMobile` was renamed to `isCompact` and the
   viewport measurement was separated from the behavior it drives.
3. **Live mode** — native YouTube controls (fullscreen, watch on YouTube) plus 16:9
   sizing. Later split into `nativeYoutubeControls` and `aspectRatio`, with `liveMode`
   kept as a shortcut, because testing showed the two are independent in practice.
4. **Aspect ratio parameterized** — `useDragResize` receives ratio and width limits as
   options; the ratio is no longer duplicated across files.

Fixed along the way (pre-existing bugs, not part of the original scope):

- Card width stayed stuck at the compact `150px` after leaving compact mode.
- Dragging was blocked for a fixed `180ms` window at the start of every gesture; the
  tap-vs-drag decision now uses distance instead of time.
- Right-anchored fixed elements were pushed under the desktop scrollbar (~16px),
  because horizontal geometry relied on `window.innerWidth`.

New file: `react/viewport.ts`. Default behavior is unchanged — every new capability is
opt-in and ships disabled.

## Stability Iteration — page tree crash, hydration and deferred mount

Triggered by a production report: the storefront broke completely, while the VTEX dev
workspace looked fine. Four distinct defects came out of it.

### A. The crash: React and the YouTube API fighting over one DOM node

`YT.Player#destroy()` removes its own node from the DOM. The `<iframe>` was rendered by
React, so the next removal React performed on that node threw
`NotFoundError: Failed to execute 'removeChild' on 'Node'` during commit, which takes
down the whole page tree — not just the widget.

- Reproduced by any teardown path: the `×` button, a `videoId` change, the `spaKey`
  remount on SPA navigation, and plain unmount.
- Fix: React owns a stable `<div>` host; `useYouTubePlayer` creates the `<iframe>`
  imperatively inside it. `destroy()` now acts on a node outside the reconciler.
- Teardown checks the real `parentNode` before removing anything, since the API may
  have replaced the node underneath.
- `embedUrl` joined the effect deps: the `src` used to be swapped while the player
  object went stale.
- Why dev hid it: the development build of React recovers from this class of
  divergence by re-rendering and only warns in the console; the production build
  propagates the error. The path that triggers it most is SPA navigation between
  pages, which is exercised far less in a workspace than in a real store.

### B. Hydration mismatch

`narrowViewport` / `dockViewport` were initialized from `window`, so the SSR markup was
always desktop and the client hydrated a divergent tree. Beyond the corrupted sibling
nodes in production, this has a real CPU cost: React discards the subtree and
re-renders it.

- Fix: no `window` reads in initializers. The component renders `null` until mounted,
  then measures the viewport in an effect.
- `useLayoutEffect` calls became isomorphic, and `getViewportWidth()` is SSR-safe.

### C. The `history` monkey patch

The patch was installed and reverted per instance. With two instances, or any remount,
the cleanup restored a stale `history.pushState` and storefront navigation broke
permanently. It also called `setState` synchronously inside `pushState`, i.e. in the
middle of the router's commit.

- Fix: `react/useRouteChange.ts` installs once per page, never reverts, and notifies
  subscribers in a microtask.
- Route changes compare `pathname` only. The runtime rewrites its own query string and
  hash, and treating that as navigation tore down the freshly created player.
- Installation is gated behind page load, so the widget does not touch the
  storefront's history while it is still loading.

### D. Deferred mount (`react/usePageReady.ts`)

The widget holds back until the `load` event plus one frame. Performance was the
motivation, but it also keeps the player from being born during the runtime's boot.

- Always `loading="eager"` on the iframe now. It is only created when it should already
  play, and `lazy` on a `position: fixed` card that is sometimes hidden in the dock
  risks stalling the fetch indefinitely.
- `YT.Player` is only constructed after the iframe's `load` event. Attaching the API to
  a still-loading frame loses the initial `postMessage` and the player never responds —
  a black, frozen video. A timeout caps the wait so the custom controls cannot stay
  disabled forever if `load` never fires.

### E. Regression introduced and fixed within this iteration

With `startOnLoad` enabled the video stayed black. Cause: the player effect listed the
host **ref** in its dependency array. A ref's identity never changes, so when the host
node finally entered the DOM nothing in the deps moved and the effect was never
re-executed — it had already run once, while the component still rendered `null`, bailed
out with no host, and that was it.

- With `startOnLoad` disabled the click flipped `shouldMountIframe` from `false` to
  `true`, so the dep changed and the effect re-ran correctly. That asymmetry was the
  diagnostic clue.
- Fix: the effect depends on an `isHostMounted` **value**. The host is rendered exactly
  when the component leaves its initial `null`, and `shouldMountIframe` already implies
  `videoId && !isClosed`, so the two flags cannot disagree.
- Lesson for future work here: a ref is never a valid trigger for "the node now
  exists". Use a value (or a callback ref backed by state).

### Performance audit after the iteration

- Before `load`: one `null` render and four listeners (`load`, `resize`, two
  `fullscreenchange`). No network, no iframe, no `history` patch.
- Steady state: nothing runs continuously. The only polling is the 250ms progress
  interval, alive only while hovering a ready player. `requestAnimationFrame` runs
  only during drag; edge-detection `getBoundingClientRect` only while the pointer is
  over the card.
- Net wins beyond the deferred load: the SSR payload no longer carries this block, the
  hydration re-render is gone, the `history` patch is shared instead of per instance,
  and the crash (a full-tree remount) is gone.
- Accepted trade-off: playback starts after `load` instead of during it.
- Pre-existing, unrelated, not addressed: the `resize` handler is not throttled, and
  the inline `<style>` block is duplicated per widget instance.

## Roadmap / TODOs

### 1. Drag handle bar below the card — DONE

- [x] Horizontal bar attached under the card bottom edge, dark gray background,
      centered 6-dot grip icon (`grip-horizontal` pattern, 2 rows x 3 dots).
- [x] Bar lives outside the card box (`top: 100%`), relying on card `overflow: visible`.
- [x] Bounds guard in `getResizeEdgeFromPoint`: points outside the card rect no longer
      resolve to the south edge (fixes false-positive resize and wrong hover cursor).
- [x] Handle drag starts immediately: no `LONG_PRESS_MS` wait and no tap-to-toggle
      (`pressRef` is left `null`), while dock snap on release still applies.
- [x] `bottomReservedPx` / `getMaxTop` keep the bar inside the viewport on drag,
      resize and window resize.
- [x] Bar hidden while docked (mobile/desktop), during initial layout and in mobile
      expanded fullscreen.
- [x] The bar now spans the full card width (`width: 100%`), so it tracks the card
      both on mount and while resizing. `DRAG_HANDLE_WIDTH_RATIO` and
      `DRAG_HANDLE_MIN_WIDTH_PX` were dropped; bottom radius matches the card (12px).
- [x] While the handle is visible the video shell keeps only its top corners rounded,
      so no gap shows between the video and the bar; with the handle hidden all four
      corners are rounded again. The handle carries the bottom corners, closing the
      assembly. Both share `CARD_BORDER_RADIUS_PX` so they cannot drift apart.
      Applies to both the vertical and the 16:9 modes.
- Tuning constants (if further visual changes are needed) live at the top of
  `react/YoutubeShortsWidget.tsx`: `DRAG_HANDLE_HEIGHT_PX`, `DRAG_HANDLE_BACKGROUND`,
  `DRAG_HANDLE_ICON_COLOR`, `DRAG_HANDLE_ICON_SIZE_PX`.

### 2. Prop to force compact mode on any viewport — DONE

New `forceCompactMode` schema prop (default `false`). When enabled, the video stays
hidden and is opened by the fixed bubble anchored to the right side of the viewport,
on any screen width.

- [x] `isMobile` was renamed to `isCompact` across the widget and the three hooks,
      because every one of its 38 usages had to follow the forced mode.
- [x] Viewport measurement is now separate from behavior:
      `narrowViewport` / `dockViewport` hold the raw viewport reads, and
      `isCompact = forceCompactMode || narrowViewport`,
      `isDockMode = forceCompactMode || dockViewport` are derived.
- [x] The override is applied in all three places that compute the flags:
      initial `useState`, the `resize` listener and `applyInitialPosition`
      (the latter must re-read the viewport because it runs in the layout phase).
- [x] `forceCompactMode` was added to `applyInitialPosition` deps, so toggling the
      prop in Site Editor re-runs the initial placement and docks/undocks the widget.
- [x] Dock mode is forced above `DOCK_ACTIVATION_MAX_WIDTH`, so the widget starts docked.
- [x] `MOBILE_FIXED_WIDTH` renamed to `COMPACT_FIXED_WIDTH` (150) and applied in compact
      mode on any width; leaving compact mode now restores `DEFAULT_WIDTH` (200), which
      previously stayed stuck at the reduced width.
- [x] Renames for clarity: `isMobileViewport` -> `isNarrowViewport`,
      `isMobileExpanded` -> `isFullscreenOpen`.
- Note: anchors and offsets follow `isCompact` (not the raw viewport), so the bubble
  geometry stays consistent with `dockOffsetX` and does not jump on placement.
- Note: the drag handle from item 1 is what makes the card movable in this mode, since
  native YouTube controls make the iframe swallow pointer events.
- [x] Bubble clipping outside mobile fixed at the root cause: all horizontal geometry
      used `window.innerWidth`, which **includes** the classic desktop scrollbar, so
      fixed-position elements anchored to the right edge were pushed under it (~16px)
      and the icon got clipped. Mobile uses overlay scrollbars, which is why only
      desktop was affected. New `react/viewport.ts` exports `getViewportWidth()`
      (`document.documentElement.clientWidth`), now used by the widget, `useDock` and
      `useDragResize` — they must agree on the same value or the geometry desyncs.
      The two viewport breakpoints (`< 1024`, `DOCK_ACTIVATION_MAX_WIDTH`) still use
      `innerWidth` on purpose, to stay aligned with CSS media query semantics.

### 3. Live mode — DONE

New `liveMode` schema prop (default `false`). The default Shorts behavior is unchanged.

**3a. Site Editor prop**

- [x] `liveMode` boolean added to schema and `defaultProps`.

**3b. Native YouTube controls**

- [x] `youtubeControls: isCompact || liveMode` in `buildYoutubeEmbedUrl`.
- [x] `useNativeControls = isCompact || liveMode` now gates both the custom controls
      overlay and the transparent hover-capture layer (`zIndex: 1`), which otherwise
      blocks every click meant for the player.
- [x] `modestbranding` and `rel=0` are no longer sent in live mode: `modestbranding`
      was deprecated by YouTube and stopped hiding the logo, and live mode wants the
      path to YouTube to stay visible.
- [x] Tap-to-toggle disabled in live mode (`onTapToggle`), since the player owns the
      interaction.
- [x] Native fullscreen: the widget now listens to `fullscreenchange` on the parent
      document (the iframe's fullscreen request bubbles there) and keeps the card free
      of `transform` while active, because a transformed ancestor breaks fullscreen
      positioning in some browsers. `dockCardHiddenDesktop` is suppressed meanwhile.
- Note: with native controls the iframe swallows pointer events, so the drag handle
  from item 1 is the only way to move the card in this mode.

**3c. 16:9 sizing**

- [x] `useDragResize` now receives `aspectRatioWH`, `minWidth` and `maxWidth` as
      options; its local `ASPECT_RATIO_W_H` / `MIN_WIDTH` / `MAX_WIDTH` constants were
      removed, so the ratio is no longer duplicated across files.
- [x] The hardcoded `* 16 / 9` conversions were replaced by `heightFor`/`widthFor`
      helpers derived from the active ratio; the math is equivalent for the 9:16 path.
- [x] Live constants: `LIVE_ASPECT_RATIO_W_H` (16/9), `LIVE_DEFAULT_WIDTH` (480),
      `LIVE_MIN_WIDTH` (320), `LIVE_MAX_WIDTH` (640).
- [x] Edge resize bands: with the hover layer gone, the iframe would swallow the edge
      events and resize would silently stop working. Thin strips
      (`LIVE_RESIZE_EDGE_BAND_PX`) give the top/left/right edges back to the card.
      The bottom edge is intentionally excluded — that is where the YouTube control
      bar lives — so bottom edge and bottom corners do not resize in live mode.
- [x] Validated in a real browser: native fullscreen works and the edge bands feel
      comfortable — borders disappear and the video reads well.
- [x] Widescreen always enables dock mode, regardless of viewport width:
      `isDockMode = forceCompactMode || isWidescreen || dockViewport`. A permanently
      visible horizontal video gets in the way of browsing even on large screens.
      Applied in the three places that compute the flag (derived state, `resize`
      listener and `applyInitialPosition`).
- [x] `shortsUrl` schema copy updated: title "Link do YouTube", description pointing
      to the `https://www.youtube.com/embed/{id}` format. The URL parser already
      accepted `/embed/<id>` alongside shorts, watch and youtu.be forms.

### 4. Props decomposition and drag delay fix — DONE

Practical testing showed `liveMode` was bundling two independent capabilities, so they
were split into separate props while `liveMode` stayed as a shortcut.

- [x] `liveMode` is now a preset: `isWidescreen = liveMode || aspectRatio === 'widescreen'`
      and `wantsNativeControls = liveMode || nativeYoutubeControls`.
- [x] New `nativeYoutubeControls` boolean: native player controls without forcing 16:9.
- [x] New `aspectRatio` enum (`vertical` | `widescreen`): 16:9 without native controls.
- [x] Constants renamed from `LIVE_*` to `WIDESCREEN_*` / `NATIVE_CONTROLS_EDGE_BAND_PX`,
      since they no longer belong to live mode specifically.
- [x] Widescreen resize range widened to roughly 2x: `WIDESCREEN_MIN_WIDTH` 320 -> 240
      and `WIDESCREEN_MAX_WIDTH` 640 -> 1280. Vertical limits are unchanged (200/350).
- [x] With a 1280px cap the derived height can exceed the viewport before the width
      cap is reached, so horizontal resize now also clamps by
      `widthFor(maxTopFor(0))`.
- [x] `keepYoutubeBranding` (was `liveMode`) in `buildYoutubeEmbedUrl` is driven by the
      explicit props only, so compact mode keeps its previous `rel=0` behavior.
- [x] Drag delay fixed for the whole card, not just the handle: the tap-vs-drag
      decision is now based on distance instead of time. Previously the card refused
      to move during a fixed 180ms window. `dragRef.hasMoved` flips once the pointer
      passes `TAP_MOVE_TOLERANCE_PX` and the card follows immediately; tap detection
      on release still requires no movement and `TAP_MAX_DURATION_MS` (renamed from
      `LONG_PRESS_MS`, whose meaning changed).

### 5. Evaluate `startOnLoad: false` on PDP — TODO (partially superseded)

Performance idea raised while reviewing the impact of this iteration. Deferred for a
future analysis, no work started.

> Update: the deferred mount (section D above) already removes the iframe and the
> `iframe_api` script from the initial page load, which was the whole rationale below.
> What remains of this item is narrower: with `startOnLoad: false` the iframe is never
> fetched at all unless the user asks for it, versus being fetched after `load`. The
> lever is much smaller now, so measure before changing product behavior.

- [ ] Assess shipping the PDP with `startOnLoad: false`.
      Rationale: the dominant cost of this app is the YouTube iframe plus the
      `iframe_api` script, not the widget code. With `startOnLoad: false` the iframe is
      only mounted after the user clicks "Tocar para iniciar", which removes that cost
      from the initial page load entirely. It is by far the largest performance lever
      available in the app today.
- [ ] Weigh the trade-off first: it changes the product behavior, since the video no
      longer plays by itself. Worth measuring engagement against the page-weight gain
      before deciding.
- [ ] Note: `forceCompactMode` alone does **not** achieve this. The video starts hidden
      and muted, but the iframe is still mounted when `startOnLoad` is enabled, so the
      network cost remains.

