import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import useDock from './useDock'
import useDragResize from './useDragResize'
import useYouTubePlayer from './useYouTubePlayer'

type YoutubeShortsWidgetProps = {
  /**
   * URL do YouTube (Shorts ou URL de vídeo). Ex: https://www.youtube.com/shorts/<id>
   * ou https://www.youtube.com/watch?v=<id>
   */
  shortsUrl: string
  /** Se true, monta o iframe assim que o componente carregar na PDP. */
  startOnLoad: boolean
  /** Se true, mostra o botão X e permite “matar” o iframe (unmount). */
  closable: boolean
  /** Se true, ao terminar o vídeo ele reinicia automaticamente em loop. */
  looping: boolean
  /** Âncora inicial no desktop. */
  desktopAnchor: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'
  /** Distância horizontal inicial no desktop (px). */
  desktopOffsetX: number
  /** Distância vertical inicial no desktop (px). */
  desktopOffsetY: number
  /** Âncora inicial no mobile (<1024px). */
  mobileAnchor: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'
  /** Distância horizontal inicial no mobile (px). */
  mobileOffsetX: number
  /** Distância vertical inicial no mobile (px). */
  mobileOffsetY: number
}

type Pos = { left: number; top: number }
type Anchor = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n))
}

function isMobileViewport() {
  if (typeof window === 'undefined') return false
  return window.innerWidth < 1024
}

// Regra para ativar o comportamento de “doca escondida”.
const DOCK_ACTIVATION_MAX_WIDTH = 1620
const ASPECT_RATIO_W_H = 9 / 16
const MOBILE_FIXED_WIDTH = 150
const DOCK_VISIBLE_SLICE_RATIO = 0.35
const DOCK_VISIBLE_SLICE_MIN_PX = 52
const DEFAULT_INITIAL_VOLUME = 20

/**
 * Mobile — “bolinha cinza” quando o widget está acoplado (doca).
 * Ajuste tamanho, cor e deslocamento fino em relação à borda direita do card.
 */
const MOBILE_DOCK_BUBBLE_SIZE_PX = 72
const MOBILE_DOCK_BUBBLE_OFFSET_X_PX = 20
const MOBILE_DOCK_BUBBLE_OFFSET_Y_PX = 0
const MOBILE_DOCK_BUBBLE_BACKGROUND = 'rgba(0,0,0,0.35)'
const MOBILE_DOCK_BUBBLE_ICON_SIZE_PX = 28
/** Camada mobile “tela cheia” (acima da bolinha zIndex 10000). */
const MOBILE_EXPAND_Z = 100005
const MOBILE_EXPAND_CLOSE_Z = 100006

function DockBubbleIcon({ sizePx }: { sizePx: number }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={sizePx}
      height={sizePx}
      fill="currentColor"
      viewBox="0 0 16 16"
      style={{ pointerEvents: 'none' }}
    >
      {/* <path d="M2.5 3.5a.5.5 0 0 1 0-1h11a.5.5 0 0 1 0 1zm2-2a.5.5 0 0 1 0-1h7a.5.5 0 0 1 0 1zM0 13a1.5 1.5 0 0 0 1.5 1.5h13A1.5 1.5 0 0 0 16 13V6a1.5 1.5 0 0 0-1.5-1.5h-13A1.5 1.5 0 0 0 0 6zm6.258-6.437a.5.5 0 0 1 .507.013l4 2.5a.5.5 0 0 1 0 .848l-4 2.5A.5.5 0 0 1 6 12V7a.5.5 0 0 1 .258-.437" /> */}
      <path d="M0 12V4a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2m6.79-6.907A.5.5 0 0 0 6 5.5v5a.5.5 0 0 0 .79.407l3.5-2.5a.5.5 0 0 0 0-.814z" />
    </svg>
  )
}

function isDockModeViewport() {
  if (typeof window === 'undefined') return false
  return window.innerWidth < DOCK_ACTIVATION_MAX_WIDTH
}

function getInitialPosFromAnchor(
  anchor: Anchor,
  offsetX: number,
  offsetY: number,
  width: number,
  height: number,
): Pos {
  const maxLeft = Math.max(0, window.innerWidth - width)
  const maxTop = Math.max(0, window.innerHeight - height)

  const left = anchor.includes('right')
    ? window.innerWidth - width - offsetX
    : offsetX
  const top = anchor.includes('bottom')
    ? window.innerHeight - height - offsetY
    : offsetY

  return {
    left: clamp(left, 0, maxLeft),
    top: clamp(top, 0, maxTop),
  }
}

function isValidYoutubeVideoId(id: string) {
  // YouTube IDs são base64url-like e tipicamente têm 11 caracteres.
  return /^[a-zA-Z0-9_-]{11}$/.test(id)
}

function extractYoutubeVideoId(input: string): string | null {
  const raw = (input || '').trim()
  if (!raw) return null

  // Caso o editor já cole o próprio ID.
  if (isValidYoutubeVideoId(raw)) return raw

  let url: URL | null = null
  try {
    url = new URL(raw)
  } catch {
    return null
  }

  const host = url.hostname.replace(/^www\./, '').toLowerCase()
  const path = url.pathname
  const segments = path.split('/').filter(Boolean)

  // youtu.be/<id>
  if (host === 'youtu.be' && segments.length >= 1) {
    const id = segments[0]
    return isValidYoutubeVideoId(id) ? id : null
  }

  const isYoutubeHost =
    host === 'youtube.com' ||
    host === 'm.youtube.com' ||
    host === 'music.youtube.com' ||
    host.endsWith('.youtube.com')

  if (!isYoutubeHost) return null

  // youtube.com/shorts/<id>
  if (segments[0] === 'shorts' && segments.length >= 2) {
    const id = segments[1]
    return isValidYoutubeVideoId(id) ? id : null
  }

  // youtube.com/embed/<id>
  if (segments[0] === 'embed' && segments.length >= 2) {
    const id = segments[1]
    return isValidYoutubeVideoId(id) ? id : null
  }

  // watch?v=<id>
  const v = url.searchParams.get('v')
  if (v && isValidYoutubeVideoId(v)) return v

  return null
}

function buildYoutubeEmbedUrl(
  videoId: string,
  options: {
    muted: boolean
    autoplay: boolean
    looping: boolean
    origin?: string
    /** No mobile usamos controles nativos do player. */
    youtubeControls: boolean
  },
) {
  const params = new URLSearchParams()
  if (options.autoplay) params.set('autoplay', '1')
  if (options.muted) params.set('mute', '1')
  if (options.looping) {
    params.set('loop', '1')
    params.set('playlist', videoId)
  }

  params.set('playsinline', '1')
  params.set('modestbranding', '1')
  params.set('rel', '0')
  params.set('showinfo', '0')
  params.set('controls', options.youtubeControls ? '1' : '0')
  params.set('enablejsapi', '1')
  if (options.origin) params.set('origin', options.origin)

  return `https://www.youtube.com/embed/${videoId}?${params.toString()}`
}

const YoutubeShortsWidget: any = ({
  shortsUrl,
  startOnLoad,
  closable,
  looping,
  desktopAnchor,
  desktopOffsetX,
  desktopOffsetY,
  mobileAnchor,
  mobileOffsetX,
  mobileOffsetY,
}: YoutubeShortsWidgetProps) => {
  const cardRef = useRef<HTMLDivElement | null>(null)
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const mobileFullscreenShellRef = useRef<HTMLDivElement | null>(null)

  const [size, setSize] = useState<{ width: number; height: number }>(() => ({
    // width: 280,
    // height: Math.round(280 / ASPECT_RATIO_W_H),
    width: 200,
    height: Math.round(200 / ASPECT_RATIO_W_H),
  }))

  const videoId = useMemo(() => extractYoutubeVideoId(shortsUrl), [shortsUrl])

  const [isClosed, setIsClosed] = useState(false)
  const [isPlaying, setIsPlaying] = useState(false)

  const [spaKey, setSpaKey] = useState(0)
  const [isHovering, setIsHovering] = useState(false)
  const [isVolumeHovering, setIsVolumeHovering] = useState(false)
  const [isMobile, setIsMobile] = useState<boolean>(() => isMobileViewport())
  const [isDockMode, setIsDockMode] = useState<boolean>(() => isDockModeViewport())
  /** Mobile: vídeo em modo tela cheia (viewport), após toque na bolinha da doca. */
  const [isMobileExpanded, setIsMobileExpanded] = useState(false)

  // Posição do card (fixo com scroll).
  const [pos, setPos] = useState<Pos>({ left: 16, top: 16 })
  /** Só libera o card visualmente após o primeiro posicionamento (evita flash no canto inicial). */
  const [layoutCardReady, setLayoutCardReady] = useState(false)
  const posRef = useRef(pos)
  posRef.current = pos

  const rafRef = useRef<number | null>(null)
  const setPosThrottled = useCallback((next: Pos) => {
    posRef.current = next
    if (rafRef.current != null) return
    rafRef.current = window.requestAnimationFrame(() => {
      rafRef.current = null
      setPos(posRef.current)
    })
  }, [])

  const showMobileControls = useCallback(() => { }, [])

  // Reset correto em SPA quando trocar de PDP (props mudam).
  useEffect(() => {
    setIsClosed(false)
    setIsPlaying(false)
    setIsMobileExpanded(false)
  }, [shortsUrl, startOnLoad])

  // Recarrega quando a página do SPA trocar (mesmo que `shortsUrl` não mude).
  useEffect(() => {
    if (typeof window === 'undefined') return

    let lastHref = window.location.href

    const resetForRouteChange = () => {
      const nextHref = window.location.href
      if (nextHref === lastHref) return
      lastHref = nextHref

      setSpaKey((k) => k + 1)
      setIsClosed(false)
      setIsPlaying(false)
      setIsMobileExpanded(false)
    }

    const onPopState = () => resetForRouteChange()
    window.addEventListener('popstate', onPopState)

    const originalPushState = history.pushState
    const originalReplaceState = history.replaceState

    // Monkey patch simples para capturar mudanças de rota.
    // (Usamos arrow function para evitar erro de TS sobre `this` implícito.)
    history.pushState = ((...args: any[]) => {
      const ret = originalPushState.apply(history, args as any)
      resetForRouteChange()
      return ret
    }) as any

    history.replaceState = ((...args: any[]) => {
      const ret = originalReplaceState.apply(history, args as any)
      resetForRouteChange()
      return ret
    }) as any

    return () => {
      window.removeEventListener('popstate', onPopState)
      history.pushState = originalPushState
      history.replaceState = originalReplaceState
    }
  }, [])

  const dockOffsetX = isMobile ? mobileOffsetX : desktopOffsetX

  const {
    isDocked,
    isDockHovering,
    isDockedRef,
    dockPos,
    dockPosRef,
    dockHoverIgnoreUntilRef,
    cancelDockHide,
    scheduleDockHide,
    applyDockMode,
    setIsDocked,
    setIsDockHovering,
  } = useDock({
    isDockMode,
    isMobile,
    dockOffsetX,
    size,
    pos,
  })

  const applyInitialPosition = useCallback(() => {
    if (!cardRef.current) return
    const rect = cardRef.current.getBoundingClientRect()
    const width = rect.width || 280
    const height = rect.height || 480
    const mobile = isMobileViewport()
    const dockModeNow = isDockModeViewport()
    const anchor = mobile ? mobileAnchor : desktopAnchor
    const offsetX = mobile ? mobileOffsetX : desktopOffsetX
    const offsetY = mobile ? mobileOffsetY : desktopOffsetY
    if (dockModeNow) {
      // Lado direito da tela, centralizado verticalmente
      const left = window.innerWidth - width - offsetX
      const top = (window.innerHeight - height) / 2
      setPos({ left: clamp(left, 0, window.innerWidth - width), top: clamp(top, 0, window.innerHeight - height) })
      applyDockMode(true)
    } else {
      setPos(getInitialPosFromAnchor(anchor, offsetX, offsetY, width, height))
      applyDockMode(false)
    }
  }, [
    applyDockMode,
    desktopAnchor,
    desktopOffsetX,
    desktopOffsetY,
    mobileAnchor,
    mobileOffsetX,
    mobileOffsetY,
  ])

  // Ajuste inicial para posição configurada (layout phase → antes do paint quando possível).
  useLayoutEffect(() => {
    if (typeof window === 'undefined') return

    setLayoutCardReady(false)

    let raf = 0
    const run = () => {
      applyInitialPosition()
      setLayoutCardReady(true)
    }

    if (cardRef.current) {
      run()
    } else {
      raf = window.requestAnimationFrame(() => {
        raf = 0
        run()
      })
    }

    return () => {
      if (raf) window.cancelAnimationFrame(raf)
    }
  }, [videoId, spaKey, applyInitialPosition])

  // Re-clamp em resize.
  useEffect(() => {
    const onResize = () => {
      const mobileNow = isMobileViewport()
      const dockModeNow = isDockModeViewport()
      setIsMobile(mobileNow)
      setIsDockMode(dockModeNow)
      if (!dockModeNow) {
        setIsDocked(false)
        setIsDockHovering(false)
      }
      if (mobileNow) {
        const safeWidth = Math.max(140, Math.min(MOBILE_FIXED_WIDTH, window.innerWidth - 24))
        const nextHeight = Math.round(safeWidth / ASPECT_RATIO_W_H)
        setSize({ width: safeWidth, height: nextHeight })
      }
      if (!cardRef.current) return
      const rect = cardRef.current.getBoundingClientRect()
      const width = rect.width || 280
      const height = rect.height || 480
      const maxLeft = Math.max(0, window.innerWidth - width)
      const maxTop = Math.max(0, window.innerHeight - height)
      setPos((p) => ({
        left: clamp(p.left, 0, maxLeft),
        top: clamp(p.top, 0, maxTop),
      }))
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  useEffect(() => {
    if (!isMobile) return
    const safeWidth = Math.max(140, Math.min(MOBILE_FIXED_WIDTH, window.innerWidth - 24))
    const nextHeight = Math.round(safeWidth / ASPECT_RATIO_W_H)
    setSize({ width: safeWidth, height: nextHeight })
  }, [isMobile])

  // A dock “fecha” o card quando estiver acoplado.
  // - mobile: esconde tudo (mantém apenas a bolinha cinza)
  // - desktop: mostra só um sliver até passar o mouse na alça
  const dockCardHiddenForUI =
    isDockMode && isDocked && (isMobile ? true : !isDockHovering)

  // Observação: não reposicionamos o widget para o dock quando ele esconde.
  // Assim, após arrastar e soltar, “tirar o mouse” não força snap de volta.

  // Bolinha mobile: encostada na borda direita do card (doca), centralizada na vertical.
  const mobileDockBubbleSize = Math.max(44, Math.min(MOBILE_DOCK_BUBBLE_SIZE_PX, size.height))
  const mobileDockBubbleLeft =
    dockPos.left + (size.width - mobileDockBubbleSize) + MOBILE_DOCK_BUBBLE_OFFSET_X_PX
  const mobileDockBubbleTop =
    dockPos.top + (size.height - mobileDockBubbleSize) / 2 + MOBILE_DOCK_BUBBLE_OFFSET_Y_PX

  const shouldMountIframe = !!videoId && !isClosed && (startOnLoad || isPlaying)
  const autoplay = startOnLoad || isPlaying

  const embedUrl = useMemo(() => {
    if (!videoId) return null
    const origin = typeof window !== 'undefined' ? window.location.origin : undefined
    return buildYoutubeEmbedUrl(videoId, {
      muted: false,
      autoplay,
      looping,
      origin,
      youtubeControls: isMobile,
    })
  }, [videoId, autoplay, looping, isMobile])

  const onClose = useCallback(() => {
    setIsClosed(true)
    setIsPlaying(false)
  }, [])

  const onPlay = useCallback(() => {
    setIsPlaying(true)
  }, [])

  const {
    playerReady,
    isVideoPlaying,
    progress,
    volume,
    togglePlayPause,
    onSeekFromPercent,
    onVolumeChange,
    pauseVideo,
    playVideo,
  } = useYouTubePlayer({
    shouldMountIframe,
    iframeRef: iframeRef as React.RefObject<HTMLIFrameElement>,
    videoId,
    spaKey,
    looping,
    initialVolume: DEFAULT_INITIAL_VOLUME,
    startOnLoad,
    isPlaying,
    isHovering,
    isMobile,
    showMobileControls,
  })

  const appliedLoadVolumeRef = useRef(false)

  useEffect(() => {
    if (!shouldMountIframe) {
      appliedLoadVolumeRef.current = false
      return
    }
    if (!playerReady) return
    if (appliedLoadVolumeRef.current) return

    const loadVolume = isDockMode && isDocked ? 0 : DEFAULT_INITIAL_VOLUME
    onVolumeChange(loadVolume)
    appliedLoadVolumeRef.current = true
  }, [isDockMode, isDocked, onVolumeChange, playerReady, shouldMountIframe])

  const {
    resizeCursor,
    onPointerDownCard,
    onPointerMoveCard,
    onPointerUpCard,
  } = useDragResize({
    cardRef,
    posRef,
    setPosThrottled,
    size,
    setSize,
    isMobile,
    isDockMode,
    isVideoPlaying,
    dockPosRef,
    isDockedRef,
    setIsDocked,
    setIsDockHovering,
    setPos,
    onTapToggle: isMobile ? undefined : togglePlayPause,
  })

  const exitMobileExpandedToDocked = useCallback(() => {
    const doc = document as any
    try {
      doc.exitFullscreen?.()
      doc.webkitExitFullscreen?.()
    } catch {
      // noop
    }
    setIsMobileExpanded(false)
    setIsDocked(true)
    pauseVideo()
  }, [pauseVideo, setIsDocked])

  useLayoutEffect(() => {
    if (!isMobile || !isMobileExpanded) return
    const el = mobileFullscreenShellRef.current as any
    if (!el) return
    const doc = document as any
    const tryEnter = () => {
      try {
        if (doc.fullscreenElement || doc.webkitFullscreenElement) return
        el.requestFullscreen?.()
        el.webkitRequestFullscreen?.()
      } catch {
        // noop
      }
    }
    tryEnter()
    requestAnimationFrame(tryEnter)
  }, [isMobile, isMobileExpanded])

  useEffect(() => {
    if (isMobile && isDocked) setIsMobileExpanded(false)
  }, [isMobile, isDocked])

  useEffect(() => {
    if (!isMobile || !isDockMode || !isDocked || !playerReady) return
    pauseVideo()
  }, [isMobile, isDockMode, isDocked, playerReady, pauseVideo])

  useEffect(() => {
    if (!isMobile || !isMobileExpanded) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [isMobile, isMobileExpanded])

  useEffect(() => {
    if (!isMobile || !isMobileExpanded || !playerReady) return
    playVideo()
  }, [isMobile, isMobileExpanded, playerReady, playVideo])

  const progressPercent = progress.duration
    ? clamp(progress.currentTime / progress.duration, 0, 1) * 100
    : 0
  const dockCardHiddenMobile = isDockMode && isMobile && isDocked
  const dockCardHiddenDesktop = !isMobile && isDockMode && isDocked && !isDockHovering
  const layoutCardHidden = !layoutCardReady
  const dockVisibleSliceWidth = Math.max(
    DOCK_VISIBLE_SLICE_MIN_PX,
    Math.round(size.width * DOCK_VISIBLE_SLICE_RATIO),
  )
  const dockHiddenTranslateXPx = dockCardHiddenDesktop
    ? Math.max(0, size.width - dockVisibleSliceWidth)
    : 0

  // Quando a doca está “fechada”, evita mostrar overlays (header/controls).
  // No mobile os controles são nativos do YouTube (`controls=1` no embed).
  const shouldShowControls =
    shouldMountIframe &&
    !dockCardHiddenForUI &&
    !isMobile &&
    (isHovering || !isVideoPlaying)

  if (!videoId) return null
  if (isClosed) return null

  return (
    <>
      <style>{`
        .ytw-btn-close { color: #fff; }
        .ytw-btn-play { color: #fff; }
        .ytw-btn-volume { color: #fff; }
        .ytw-btn-close:hover { color: #f90041; }
        .ytw-btn-play:not(:disabled):hover { color: #FFDA00; }
        .ytw-btn-volume:not(:disabled):hover { color: #FFDA00; }
      `}</style>
      {/* Desktop: alça transparente para revelar o widget quando estiver acoplado */}
      {isDockMode && !isMobile && isDocked ? (
        <div
          data-no-drag="true"
          aria-hidden="true"
          onMouseEnter={() => {
            cancelDockHide()
            if (performance.now() < dockHoverIgnoreUntilRef.current) return
            setIsDockHovering(true)
          }}
          onMouseLeave={() => {
            scheduleDockHide()
          }}
          style={{
            position: 'fixed',
            left: dockPos.left + (size.width - dockVisibleSliceWidth),
            top: dockPos.top,
            width: dockVisibleSliceWidth,
            height: size.height,
            zIndex: 10000,
            pointerEvents: dockCardHiddenDesktop ? 'auto' : 'none',
            background: 'transparent',
            cursor: 'pointer',
          }}
        />
      ) : null}

      {/* Dock: mobile mostra bolinha cinza. Acima de 1024 revela sliver (desktop). */}
      {isDockMode && isMobile && isDocked ? (
        <div
          data-no-drag="true"
          role="button"
          aria-label="Abrir em tela cheia"
          onClick={() => {
            setIsDocked(false)
            setIsMobileExpanded(true)
          }}
          style={{
            position: 'fixed',
            left: mobileDockBubbleLeft,
            top: mobileDockBubbleTop,
            width: mobileDockBubbleSize,
            height: mobileDockBubbleSize,
            // zIndex: 10000,
            zIndex: 999,
            pointerEvents: 'auto',
            background: MOBILE_DOCK_BUBBLE_BACKGROUND,
            // borderRadius: 999,
            borderRadius: '50px 0 0 50px',
            boxShadow: '0 0 0 1px rgba(255,255,255,0.08) inset',
            cursor: 'pointer',
            opacity: 1,
            transition: 'opacity .2s ease-in-out',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 4,
          }}
        >
          <div
            data-no-drag="true"
            style={{
              color: '#fff',
              fontWeight: 800,
              lineHeight: 1,
              opacity: 0.95,
              textShadow: '0 1px 2px rgba(0,0,0,0.45)',
              userSelect: 'none',
              whiteSpace: 'nowrap',
            }}
          >
            <DockBubbleIcon sizePx={MOBILE_DOCK_BUBBLE_ICON_SIZE_PX} />
          </div>
        </div>
      ) : null}

      <div
        ref={cardRef}
        style={{
          position: 'fixed',
          left: pos.left,
          top: pos.top,
          width: size.width,
          height: size.height,
          zIndex: 9999,
          overflow: 'visible',
          background: 'transparent',
          touchAction: 'none',
          cursor: isMobile ? 'grab' : resizeCursor || 'grab',
          transform:
            dockHiddenTranslateXPx > 0
              ? `translateX(${dockHiddenTranslateXPx}px)`
              : 'none',
          opacity: layoutCardHidden ? 0 : dockCardHiddenMobile ? 0 : 1,
          visibility: layoutCardHidden ? 'hidden' : 'visible',
          pointerEvents:
            layoutCardHidden || dockCardHiddenMobile || dockCardHiddenDesktop
              ? 'none'
              : isMobile && isMobileExpanded
                ? 'none'
                : 'auto',
          transition: 'transform .2s ease-in-out, opacity .2s ease-in-out',
        }}
        aria-hidden={layoutCardHidden ? true : undefined}
        aria-label="YouTube Shorts widget"
        onMouseEnter={() => {
          setIsHovering(true)
          if (isDockMode && isDockedRef.current) {
            cancelDockHide()
            if (performance.now() >= dockHoverIgnoreUntilRef.current) {
              setIsDockHovering(true)
            }
          }
        }}
        onMouseLeave={() => {
          setIsHovering(false)
          setIsVolumeHovering(false)

          if (isDockMode && isDockedRef.current) scheduleDockHide()
        }}
        onPointerDown={onPointerDownCard}
        onPointerMove={onPointerMoveCard}
        onPointerUp={onPointerUpCard}
      >
        {closable && !(isMobile && isMobileExpanded) ? (
          <button
            type="button"
            data-no-drag="true"
            className="ytw-btn-close"
            onClick={onClose}
            aria-label="Fechar"
            title="Fechar"
            style={{
              position: 'absolute',
              // left: -12,
              // top: -10,
              left: -14,
              top: -14,
              zIndex: 10000,
              width: 32,
              height: 32,
              borderRadius: 999,
              // border: '1px solid rgba(255,255,255,0.25)',
              border: 'none',
              // background: 'rgba(0,0,0,0.6)',
              // background: 'unset',
              background: '#1614133d',
              // color: '#fff',
              cursor: 'pointer',
              padding: 0,
              transition: 'color .3s ease-in-out',
              // fontSize: 16,
              lineHeight: '32px',
              boxShadow: '0 0 8px #1614133d',
            }}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" fill="currentColor" viewBox="0 0 16 16" style={{ pointerEvents: 'none' }}>
              <path d="M16 8A8 8 0 1 1 0 8a8 8 0 0 1 16 0M5.354 4.646a.5.5 0 1 0-.708.708L7.293 8l-2.647 2.646a.5.5 0 0 0 .708.708L8 8.707l2.646 2.647a.5.5 0 0 0 .708-.708L8.707 8l2.647-2.646a.5.5 0 0 0-.708-.708L8 7.293z" />
            </svg>
          </button>
        ) : null}

        <div
          ref={mobileFullscreenShellRef}
          style={{
            width: '100%',
            height: '100%',
            borderRadius: isMobile && isMobileExpanded ? 0 : 12,
            overflow: 'hidden',
            position: isMobile && isMobileExpanded ? 'fixed' : 'relative',
            background: '#000',
            // Com o card em `pointer-events: none` no mobile expandido, o hit-test ignora
            // o card inteiro a menos que este shell reabilite toques (MDN: filhos precisam
            // de `pointer-events: auto` explícito).
            pointerEvents: isMobile && isMobileExpanded ? 'auto' : undefined,
            isolation: isMobile && isMobileExpanded ? 'isolate' : undefined,
            ...(isMobile && isMobileExpanded
              ? {
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                width: '100vw',
                height: '100dvh',
                zIndex: MOBILE_EXPAND_Z,
                boxSizing: 'border-box' as const,
              }
              : {}),
          }}
        >
          {isMobile && isMobileExpanded ? (
            <button
              type="button"
              data-no-drag="true"
              onClick={(e) => {
                e.stopPropagation()
                exitMobileExpandedToDocked()
              }}
              onPointerDown={(e) => e.stopPropagation()}
              aria-label="Sair da tela cheia e ocultar"
              title="Fechar"
              style={{
                position: 'absolute',
                top: 'max(10px, env(safe-area-inset-top, 0px))',
                left: 'max(10px, env(safe-area-inset-left, 0px))',
                zIndex: MOBILE_EXPAND_CLOSE_Z,
                width: 44,
                height: 44,
                borderRadius: 999,
                border: 'none',
                background: 'rgba(0,0,0,0.55)',
                color: '#fff',
                cursor: 'pointer',
                padding: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: '0 2px 12px rgba(0,0,0,0.35)',
                pointerEvents: 'auto',
                touchAction: 'manipulation',
                WebkitTapHighlightColor: 'transparent',
                transform: 'translateZ(0)',
              }}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="28"
                height="28"
                fill="currentColor"
                viewBox="0 0 16 16"
                style={{ pointerEvents: 'none' }}
              >
                <path d="M2.146 2.854a.5.5 0 1 1 .708-.708L8 7.293l5.146-5.147a.5.5 0 0 1 .708.708L8.707 8l5.147 5.146a.5.5 0 0 1-.708.708L8 8.707l-5.146 5.147a.5.5 0 0 1-.708-.708L7.293 8z" />
              </svg>
            </button>
          ) : null}
          {shouldMountIframe && embedUrl ? (
            <iframe
              key={`${videoId}-${spaKey}`}
              title="YouTube Shorts"
              src={embedUrl}
              ref={iframeRef}
              id={`ytw-${videoId}-${spaKey}`}
              style={{
                position: 'absolute',
                zIndex: 0,
                inset: 0,
                width: '100%',
                height: '100%',
                border: 0,
              }}
              allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
              allowFullScreen
              loading={startOnLoad ? 'eager' : 'lazy'}
              referrerPolicy="strict-origin-when-cross-origin"
            />
          ) : (
            <button
              type="button"
              onClick={onPlay}
              data-no-drag="true"
              aria-label="Iniciar vídeo"
              style={{
                position: 'absolute',
                inset: 0,
                border: 0,
                cursor: 'pointer',
                background:
                  'linear-gradient(135deg, rgba(255,255,255,0.08), rgba(255,255,255,0.02))',
                color: 'white',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: 16,
                fontWeight: 700,
              }}
            >
              Tocar para iniciar
            </button>
          )}

          {/* Desktop: camada que captura hover; no mobile o toque vai ao iframe (controles nativos). */}
          {shouldMountIframe && !isMobile ? (
            <div
              aria-hidden="true"
              style={{
                position: 'absolute',
                inset: 0,
                zIndex: 1,
                background: 'transparent',
              }}
            />
          ) : null}

          {shouldMountIframe && !isMobile ? (
            <div
              style={{
                position: 'absolute',
                inset: 0,
                zIndex: 3,
                background: 'transparent',
                opacity: shouldShowControls ? 1 : 0,
                transition: 'opacity .3s ease-in-out',
                pointerEvents: shouldShowControls ? 'auto' : 'none',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'flex-end',
              }}
            >
              <div
                style={{
                  padding: 8,
                  paddingBottom: 10,
                  background: 'linear-gradient(180deg, rgba(0,0,0,0) 0%, rgba(0,0,0,0.72) 100%)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {/* Botão play/pause */}
                  <button
                    type="button"
                    data-no-drag="true"
                    className="ytw-btn-play"
                    onClick={togglePlayPause}
                    disabled={!playerReady}
                    aria-label={isVideoPlaying ? 'Pause' : 'Play'}
                    style={{
                      pointerEvents: 'auto',
                      width: 32,
                      height: 32,
                      flexShrink: 0,
                      borderRadius: 999,
                      border: '1px solid rgba(255,255,255,0.25)',
                      background: 'rgba(0,0,0,0.55)',
                      // color: '#fff',
                      cursor: playerReady ? 'pointer' : 'not-allowed',
                      fontWeight: 800,
                      // fontSize: 16,
                      // lineHeight: '32px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      transition: 'all .3s ease-in-out',
                    }}
                  >
                    {/* {isVideoPlaying ? '||' : '>'} */}
                    {isVideoPlaying ? (
                      <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" fill="currentColor" viewBox="0 0 16 16" style={{ pointerEvents: 'none', verticalAlign: 'middle' }}><path d="M5.5 3.5A1.5 1.5 0 0 1 7 5v6a1.5 1.5 0 0 1-3 0V5a1.5 1.5 0 0 1 1.5-1.5m5 0A1.5 1.5 0 0 1 12 5v6a1.5 1.5 0 0 1-3 0V5a1.5 1.5 0 0 1 1.5-1.5" /></svg>
                    ) : (
                      <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" fill="currentColor" viewBox="0 0 16 16" style={{ pointerEvents: 'none', verticalAlign: 'middle' }}><path d="m11.596 8.697-6.363 3.692c-.54.313-1.233-.066-1.233-.697V4.308c0-.63.692-1.01 1.233-.696l6.363 3.692a.802.802 0 0 1 0 1.393" /></svg>
                    )}
                  </button>

                  {/* Componente único de volume: bolinha -> expande no hover */}
                  <div
                    data-no-drag="true"
                    onMouseEnter={() => setIsVolumeHovering(true)}
                    onMouseLeave={() => setIsVolumeHovering(false)}
                    style={{
                      position: 'relative',
                      width: 36,
                      height: 32,
                      flexShrink: 0,
                      pointerEvents: 'auto',
                    }}
                  >
                    <div
                      style={{
                        position: 'absolute',
                        left: 0,
                        bottom: 0,
                        width: 36,
                        height: isVolumeHovering ? 162 : 32,
                        borderRadius: isVolumeHovering ? 18 : 999,
                        border: '1px solid rgba(255,255,255,0.25)',
                        background: 'rgba(0,0,0,0.55)',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'flex-end',
                        overflow: 'hidden',
                        transition: 'height .22s ease-in-out, border-radius .22s ease-in-out, background .3s ease-in-out, border-color .3s ease-in-out',
                      }}
                    >
                      <div
                        style={{
                          width: 36,
                          height: isVolumeHovering ? 120 : 0,
                          padding: isVolumeHovering ? 8 : 0,
                          borderBottom: isVolumeHovering ? '1px solid rgba(255,255,255,0.14)' : 'none',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          opacity: isVolumeHovering ? 1 : 0,
                          transition: 'height .22s ease-in-out, opacity .18s ease-in-out, padding .22s ease-in-out',
                        }}
                      >
                        <input
                          data-no-drag="true"
                          type="range"
                          className="ytw-range-volume"
                          min={0}
                          max={100}
                          step={1}
                          value={volume}
                          disabled={!playerReady}
                          onChange={(e) =>
                            onVolumeChange(Number((e.target as HTMLInputElement).value))
                          }
                          style={{
                            accentColor: '#fff',
                            width: 120,
                            transform: 'rotate(-90deg)',
                            transformOrigin: 'center',
                          }}
                          aria-label="Volume (vertical)"
                        />
                      </div>

                      <button
                        type="button"
                        data-no-drag="true"
                        className="ytw-btn-volume"
                        onClick={() => {
                          if (!playerReady) return
                          const next = volume > 0 ? 0 : 50
                          onVolumeChange(next)
                        }}
                        disabled={!playerReady}
                        aria-label="Volume"
                        style={{
                          width: 32,
                          height: 32,
                          borderRadius: 999,
                          border: 'none',
                          background: 'transparent',
                          // color: '#fff',
                          cursor: playerReady ? 'pointer' : 'not-allowed',
                          fontWeight: 800,
                          fontSize: 14,
                          // lineHeight: '32px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          flexShrink: 0,
                          transition: 'all .3s ease-in-out',
                        }}
                      >
                        {/* {volume === 0 ? 'M' : 'V'} */}
                        {volume === 0 ? (
                          <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" fill="currentColor" viewBox="0 0 16 16" style={{ pointerEvents: 'none', verticalAlign: 'middle' }}><path d="M6.717 3.55A.5.5 0 0 1 7 4v8a.5.5 0 0 1-.812.39L3.825 10.5H1.5A.5.5 0 0 1 1 10V6a.5.5 0 0 1 .5-.5h2.325l2.363-1.89a.5.5 0 0 1 .529-.06m7.137 2.096a.5.5 0 0 1 0 .708L12.207 8l1.647 1.646a.5.5 0 0 1-.708.708L11.5 8.707l-1.646 1.647a.5.5 0 0 1-.708-.708L10.793 8 9.146 6.354a.5.5 0 1 1 .708-.708L11.5 7.293l1.646-1.647a.5.5 0 0 1 .708 0" /></svg>
                        ) : (
                          <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" fill="currentColor" viewBox="0 0 16 16" style={{ pointerEvents: 'none', verticalAlign: 'middle' }}>
                            <path d="M11.536 14.01A8.47 8.47 0 0 0 14.026 8a8.47 8.47 0 0 0-2.49-6.01l-.708.707A7.48 7.48 0 0 1 13.025 8c0 2.071-.84 3.946-2.197 5.303z" />
                            <path d="M10.121 12.596A6.48 6.48 0 0 0 12.025 8a6.48 6.48 0 0 0-1.904-4.596l-.707.707A5.48 5.48 0 0 1 11.025 8a5.48 5.48 0 0 1-1.61 3.89z" />
                            <path d="M8.707 11.182A4.5 4.5 0 0 0 10.025 8a4.5 4.5 0 0 0-1.318-3.182L8 5.525A3.5 3.5 0 0 1 9.025 8 3.5 3.5 0 0 1 8 10.475zM6.717 3.55A.5.5 0 0 1 7 4v8a.5.5 0 0 1-.812.39L3.825 10.5H1.5A.5.5 0 0 1 1 10V6a.5.5 0 0 1 .5-.5h2.325l2.363-1.89a.5.5 0 0 1 .529-.06" />
                          </svg>
                        )}
                      </button>
                    </div>
                  </div>

                  {/* Barra de progresso (cor branca) */}
                  <input
                    data-no-drag="true"
                    type="range"
                    className="ytw-range-progress"
                    min={0}
                    max={100}
                    step={0.1}
                    value={progressPercent}
                    disabled={!playerReady}
                    onChange={(e) =>
                      onSeekFromPercent(Number((e.target as HTMLInputElement).value))
                    }
                    style={{
                      flex: 1,
                      accentColor: '#fff',
                      width: '100%'
                    }}
                    aria-label="Progresso"
                  />
                </div>
              </div>
            </div>
          ) : null}
        </div>

        {/* Resize é por bordas/cantos (sem handle visual). */}
      </div>
    </>
  )
}

YoutubeShortsWidget.schema = {
  title: 'YouTube Shorts Widget (arrastável)',
  description:
    'Widget flutuante com embed do YouTube Shorts/Video, arrastável com o mouse/toque e com botão X para fechar e parar.',
  type: 'object',
  properties: {
    shortsUrl: {
      type: 'string',
      title: 'Link do Shorts do YouTube',
      description: 'Cole a URL do vídeo (Shorts ou watch?v=).',
      default: '',
    },
    startOnLoad: {
      type: 'boolean',
      title: 'Iniciar no carregamento da página',
      description:
        'Se desativado, o vídeo só carrega quando o usuário tocar em “Tocar para iniciar”.',
      default: true,
    },
    closable: {
      type: 'boolean',
      title: 'Permitir fechar (botão X)',
      description: 'Se ativado, exibe o botão X e permite “matar” o iframe.',
      default: true,
    },
    looping: {
      type: 'boolean',
      title: 'Repetir vídeo em loop',
      description: 'Se ativado, ao terminar o vídeo ele recomeça automaticamente.',
      default: true,
    },
  },
}

YoutubeShortsWidget.defaultProps = {
  shortsUrl: '',
  startOnLoad: true,
  closable: true,
  looping: true,
  desktopAnchor: 'bottom-right',
  // desktopOffsetX: 16,
  // desktopOffsetY: 16,
  desktopOffsetX: 32,
  desktopOffsetY: 108,
  mobileAnchor: 'bottom-right',
  mobileOffsetX: 12,
  mobileOffsetY: 12,
}

export default YoutubeShortsWidget

