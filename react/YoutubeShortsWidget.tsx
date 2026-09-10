import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import useDock from './useDock'
import useDragResize from './useDragResize'
import useRouteChange from './useRouteChange'
import useYouTubePlayer from './useYouTubePlayer'
import { getViewportWidth } from './viewport'

/** No SSR não existe `window`, e `useLayoutEffect` só emitiria warning. */
const useIsomorphicLayoutEffect =
  typeof window !== 'undefined' ? useLayoutEffect : useEffect

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
  /**
   * Força o modo compacto (vídeo oculto atrás do botão lateral direito, controles
   * nativos do YouTube) em qualquer largura de tela, não só em viewports estreitas.
   */
  forceCompactMode: boolean
  /**
   * Modo Live: atalho que liga de uma vez os controles nativos do YouTube e a
   * proporção 16:9. As duas props abaixo permitem ligar cada parte isoladamente.
   */
  liveMode: boolean
  /** Troca a camada própria de arraste/controles pelos controles nativos do YouTube. */
  nativeYoutubeControls: boolean
  /** Proporção do card: vertical (Shorts/Reels) ou 16:9. */
  aspectRatio: 'vertical' | 'widescreen'
}

type Pos = { left: number; top: number }
type Anchor = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n))
}

function isNarrowViewport() {
  if (typeof window === 'undefined') return false
  return window.innerWidth < 1024
}

// Regra para ativar o comportamento de “doca escondida”.
const DOCK_ACTIVATION_MAX_WIDTH = 1620
const ASPECT_RATIO_W_H = 9 / 16
const DEFAULT_WIDTH = 200
const MIN_WIDTH = 200
const MAX_WIDTH = 350
/** Largura fixa do card no modo compacto (viewport estreita ou `forceCompactMode`). */
const COMPACT_FIXED_WIDTH = 150

/**
 * Proporção 16:9 — precisa de mais largura que o Shorts para a barra de controles
 * do player caber com conforto.
 */
const WIDESCREEN_ASPECT_RATIO_W_H = 16 / 9
const WIDESCREEN_DEFAULT_WIDTH = 480
const WIDESCREEN_MIN_WIDTH = 240
const WIDESCREEN_MAX_WIDTH = 1280
/**
 * Faixas de borda que continuam pertencendo ao card quando os controles são nativos,
 * para o resize sobreviver sem a camada de hover. Deve acompanhar `CORNER_THRESHOLD_PX`
 * do `useDragResize`. A borda inferior fica de fora de propósito: é onde mora a barra
 * de controles do YouTube.
 */
const NATIVE_CONTROLS_EDGE_BAND_PX = 14
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

/**
 * Alça de arraste — barra encostada na borda inferior do card.
 * Ajuste tamanho, cor e proporção da largura em relação ao card.
 */
const DRAG_HANDLE_HEIGHT_PX = 20
const DRAG_HANDLE_BACKGROUND = '#2b2b2b'
/** Compartilhado entre o vídeo e a alça, para o conjunto fechar sem degrau. */
const CARD_BORDER_RADIUS_PX = 12
const DRAG_HANDLE_ICON_COLOR = 'rgba(255,255,255,0.72)'
const DRAG_HANDLE_ICON_SIZE_PX = 16
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

function DragHandleIcon({ sizePx }: { sizePx: number }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={sizePx}
      height={sizePx}
      fill="currentColor"
      viewBox="0 0 16 16"
      style={{ pointerEvents: 'none' }}
    >
      <circle cx="3" cy="6" r="1" />
      <circle cx="8" cy="6" r="1" />
      <circle cx="13" cy="6" r="1" />
      <circle cx="3" cy="10" r="1" />
      <circle cx="8" cy="10" r="1" />
      <circle cx="13" cy="10" r="1" />
    </svg>
  )
}

function isDockModeViewport() {
  if (typeof window === 'undefined') return false
  return window.innerWidth < DOCK_ACTIVATION_MAX_WIDTH
}

/** Topo máximo do card considerando a alça de arraste renderizada abaixo dele. */
function getMaxTop(height: number) {
  return Math.max(0, window.innerHeight - height - DRAG_HANDLE_HEIGHT_PX)
}

function getInitialPosFromAnchor(
  anchor: Anchor,
  offsetX: number,
  offsetY: number,
  width: number,
  height: number,
): Pos {
  const maxLeft = Math.max(0, getViewportWidth() - width)
  const maxTop = getMaxTop(height)

  const left = anchor.includes('right')
    ? getViewportWidth() - width - offsetX
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
    /** No modo compacto e com controles nativos usamos os controles do player. */
    youtubeControls: boolean
    /** Mantém a marca e o link "assistir no YouTube" visíveis. */
    keepYoutubeBranding: boolean
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

  // `modestbranding` foi descontinuado pelo YouTube e não esconde mais o logo; com
  // controles nativos queremos justamente o caminho para o YouTube, então nem enviamos.
  if (!options.keepYoutubeBranding) {
    params.set('modestbranding', '1')
    params.set('rel', '0')
  }

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
  forceCompactMode,
  liveMode,
  nativeYoutubeControls,
  aspectRatio,
}: YoutubeShortsWidgetProps) => {
  const cardRef = useRef<HTMLDivElement | null>(null)
  /** Container do iframe. Quem cria/destrói o iframe é `useYouTubePlayer`. */
  const playerHostRef = useRef<HTMLDivElement | null>(null)
  const mobileFullscreenShellRef = useRef<HTMLDivElement | null>(null)

  // `liveMode` é só um atalho: as duas capacidades que ele agrupa também podem ser
  // ligadas isoladamente, porque na prática elas são independentes.
  const isWidescreen = liveMode || aspectRatio === 'widescreen'
  const wantsNativeControls = liveMode || nativeYoutubeControls

  const aspectRatioWH = isWidescreen ? WIDESCREEN_ASPECT_RATIO_W_H : ASPECT_RATIO_W_H
  const defaultWidth = isWidescreen ? WIDESCREEN_DEFAULT_WIDTH : DEFAULT_WIDTH
  const minWidth = isWidescreen ? WIDESCREEN_MIN_WIDTH : MIN_WIDTH
  const maxWidth = isWidescreen ? WIDESCREEN_MAX_WIDTH : MAX_WIDTH

  const [size, setSize] = useState<{ width: number; height: number }>(() => ({
    width: defaultWidth,
    height: Math.round(defaultWidth / aspectRatioWH),
  }))

  const videoId = useMemo(() => extractYoutubeVideoId(shortsUrl), [shortsUrl])

  const [isClosed, setIsClosed] = useState(false)
  const [isPlaying, setIsPlaying] = useState(false)

  const [spaKey, setSpaKey] = useState(0)
  const [isHovering, setIsHovering] = useState(false)
  const [isVolumeHovering, setIsVolumeHovering] = useState(false)
  // A viewport é medida separadamente do modo compacto: `forceCompactMode` liga o
  // mesmo comportamento em telas largas, sem que o código perca a noção de tela real.
  //
  // Nada aqui pode ser inicializado a partir de `window`: o HTML do SSR sairia
  // sempre com o layout desktop e a hidratação no cliente encontraria uma árvore
  // diferente, corrompendo os nós vizinhos da página. A viewport só é medida
  // depois da montagem, e até lá o componente não renderiza nada.
  const [isMounted, setIsMounted] = useState(false)
  const [narrowViewport, setNarrowViewport] = useState(false)
  const [dockViewport, setDockViewport] = useState(false)

  useEffect(() => {
    setNarrowViewport(isNarrowViewport())
    setDockViewport(isDockModeViewport())
    setIsMounted(true)
  }, [])

  /** Vídeo oculto atrás do botão lateral, controles nativos e fluxo de tela cheia. */
  const isCompact = forceCompactMode || narrowViewport
  // O 16:9 sempre acopla: mesmo em telas largas o vídeo horizontal atrapalha a
  // navegação se ficar permanentemente visível.
  const isDockMode = forceCompactMode || isWidescreen || dockViewport

  /**
   * Com controles nativos (`controls=1`), o overlay próprio e a camada de hover não
   * podem ser renderizados: eles roubariam os cliques destinados ao player.
   */
  const useNativeControls = isCompact || wantsNativeControls

  /** Compacto: vídeo em modo tela cheia (viewport), após toque na bolinha da doca. */
  const [isFullscreenOpen, setIsFullscreenOpen] = useState(false)
  /** Tela cheia nativa do player (botão do próprio YouTube, no modo Live). */
  const [isNativeFullscreen, setIsNativeFullscreen] = useState(false)

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
    setIsFullscreenOpen(false)
  }, [shortsUrl, startOnLoad])

  // Recarrega quando a página do SPA trocar (mesmo que `shortsUrl` não mude).
  useRouteChange(() => {
    setSpaKey((k) => k + 1)
    setIsClosed(false)
    setIsPlaying(false)
    setIsFullscreenOpen(false)
  })

  const dockOffsetX = isCompact ? mobileOffsetX : desktopOffsetX

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
    isCompact,
    dockOffsetX,
    size,
    pos,
  })

  const applyInitialPosition = useCallback(() => {
    if (!cardRef.current) return
    const rect = cardRef.current.getBoundingClientRect()
    const width = rect.width || 280
    const height = rect.height || 480
    // Precisa reler a viewport aqui: este callback roda na fase de layout, antes de
    // um eventual `setState` do listener de resize ser refletido.
    const compactNow = forceCompactMode || isNarrowViewport()
    const dockModeNow = forceCompactMode || isWidescreen || isDockModeViewport()
    const anchor = compactNow ? mobileAnchor : desktopAnchor
    const offsetX = compactNow ? mobileOffsetX : desktopOffsetX
    const offsetY = compactNow ? mobileOffsetY : desktopOffsetY
    if (dockModeNow) {
      // Lado direito da tela, centralizado verticalmente
      const left = getViewportWidth() - width - offsetX
      const top = (window.innerHeight - height) / 2
      setPos({ left: clamp(left, 0, getViewportWidth() - width), top: clamp(top, 0, getMaxTop(height)) })
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
    forceCompactMode,
    isWidescreen,
    mobileAnchor,
    mobileOffsetX,
    mobileOffsetY,
  ])

  // Ajuste inicial para posição configurada (layout phase → antes do paint quando possível).
  useIsomorphicLayoutEffect(() => {
    if (typeof window === 'undefined') return
    // O card só existe a partir da primeira renderização pós-montagem.
    if (!isMounted) return

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
  }, [videoId, spaKey, isMounted, applyInitialPosition])

  // Re-clamp em resize.
  useEffect(() => {
    const onResize = () => {
      const narrowNow = isNarrowViewport()
      const dockModeNow = forceCompactMode || isWidescreen || isDockModeViewport()
      setNarrowViewport(narrowNow)
      setDockViewport(isDockModeViewport())
      if (!dockModeNow) {
        setIsDocked(false)
        setIsDockHovering(false)
      }
      if (forceCompactMode || narrowNow) {
        const safeWidth = Math.max(140, Math.min(COMPACT_FIXED_WIDTH, getViewportWidth() - 24))
        setSize({ width: safeWidth, height: Math.round(safeWidth / aspectRatioWH) })
      }
      if (!cardRef.current) return
      const rect = cardRef.current.getBoundingClientRect()
      const width = rect.width || 280
      const height = rect.height || 480
      const maxLeft = Math.max(0, getViewportWidth() - width)
      const maxTop = getMaxTop(height)
      setPos((p) => ({
        left: clamp(p.left, 0, maxLeft),
        top: clamp(p.top, 0, maxTop),
      }))
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [aspectRatioWH, forceCompactMode, isWidescreen, setIsDocked, setIsDockHovering])

  // O modo compacto tem largura fixa; ao sair dele o card volta ao tamanho padrão,
  // senão ficaria preso na largura reduzida.
  useEffect(() => {
    const width = isCompact
      ? Math.max(140, Math.min(COMPACT_FIXED_WIDTH, getViewportWidth() - 24))
      : defaultWidth
    setSize({ width, height: Math.round(width / aspectRatioWH) })
  }, [aspectRatioWH, defaultWidth, isCompact])

  // A dock “fecha” o card quando estiver acoplado.
  // - compacto: esconde tudo (mantém apenas a bolinha cinza)
  // - desktop: mostra só um sliver até passar o mouse na alça
  const dockCardHiddenForUI =
    isDockMode && isDocked && (isCompact ? true : !isDockHovering)

  // Observação: não reposicionamos o widget para o dock quando ele esconde.
  // Assim, após arrastar e soltar, “tirar o mouse” não força snap de volta.

  // Bolinha do modo compacto: encostada na borda direita da tela, centralizada na vertical.
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
      youtubeControls: useNativeControls,
      // Só quando os controles nativos foram pedidos por prop: no modo compacto o
      // comportamento de sempre (sem vídeos relacionados) é mantido.
      keepYoutubeBranding: wantsNativeControls,
    })
  }, [videoId, autoplay, looping, useNativeControls, wantsNativeControls])

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
    hostRef: playerHostRef as React.RefObject<HTMLDivElement>,
    embedUrl,
    videoId,
    spaKey,
    looping,
    initialVolume: DEFAULT_INITIAL_VOLUME,
    startOnLoad,
    isPlaying,
    isHovering,
    isCompact,
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
    isCompact,
    isDockMode,
    isVideoPlaying,
    dockPosRef,
    isDockedRef,
    setIsDocked,
    setIsDockHovering,
    setPos,
    // Com controles nativos o toque não deve pausar por fora do player.
    onTapToggle: useNativeControls ? undefined : togglePlayPause,
    bottomReservedPx: DRAG_HANDLE_HEIGHT_PX,
    aspectRatioWH,
    minWidth,
    maxWidth,
  })

  const exitMobileExpandedToDocked = useCallback(() => {
    const doc = document as any
    try {
      doc.exitFullscreen?.()
      doc.webkitExitFullscreen?.()
    } catch {
      // noop
    }
    setIsFullscreenOpen(false)
    setIsDocked(true)
    pauseVideo()
  }, [pauseVideo, setIsDocked])

  useIsomorphicLayoutEffect(() => {
    if (!isCompact || !isFullscreenOpen) return
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
  }, [isCompact, isFullscreenOpen])

  useEffect(() => {
    if (isCompact && isDocked) setIsFullscreenOpen(false)
  }, [isCompact, isDocked])

  useEffect(() => {
    if (!isCompact || !isDockMode || !isDocked || !playerReady) return
    pauseVideo()
  }, [isCompact, isDockMode, isDocked, playerReady, pauseVideo])

  useEffect(() => {
    if (!isCompact || !isFullscreenOpen) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [isCompact, isFullscreenOpen])

  useEffect(() => {
    if (!isCompact || !isFullscreenOpen || !playerReady) return
    playVideo()
  }, [isCompact, isFullscreenOpen, playerReady, playVideo])

  // O fullscreen do player é solicitado pelo iframe, então quem recebe o evento é o
  // documento pai. Acompanhar isso permite manter o card sem `transform` enquanto a
  // tela cheia estiver ativa (um ancestral transformado quebra o posicionamento).
  useEffect(() => {
    if (typeof document === 'undefined') return

    const onFullscreenChange = () => {
      const doc = document as any
      setIsNativeFullscreen(!!(doc.fullscreenElement || doc.webkitFullscreenElement))
    }

    document.addEventListener('fullscreenchange', onFullscreenChange)
    document.addEventListener('webkitfullscreenchange', onFullscreenChange)
    return () => {
      document.removeEventListener('fullscreenchange', onFullscreenChange)
      document.removeEventListener('webkitfullscreenchange', onFullscreenChange)
    }
  }, [])

  const progressPercent = progress.duration
    ? clamp(progress.currentTime / progress.duration, 0, 1) * 100
    : 0
  const dockCardHiddenMobile = isDockMode && isCompact && isDocked
  const dockCardHiddenDesktop =
    !isCompact && isDockMode && isDocked && !isDockHovering && !isNativeFullscreen
  const layoutCardHidden = !layoutCardReady
  const dockVisibleSliceWidth = Math.max(
    DOCK_VISIBLE_SLICE_MIN_PX,
    Math.round(size.width * DOCK_VISIBLE_SLICE_RATIO),
  )
  const dockHiddenTranslateXPx = dockCardHiddenDesktop
    ? Math.max(0, size.width - dockVisibleSliceWidth)
    : 0

  const showDragHandle =
    !layoutCardHidden &&
    !dockCardHiddenMobile &&
    !dockCardHiddenDesktop &&
    !(isCompact && isFullscreenOpen)

  // Quando a doca está “fechada”, evita mostrar overlays (header/controls).
  const shouldShowControls =
    shouldMountIframe &&
    !dockCardHiddenForUI &&
    !useNativeControls &&
    (isHovering || !isVideoPlaying)

  // No servidor e na primeira renderização do cliente a saída é sempre a mesma
  // (nada), então a hidratação nunca encontra uma árvore divergente.
  if (!isMounted) return null
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
      {isDockMode && !isCompact && isDocked ? (
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
      {isDockMode && isCompact && isDocked ? (
        <div
          data-no-drag="true"
          role="button"
          aria-label="Abrir em tela cheia"
          onClick={() => {
            setIsDocked(false)
            setIsFullscreenOpen(true)
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
          // zIndex: 9999,
          zIndex: 999,
          overflow: 'visible',
          background: 'transparent',
          touchAction: 'none',
          cursor: isCompact ? 'grab' : resizeCursor || 'grab',
          transform:
            dockHiddenTranslateXPx > 0
              ? `translateX(${dockHiddenTranslateXPx}px)`
              : 'none',
          opacity: layoutCardHidden ? 0 : dockCardHiddenMobile ? 0 : 1,
          visibility: layoutCardHidden ? 'hidden' : 'visible',
          pointerEvents:
            layoutCardHidden || dockCardHiddenMobile || dockCardHiddenDesktop
              ? 'none'
              : isCompact && isFullscreenOpen
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
        {closable && !(isCompact && isFullscreenOpen) ? (
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
            // Com a alça encostada embaixo, os cantos inferiores deixariam uma falha
            // visível entre o vídeo e a barra; os de cima continuam arredondados.
            borderRadius:
              isCompact && isFullscreenOpen
                ? 0
                : showDragHandle
                  ? `${CARD_BORDER_RADIUS_PX}px ${CARD_BORDER_RADIUS_PX}px 0 0`
                  : CARD_BORDER_RADIUS_PX,
            overflow: 'hidden',
            position: isCompact && isFullscreenOpen ? 'fixed' : 'relative',
            background: '#000',
            // Com o card em `pointer-events: none` no mobile expandido, o hit-test ignora
            // o card inteiro a menos que este shell reabilite toques (MDN: filhos precisam
            // de `pointer-events: auto` explícito).
            pointerEvents: isCompact && isFullscreenOpen ? 'auto' : undefined,
            isolation: isCompact && isFullscreenOpen ? 'isolate' : undefined,
            ...(isCompact && isFullscreenOpen
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
          {isCompact && isFullscreenOpen ? (
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
          {/* Host do player. Fica sempre montado, com o mesmo nó, para que o React
              nunca precise remover algo que a API do YouTube já removeu por dentro. */}
          <div
            ref={playerHostRef}
            aria-hidden={shouldMountIframe ? undefined : true}
            style={{
              position: 'absolute',
              zIndex: 0,
              top: 0,
              left: 0,
              width: '100%',
              height: '100%',
              pointerEvents: shouldMountIframe ? undefined : 'none',
            }}
          />

          {!shouldMountIframe ? (
            <button
              type="button"
              onClick={onPlay}
              data-no-drag="true"
              aria-label="Iniciar vídeo"
              style={{
                position: 'absolute',
                inset: 0,
                zIndex: 1,
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
          ) : null}

          {/* Camada que captura hover. Com controles nativos ela precisa sair do
              caminho, senão bloqueia os cliques que deveriam chegar ao player. */}
          {shouldMountIframe && !useNativeControls ? (
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

          {/* Controles nativos: devolve apenas as bordas ao card, para o resize
              continuar funcionando enquanto o centro segue clicável no player. */}
          {shouldMountIframe && useNativeControls && !isCompact ? (
            <div
              aria-hidden="true"
              style={{ position: 'absolute', inset: 0, zIndex: 2, pointerEvents: 'none' }}
            >
              {(['top', 'left', 'right'] as const).map((side) => (
                <div
                  key={side}
                  style={{
                    position: 'absolute',
                    pointerEvents: 'auto',
                    top: 0,
                    bottom: side === 'top' ? undefined : 0,
                    left: side === 'right' ? undefined : 0,
                    right: side === 'left' ? undefined : 0,
                    width: side === 'top' ? undefined : NATIVE_CONTROLS_EDGE_BAND_PX,
                    height: side === 'top' ? NATIVE_CONTROLS_EDGE_BAND_PX : undefined,
                  }}
                />
              ))}
            </div>
          ) : null}

          {shouldMountIframe && !useNativeControls ? (
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

        {/* Alça de arraste: vive fora do box do card (`top: 100%`), por isso o
            card precisa de `overflow: visible`. */}
        {showDragHandle ? (
          <div
            data-ytw-drag-handle="true"
            aria-hidden="true"
            title="Arraste para mover"
            style={{
              position: 'absolute',
              top: '100%',
              left: 0,
              // Acompanha a largura do card, inclusive durante o resize.
              width: '100%',
              height: DRAG_HANDLE_HEIGHT_PX,
              zIndex: 4,
              borderRadius: `0 0 ${CARD_BORDER_RADIUS_PX}px ${CARD_BORDER_RADIUS_PX}px`,
              background: DRAG_HANDLE_BACKGROUND,
              color: DRAG_HANDLE_ICON_COLOR,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'grab',
              touchAction: 'none',
              userSelect: 'none',
              boxShadow: '0 2px 6px rgba(0,0,0,0.35)',
            }}
          >
            <DragHandleIcon sizePx={DRAG_HANDLE_ICON_SIZE_PX} />
          </div>
        ) : null}

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
      title: 'Link do YouTube',
      description:
        'Cole a URL do vídeo no padrão: https://www.youtube.com/embed/{id-do-video-aqui}',
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
    forceCompactMode: {
      type: 'boolean',
      title: 'Forçar modo compacto (estilo mobile) em qualquer tela',
      description:
        'Se ativado, o vídeo fica oculto e só é aberto pelo botão fixo na lateral direita, ' +
        'como já acontece em telas estreitas.',
      default: false,
    },
    liveMode: {
      type: 'boolean',
      title: 'Modo Live',
      description:
        'Atalho: liga de uma vez os controles nativos do YouTube e a proporção 16:9. ' +
        'Para controlar cada parte separadamente, use as duas opções abaixo.',
      default: false,
    },
    nativeYoutubeControls: {
      type: 'boolean',
      title: 'Modo YouTube (controles nativos)',
      description:
        'Substitui a camada própria de arraste e controles pelos comandos nativos do ' +
        'YouTube (tela cheia, abrir no YouTube). O card continua sendo movido pela alça.',
      default: false,
    },
    aspectRatio: {
      type: 'string',
      title: 'Proporção do vídeo',
      enum: ['vertical', 'widescreen'],
      enumNames: ['Vertical (Shorts/Reels 9:16)', 'Horizontal (16:9)'],
      default: 'vertical',
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
  forceCompactMode: false,
  liveMode: false,
  nativeYoutubeControls: false,
  aspectRatio: 'vertical',
}

export default YoutubeShortsWidget

