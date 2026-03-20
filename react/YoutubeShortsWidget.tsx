import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'

type YoutubeShortsWidgetProps = {
  /**
   * URL do YouTube (Shorts ou URL de vídeo). Ex: https://www.youtube.com/shorts/<id>
   * ou https://www.youtube.com/watch?v=<id>
   */
  shortsUrl: string
  /** Se true, monta o iframe assim que o componente carregar na PDP. */
  startOnLoad: boolean
  /** Se true, o embed inicia mutado (ajuda autoplay). */
  muted: boolean
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
type VideoMeta = { title: string; author: string }
type Anchor = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n))
}

function isMobileViewport() {
  if (typeof window === 'undefined') return false
  return window.innerWidth < 1024
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

declare global {
  interface Window {
    YT?: any
    onYouTubeIframeAPIReady?: () => void
  }
}

let youtubeIframeApiLoading: Promise<void> | null = null

function loadYouTubeIframeAPI() {
  if (typeof window === 'undefined') return Promise.resolve()
  const w = window as Window

  if (w.YT?.Player) return Promise.resolve()
  if (youtubeIframeApiLoading) return youtubeIframeApiLoading

  youtubeIframeApiLoading = new Promise<void>((resolve) => {
    // Caso o script já tenha sido carregado em outra instância.
    const existing = document.querySelector(
      'script[src="https://www.youtube.com/iframe_api"]',
    ) as HTMLScriptElement | null

    const prev = w.onYouTubeIframeAPIReady
    w.onYouTubeIframeAPIReady = () => {
      try {
        prev?.()
      } catch {
        // noop
      }
      resolve()
    }

    if (!existing) {
      const script = document.createElement('script')
      script.src = 'https://www.youtube.com/iframe_api'
      script.async = true
      document.head.appendChild(script)
    }
  })

  return youtubeIframeApiLoading
}

function buildYoutubeEmbedUrl(
  videoId: string,
  options: { muted: boolean; autoplay: boolean; looping: boolean; origin?: string },
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
  params.set('controls', '0')
  params.set('enablejsapi', '1')
  if (options.origin) params.set('origin', options.origin)

  return `https://www.youtube.com/embed/${videoId}?${params.toString()}`
}

const YoutubeShortsWidget: any = ({
  shortsUrl,
  startOnLoad,
  muted,
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
  const playerRef = useRef<any>(null)

  const ASPECT_RATIO_W_H = 9 / 16
  const MIN_WIDTH = 220
  const MAX_WIDTH = 520
  const MOBILE_FIXED_WIDTH = 220
  const LONG_PRESS_MS = 180
  const TAP_MOVE_TOLERANCE_PX = 8

  const [size, setSize] = useState<{ width: number; height: number }>(() => ({
    width: 280,
    height: Math.round(280 / ASPECT_RATIO_W_H),
  }))

  const videoId = useMemo(() => extractYoutubeVideoId(shortsUrl), [shortsUrl])

  const [isClosed, setIsClosed] = useState(false)
  const [isPlaying, setIsPlaying] = useState(false)
  const [isVideoPlaying, setIsVideoPlaying] = useState(false)

  const [spaKey, setSpaKey] = useState(0)
  const [isHovering, setIsHovering] = useState(false)
  const [isVolumeHovering, setIsVolumeHovering] = useState(false)
  const [isCloseBtnHovering, setIsCloseBtnHovering] = useState(false)
  const [isPlayPauseBtnHovering, setIsPlayPauseBtnHovering] = useState(false)
  const [isVolumeBtnHovering, setIsVolumeBtnHovering] = useState(false)
  const [isFullscreenBtnHovering, setIsFullscreenBtnHovering] = useState(false)
  const [resizeCursor, setResizeCursor] = useState<string | null>(null)
  const lastResizeCursorRef = useRef<string | null>(null)
  const [playerReady, setPlayerReady] = useState(false)
  const [progress, setProgress] = useState<{ currentTime: number; duration: number }>({
    currentTime: 0,
    duration: 0,
  })
  const [volume, setVolume] = useState<number>(muted ? 0 : 100)
  const [videoMeta, setVideoMeta] = useState<VideoMeta>({ title: '', author: '' })
  const [isMobile, setIsMobile] = useState<boolean>(() => isMobileViewport())
  const [mobileControlsVisible, setMobileControlsVisible] = useState(false)

  // Posição do card (fixo com scroll).
  const [pos, setPos] = useState<Pos>({ left: 16, top: 16 })
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

  const mobileControlsTimerRef = useRef<number | null>(null)
  const showMobileControls = useCallback(() => {
    setMobileControlsVisible(true)
    if (mobileControlsTimerRef.current != null) {
      window.clearTimeout(mobileControlsTimerRef.current)
    }
    mobileControlsTimerRef.current = window.setTimeout(() => {
      setMobileControlsVisible(false)
      mobileControlsTimerRef.current = null
    }, 2500)
  }, [])

  const clearMobileControlsTimer = useCallback(() => {
    if (mobileControlsTimerRef.current != null) {
      window.clearTimeout(mobileControlsTimerRef.current)
      mobileControlsTimerRef.current = null
    }
  }, [])

  // Reset correto em SPA quando trocar de PDP (props mudam).
  useEffect(() => {
    setIsClosed(false)
    setIsPlaying(false)
    setIsVideoPlaying(false)
    setPlayerReady(false)
    setProgress({ currentTime: 0, duration: 0 })
    setVideoMeta({ title: '', author: '' })
    setMobileControlsVisible(false)
    clearMobileControlsTimer()
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
      setIsVideoPlaying(false)
      setPlayerReady(false)
      setProgress({ currentTime: 0, duration: 0 })
      setVideoMeta({ title: '', author: '' })
      setMobileControlsVisible(false)
      clearMobileControlsTimer()
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
  }, [clearMobileControlsTimer])

  const applyInitialPosition = useCallback(() => {
    if (!cardRef.current) return
    const rect = cardRef.current.getBoundingClientRect()
    const width = rect.width || 280
    const height = rect.height || 480
    const mobile = isMobileViewport()
    const anchor = mobile ? mobileAnchor : desktopAnchor
    const offsetX = mobile ? mobileOffsetX : desktopOffsetX
    const offsetY = mobile ? mobileOffsetY : desktopOffsetY
    setPos(getInitialPosFromAnchor(anchor, offsetX, offsetY, width, height))
  }, [
    desktopAnchor,
    desktopOffsetX,
    desktopOffsetY,
    mobileAnchor,
    mobileOffsetX,
    mobileOffsetY,
  ])

  // Ajuste inicial para posição configurada.
  useEffect(() => {
    applyInitialPosition()
  }, [videoId, spaKey, applyInitialPosition])

  // Re-clamp em resize.
  useEffect(() => {
    const onResize = () => {
      const mobileNow = isMobileViewport()
      setIsMobile(mobileNow)
      if (mobileNow) {
        const safeWidth = Math.max(180, Math.min(MOBILE_FIXED_WIDTH, window.innerWidth - 24))
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
    const safeWidth = Math.max(180, Math.min(MOBILE_FIXED_WIDTH, window.innerWidth - 24))
    const nextHeight = Math.round(safeWidth / ASPECT_RATIO_W_H)
    setSize({ width: safeWidth, height: nextHeight })
  }, [isMobile])

  const shouldMountIframe = !!videoId && !isClosed && (startOnLoad || isPlaying)
  const autoplay = startOnLoad || isPlaying

  const embedUrl = useMemo(() => {
    if (!videoId) return null
    const origin = typeof window !== 'undefined' ? window.location.origin : undefined
    return buildYoutubeEmbedUrl(videoId, { muted, autoplay, looping, origin })
  }, [videoId, muted, autoplay, looping])

  const onClose = useCallback(() => {
    setIsClosed(true)
    setIsPlaying(false)
    setIsVideoPlaying(false)
    setPlayerReady(false)
    setProgress({ currentTime: 0, duration: 0 })

    try {
      playerRef.current?.stopVideo?.()
      playerRef.current?.destroy?.()
    } catch {
      // noop
    }
    playerRef.current = null
  }, [])

  const onPlay = useCallback(() => {
    setIsPlaying(true)
    if (isMobile) showMobileControls()
  }, [isMobile, showMobileControls])

  type ResizeEdge = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'

  const EDGE_THRESHOLD_PX = 10
  const CORNER_THRESHOLD_PX = 14

  const getResizeEdgeFromPoint = useCallback(
    (x: number, y: number, rect: DOMRect): ResizeEdge | null => {
      const leftDist = x - rect.left
      const rightDist = rect.right - x
      const topDist = y - rect.top
      const bottomDist = rect.bottom - y

      const nearLeft = leftDist <= EDGE_THRESHOLD_PX
      const nearRight = rightDist <= EDGE_THRESHOLD_PX
      const nearTop = topDist <= EDGE_THRESHOLD_PX
      const nearBottom = bottomDist <= EDGE_THRESHOLD_PX

      const nearCornerTop = topDist <= CORNER_THRESHOLD_PX
      const nearCornerBottom = bottomDist <= CORNER_THRESHOLD_PX
      const nearCornerLeft = leftDist <= CORNER_THRESHOLD_PX
      const nearCornerRight = rightDist <= CORNER_THRESHOLD_PX

      if (nearCornerLeft && nearCornerTop && nearLeft && nearTop) return 'nw'
      if (nearCornerRight && nearCornerTop && nearRight && nearTop) return 'ne'
      if (nearCornerLeft && nearCornerBottom && nearLeft && nearBottom) return 'sw'
      if (nearCornerRight && nearCornerBottom && nearRight && nearBottom) return 'se'

      if (nearTop) return 'n'
      if (nearBottom) return 's'
      if (nearLeft) return 'w'
      if (nearRight) return 'e'

      return null
    },
    [],
  )

  const getCursorForEdge = useCallback((edge: ResizeEdge): string => {
    switch (edge) {
      case 'n':
      case 's':
        return 'ns-resize'
      case 'e':
      case 'w':
        return 'ew-resize'
      case 'nw':
      case 'se':
        return 'nwse-resize'
      case 'ne':
      case 'sw':
        return 'nesw-resize'
      default:
        return 'grab'
    }
  }, [])

  // Drag do widget: qualquer parte (exceto elementos interativos).
  const dragRef = useRef<{
    pointerId: number
    startClientX: number
    startClientY: number
    startLeft: number
    startTop: number
    width: number
    height: number
  } | null>(null)
  const pressRef = useRef<{
    pointerId: number
    startClientX: number
    startClientY: number
    startLeft: number
    startTop: number
    width: number
    height: number
    startedAtMs: number
  } | null>(null)

  // Resize do widget (mantendo proporção 9:16).
  const resizeRef = useRef<{
    pointerId: number
    edge: ResizeEdge
    startClientX: number
    startClientY: number
    startLeft: number
    startTop: number
    startWidth: number
    startHeight: number
  } | null>(null)

  const onPointerDownCard = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!cardRef.current) return
      if (e.button !== 0) return

      // const t = e.target instanceof HTMLElement ? e.target : null
      const target = e.target as Element | null

      // Não inicia drag em botões/inputs/elementos explicitamente marcados.
      // if (t?.closest('button, input, select, textarea, [data-no-drag="true"]')) return
      if (target?.closest('button, input, select, textarea, [data-no-drag="true"]')) return

      const rect = cardRef.current.getBoundingClientRect()
      const width = rect.width || size.width
      const height = rect.height || size.height

      const edge = isMobile ? null : getResizeEdgeFromPoint(e.clientX, e.clientY, rect)
      if (edge) {
        resizeRef.current = {
          pointerId: e.pointerId,
          edge,
          startClientX: e.clientX,
          startClientY: e.clientY,
          startLeft: posRef.current.left,
          startTop: posRef.current.top,
          startWidth: width,
          startHeight: height,
        }

        try {
          e.currentTarget.setPointerCapture(e.pointerId)
        } catch {
          // noop
        }
        e.preventDefault()
        return
      }

      dragRef.current = {
        pointerId: e.pointerId,
        startClientX: e.clientX,
        startClientY: e.clientY,
        startLeft: posRef.current.left,
        startTop: posRef.current.top,
        width,
        height,
      }
      pressRef.current = {
        pointerId: e.pointerId,
        startClientX: e.clientX,
        startClientY: e.clientY,
        startLeft: posRef.current.left,
        startTop: posRef.current.top,
        width,
        height,
        startedAtMs: performance.now(),
      }

      try {
        e.currentTarget.setPointerCapture(e.pointerId)
      } catch {
        // noop
      }
      e.preventDefault()
    },
    [getResizeEdgeFromPoint, isMobile, size.width, size.height],
  )

  const onPointerMoveCard = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (resizeRef.current) {
        if (e.pointerId !== resizeRef.current.pointerId) return

        const r = resizeRef.current
        const dx = e.clientX - r.startClientX
        const dy = e.clientY - r.startClientY

        const includesN = r.edge === 'n' || r.edge === 'ne' || r.edge === 'nw'
        const includesS = r.edge === 's' || r.edge === 'se' || r.edge === 'sw'

        let nextWidth = r.startWidth
        let nextHeight = r.startHeight
        let nextLeft = r.startLeft
        let nextTop = r.startTop

        const minHeight = Math.round((MIN_WIDTH * 16) / 9)
        const maxHeight = Math.round((MAX_WIDTH * 16) / 9)

        // Horizontal resizing has priority when edge includes left/right.
        if (
          r.edge === 'e' ||
          r.edge === 'w' ||
          r.edge === 'ne' ||
          r.edge === 'nw' ||
          r.edge === 'se' ||
          r.edge === 'sw'
        ) {
          if (r.edge === 'e' || r.edge === 'ne' || r.edge === 'se') {
            nextWidth = r.startWidth + dx
            const maxW = Math.min(MAX_WIDTH, window.innerWidth - r.startLeft)
            nextWidth = clamp(nextWidth, MIN_WIDTH, maxW)
          } else {
            // 'w' / 'nw' / 'sw'
            const fixedRight = r.startLeft + r.startWidth
            nextWidth = r.startWidth - dx
            const maxW = Math.min(MAX_WIDTH, fixedRight)
            nextWidth = clamp(nextWidth, MIN_WIDTH, maxW)
            nextLeft = fixedRight - nextWidth
          }

          nextHeight = Math.round((nextWidth * 16) / 9)

          if (includesN) {
            const fixedBottom = r.startTop + r.startHeight
            nextTop = fixedBottom - nextHeight
          } else if (includesS) {
            nextTop = r.startTop
          } else {
            nextTop = r.startTop
          }
        } else {
          // Vertical resize only
          if (r.edge === 's') {
            nextHeight = r.startHeight + dy
            const maxH = Math.min(window.innerHeight - r.startTop, maxHeight)
            nextHeight = clamp(nextHeight, minHeight, maxH)
            nextTop = r.startTop
          } else {
            // 'n'
            const fixedBottom = r.startTop + r.startHeight
            nextHeight = r.startHeight - dy
            const maxH = Math.min(fixedBottom, maxHeight)
            nextHeight = clamp(nextHeight, minHeight, maxH)
            nextTop = fixedBottom - nextHeight
          }

          nextWidth = Math.round(nextHeight * ASPECT_RATIO_W_H)
          nextHeight = Math.round((nextWidth * 16) / 9)
        }

        // Clamps finais dentro da viewport
        nextWidth = Math.round(nextWidth)
        nextHeight = Math.round(nextHeight)
        nextLeft = clamp(nextLeft, 0, window.innerWidth - nextWidth)
        nextTop = clamp(nextTop, 0, window.innerHeight - nextHeight)

        setSize({ width: nextWidth, height: nextHeight })
        setPosThrottled({ left: nextLeft, top: nextTop })
        return
      }

      if (dragRef.current) {
        if (e.pointerId !== dragRef.current.pointerId) return

        const d = dragRef.current
        const dx = e.clientX - d.startClientX
        const dy = e.clientY - d.startClientY
        const press = pressRef.current

        if (press && press.pointerId === e.pointerId) {
          const elapsedMs = performance.now() - press.startedAtMs
          if (elapsedMs < LONG_PRESS_MS) return
        }

        const nextLeft = clamp(d.startLeft + dx, 0, window.innerWidth - d.width)
        const nextTop = clamp(d.startTop + dy, 0, window.innerHeight - d.height)

        setPosThrottled({ left: nextLeft, top: nextTop })
        return
      }

      // Atualiza cursor nas bordas/cantos quando não está arrastando/redimensionando.
      if (isMobile) return
      if (!cardRef.current) return
      const rect = cardRef.current.getBoundingClientRect()
      const edge = getResizeEdgeFromPoint(e.clientX, e.clientY, rect)
      const cursor = edge ? getCursorForEdge(edge) : null

      if (cursor !== lastResizeCursorRef.current) {
        lastResizeCursorRef.current = cursor
        setResizeCursor(cursor)
      }
    },
    [getCursorForEdge, getResizeEdgeFromPoint, isMobile, setPosThrottled],
  )

  const onPointerUpCard = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (resizeRef.current && e.pointerId === resizeRef.current.pointerId) {
        resizeRef.current = null
        e.preventDefault()
        return
      }

      if (!dragRef.current) return
      if (e.pointerId !== dragRef.current.pointerId) return

      const d = dragRef.current
      const press = pressRef.current
      dragRef.current = null
      pressRef.current = null

      if (!press || press.pointerId !== e.pointerId) {
        e.preventDefault()
        return
      }

      const elapsedMs = performance.now() - press.startedAtMs
      const movedX = Math.abs(e.clientX - d.startClientX)
      const movedY = Math.abs(e.clientY - d.startClientY)
      const moved = Math.max(movedX, movedY)
      const isTap = elapsedMs < LONG_PRESS_MS && moved <= TAP_MOVE_TOLERANCE_PX

      if (isTap) {
        const p = playerRef.current
        if (p) {
          try {
            if (isVideoPlaying) p.pauseVideo?.()
            else p.playVideo?.()
          } catch {
            // noop
          }
        }
      }

      e.preventDefault()
    },
    [isMobile, isVideoPlaying],
  )

  // Mantém o widget dentro dos limites da janela ao redimensionar.
  useEffect(() => {
    setPos((p) => ({
      left: clamp(p.left, 0, window.innerWidth - size.width),
      top: clamp(p.top, 0, window.innerHeight - size.height),
    }))
  }, [size.width, size.height])

  // Inicializa o player do YouTube via IFrame API.
  useEffect(() => {
    if (!shouldMountIframe) return
    if (!iframeRef.current) return

    let cancelled = false
    const iframe = iframeRef.current

    loadYouTubeIframeAPI().then(() => {
      if (cancelled) return
      if (!iframeRef.current) return
      if (!window.YT?.Player) return

      try {
        playerRef.current?.destroy?.()
      } catch {
        // noop
      }

      const player = new window.YT.Player(iframe, {
        events: {
          onReady: () => {
            if (cancelled) return
            setPlayerReady(true)
            try {
              const data = player.getVideoData?.()
              setVideoMeta({
                title: data?.title || '',
                author: data?.author || '',
              })
            } catch {
              setVideoMeta({ title: '', author: '' })
            }

            try {
              if (muted) player.mute?.()
              else player.unMute?.()
            } catch {
              // noop
            }

            try {
              const v = player.getVolume?.()
              if (typeof v === 'number' && !Number.isNaN(v)) setVolume(v)
            } catch {
              // noop
            }

            try {
              if (startOnLoad || isPlaying) player.playVideo?.()
            } catch {
              // noop
            }
          },
          onStateChange: (evt: any) => {
            const state = evt?.data
            setIsVideoPlaying(state === 1)

            // Reforço de loop: em alguns cenários o embed pode não repetir sozinho.
            if (state === window.YT?.PlayerState?.ENDED && looping) {
              try {
                player.seekTo?.(0, true)
                player.playVideo?.()
              } catch {
                // noop
              }
            }
          },
        },
      })

      playerRef.current = player
    })

    return () => {
      cancelled = true
      setPlayerReady(false)
      setIsVideoPlaying(false)

      try {
        playerRef.current?.destroy?.()
      } catch {
        // noop
      }
      playerRef.current = null
    }
    // Dependências: recria quando o iframe é forçado por `spaKey`/troca de vídeo.
  }, [shouldMountIframe, videoId, spaKey, muted, looping])

  // Mantém mute sincronizado com `muted`.
  useEffect(() => {
    if (!playerReady) return
    const p = playerRef.current
    if (!p) return

    if (muted) {
      try {
        p.mute?.()
      } catch {
        // noop
      }
      setVolume(0)
    } else {
      try {
        p.unMute?.()
      } catch {
        // noop
      }
      try {
        const v = p.getVolume?.()
        if (typeof v === 'number' && !Number.isNaN(v)) setVolume(v)
        else setVolume(100)
      } catch {
        setVolume(100)
      }
    }
  }, [playerReady, muted])

  // Atualiza progresso/volume enquanto o usuário está no hover.
  useEffect(() => {
    if (!playerReady) return
    if (!isHovering) return
    if (!shouldMountIframe) return

    const timer = window.setInterval(() => {
      const p = playerRef.current
      if (!p) return

      try {
        const duration = p.getDuration?.()
        const currentTime = p.getCurrentTime?.()
        if (typeof duration === 'number' && typeof currentTime === 'number') {
          setProgress({
            currentTime: Number.isFinite(currentTime) ? currentTime : 0,
            duration: Number.isFinite(duration) ? duration : 0,
          })
        }
      } catch {
        // noop
      }

      try {
        const v = p.getVolume?.()
        if (typeof v === 'number' && !Number.isNaN(v)) setVolume(v)
      } catch {
        // noop
      }
    }, 250)

    return () => window.clearInterval(timer)
  }, [isHovering, playerReady, shouldMountIframe])

  const togglePlayPause = useCallback(() => {
    const p = playerRef.current
    if (!p) return

    if (isMobile) showMobileControls()

    try {
      if (isVideoPlaying) p.pauseVideo?.()
      else p.playVideo?.()
    } catch {
      // noop
    }
  }, [isMobile, isVideoPlaying, showMobileControls])

  const onSeekFromPercent = useCallback(
    (percent: number) => {
      const p = playerRef.current
      if (!p) return
      if (!progress.duration) return

      if (isMobile) showMobileControls()

      const seconds = (clamp(percent, 0, 100) / 100) * progress.duration
      try {
        p.seekTo?.(seconds, true)
      } catch {
        // noop
      }
    },
    [isMobile, progress.duration, showMobileControls],
  )

  const onVolumeChange = useCallback((nextVolume: number) => {
    setVolume(nextVolume)
    if (isMobile) showMobileControls()
    const p = playerRef.current
    if (!p) return
    try {
      p.setVolume?.(nextVolume)
    } catch {
      // noop
    }
  }, [isMobile, showMobileControls])

  const onToggleFullscreen = useCallback(() => {
    if (!isMobile) return
    showMobileControls()
    const iframe = iframeRef.current
    if (!iframe) return
    const doc: any = document
    if (doc.fullscreenElement) {
      doc.exitFullscreen?.()
      doc.webkitExitFullscreen?.()
      return
    }
    const el: any = iframe
    el.requestFullscreen?.()
    el.webkitRequestFullscreen?.()
  }, [isMobile, showMobileControls])

  const progressPercent = progress.duration
    ? clamp(progress.currentTime / progress.duration, 0, 1) * 100
    : 0
  const shouldShowControls = shouldMountIframe && (isMobile ? mobileControlsVisible : isHovering || !isVideoPlaying)
  const shouldShowHeader = shouldMountIframe && (isMobile ? mobileControlsVisible : isHovering)

  if (!videoId) return null
  if (isClosed) return null

  return (
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
      }}
      aria-label="YouTube Shorts widget"
      onMouseEnter={() => setIsHovering(true)}
      onMouseLeave={() => {
        setIsHovering(false)
        setIsVolumeHovering(false)
        setResizeCursor(null)
        lastResizeCursorRef.current = null
      }}
      onPointerDown={onPointerDownCard}
      onPointerMove={onPointerMoveCard}
      onPointerUp={onPointerUpCard}
      onClick={() => {
        if (!isMobile || !shouldMountIframe) return
        showMobileControls()
      }}
    >
      {closable ? (
        <button
          type="button"
          data-no-drag="true"
          onClick={onClose}
          onMouseEnter={() => setIsCloseBtnHovering(true)}
          onMouseLeave={() => setIsCloseBtnHovering(false)}
          aria-label="Fechar"
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
            border: 'none',
            background: 'unset',
            // border: '1px solid rgba(255,255,255,0.25)',
            // background: 'rgba(0,0,0,0.6)',
            color: isCloseBtnHovering ? '#f90041' : '#fff',
            cursor: 'pointer',
            padding: 0,
            transition: 'color .3s ease-in-out',
            // fontSize: 16,
            lineHeight: '32px',
          }}
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" fill="currentColor" viewBox="0 0 16 16" style={{ pointerEvents: 'none' }}>
            <path d="M16 8A8 8 0 1 1 0 8a8 8 0 0 1 16 0M5.354 4.646a.5.5 0 1 0-.708.708L7.293 8l-2.647 2.646a.5.5 0 0 0 .708.708L8 8.707l2.646 2.647a.5.5 0 0 0 .708-.708L8.707 8l2.647-2.646a.5.5 0 0 0-.708-.708L8 7.293z" />
          </svg>
        </button>
      ) : null}

      <div
        style={{
          width: '100%',
          height: '100%',
          borderRadius: 12,
          overflow: 'hidden',
          position: 'relative',
          background: '#000',
        }}
      >
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

        {/* Controles no hover (progresso + play/pause + volume) */}
        {shouldMountIframe ? (
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

        {shouldMountIframe ? (
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              zIndex: 2,
              padding: '10px 10px 14px',
              background: 'linear-gradient(180deg, rgba(0,0,0,0.78) 0%, rgba(0,0,0,0) 100%)',
              opacity: shouldShowHeader ? 1 : 0,
              transition: 'opacity .3s ease-in-out',
              pointerEvents: 'none',
            }}
          >
            <div style={{ color: '#fff', fontSize: 13, fontWeight: 700, lineHeight: '18px' }}>
              {videoMeta.title || 'YouTube Shorts'}
            </div>
            {videoMeta.author ? (
              <div style={{ color: 'rgba(255,255,255,0.86)', fontSize: 12, lineHeight: '16px' }}>
                {videoMeta.author}
              </div>
            ) : null}
          </div>
        ) : null}

        {shouldMountIframe ? (
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
                  onClick={togglePlayPause}
                  onMouseEnter={() => setIsPlayPauseBtnHovering(true)}
                  onMouseLeave={() => setIsPlayPauseBtnHovering(false)}
                  disabled={!playerReady}
                  aria-label={isVideoPlaying ? 'Pause' : 'Play'}
                  style={{
                    pointerEvents: 'auto',
                    width: 32,
                    height: 32,
                    borderRadius: 999,
                    border: '1px solid rgba(255,255,255,0.25)',
                    background: 'rgba(0,0,0,0.55)',
                    color: isPlayPauseBtnHovering && playerReady ? '#f90041' : '#fff',
                    cursor: playerReady ? 'pointer' : 'not-allowed',
                    fontWeight: 800,
                    fontSize: 16,
                    lineHeight: '32px',
                    transition: 'color .3s ease-in-out, background .3s ease-in-out, border-color .3s ease-in-out',
                  }}
                >
                  {/* {isVideoPlaying ? '||' : '>'} */}
                  {isVideoPlaying ? (
                    <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" fill="currentColor" viewBox="0 0 16 16" style={{ pointerEvents: 'none' }}><path d="M5.5 3.5A1.5 1.5 0 0 1 7 5v6a1.5 1.5 0 0 1-3 0V5a1.5 1.5 0 0 1 1.5-1.5m5 0A1.5 1.5 0 0 1 12 5v6a1.5 1.5 0 0 1-3 0V5a1.5 1.5 0 0 1 1.5-1.5" /></svg>
                  ) : (
                    <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" fill="currentColor" viewBox="0 0 16 16" style={{ pointerEvents: 'none' }}><path d="m11.596 8.697-6.363 3.692c-.54.313-1.233-.066-1.233-.697V4.308c0-.63.692-1.01 1.233-.696l6.363 3.692a.802.802 0 0 1 0 1.393" /></svg>
                  )}
                </button>

                {/* Botão de volume + slider vertical no hover */}
                <div
                  data-no-drag="true"
                  style={{ position: 'relative' }}
                  onMouseEnter={() => setIsVolumeHovering(true)}
                  onMouseLeave={() => setIsVolumeHovering(false)}
                >
                  <button
                    type="button"
                    data-no-drag="true"
                    onClick={() => {
                      if (!playerReady) return
                      const next = volume > 0 ? 0 : 50
                      onVolumeChange(next)
                    }}
                    onMouseEnter={() => setIsVolumeBtnHovering(true)}
                    onMouseLeave={() => setIsVolumeBtnHovering(false)}
                    disabled={!playerReady}
                    aria-label="Volume"
                    style={{
                      pointerEvents: 'auto',
                      width: 32,
                      height: 32,
                      borderRadius: 999,
                      border: '1px solid rgba(255,255,255,0.25)',
                      background: 'rgba(0,0,0,0.55)',
                      color: isVolumeBtnHovering && playerReady ? '#f90041' : '#fff',
                      cursor: playerReady ? 'pointer' : 'not-allowed',
                      fontWeight: 800,
                      fontSize: 14,
                      lineHeight: '32px',
                      transition: 'color .3s ease-in-out, background .3s ease-in-out, border-color .3s ease-in-out',
                    }}
                  >
                    {/* {volume === 0 ? 'M' : 'V'} */}
                    {volume === 0 ? (
                      <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" fill="currentColor" viewBox="0 0 16 16" style={{ pointerEvents: 'none' }}><path d="M6.717 3.55A.5.5 0 0 1 7 4v8a.5.5 0 0 1-.812.39L3.825 10.5H1.5A.5.5 0 0 1 1 10V6a.5.5 0 0 1 .5-.5h2.325l2.363-1.89a.5.5 0 0 1 .529-.06m7.137 2.096a.5.5 0 0 1 0 .708L12.207 8l1.647 1.646a.5.5 0 0 1-.708.708L11.5 8.707l-1.646 1.647a.5.5 0 0 1-.708-.708L10.793 8 9.146 6.354a.5.5 0 1 1 .708-.708L11.5 7.293l1.646-1.647a.5.5 0 0 1 .708 0" /></svg>
                    ) : (
                      <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" fill="currentColor" viewBox="0 0 16 16" style={{ pointerEvents: 'none' }}>
                        <path d="M11.536 14.01A8.47 8.47 0 0 0 14.026 8a8.47 8.47 0 0 0-2.49-6.01l-.708.707A7.48 7.48 0 0 1 13.025 8c0 2.071-.84 3.946-2.197 5.303z" />
                        <path d="M10.121 12.596A6.48 6.48 0 0 0 12.025 8a6.48 6.48 0 0 0-1.904-4.596l-.707.707A5.48 5.48 0 0 1 11.025 8a5.48 5.48 0 0 1-1.61 3.89z" />
                        <path d="M8.707 11.182A4.5 4.5 0 0 0 10.025 8a4.5 4.5 0 0 0-1.318-3.182L8 5.525A3.5 3.5 0 0 1 9.025 8 3.5 3.5 0 0 1 8 10.475zM6.717 3.55A.5.5 0 0 1 7 4v8a.5.5 0 0 1-.812.39L3.825 10.5H1.5A.5.5 0 0 1 1 10V6a.5.5 0 0 1 .5-.5h2.325l2.363-1.89a.5.5 0 0 1 .529-.06" />
                      </svg>
                    )}
                  </button>

                  {isVolumeHovering ? (
                    <div
                      style={{
                        position: 'absolute',
                        right: 0,
                        // bottom: 46,
                        bottom: 30,
                        width: 36,
                        height: 120,
                        padding: 8,
                        borderRadius: 10,
                        background: 'rgba(0,0,0,0.65)',
                        border: '1px solid rgba(255,255,255,0.14)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        transition: 'opacity .3s ease-in-out',
                      }}
                    >
                      <input
                        data-no-drag="true"
                        type="range"
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
                  ) : null}
                </div>

                {/* Barra de progresso (cor branca) */}
                {isMobile ? (
                  <button
                    type="button"
                    data-no-drag="true"
                    onClick={onToggleFullscreen}
                    onMouseEnter={() => setIsFullscreenBtnHovering(true)}
                    onMouseLeave={() => setIsFullscreenBtnHovering(false)}
                    disabled={!playerReady}
                    aria-label="Tela cheia"
                    style={{
                      pointerEvents: 'auto',
                      width: 32,
                      height: 32,
                      borderRadius: 999,
                      border: '1px solid rgba(255,255,255,0.25)',
                      background: 'rgba(0,0,0,0.55)',
                      color: isFullscreenBtnHovering && playerReady ? '#f90041' : '#fff',
                      cursor: playerReady ? 'pointer' : 'not-allowed',
                      lineHeight: '32px',
                      transition: 'color .3s ease-in-out, background .3s ease-in-out, border-color .3s ease-in-out',
                    }}
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" fill="currentColor" viewBox="0 0 16 16" style={{ pointerEvents: 'none' }}>
                      <path d="M1 1h5v1H2v4H1zM10 1h5v5h-1V2h-4zM1 10h1v4h4v1H1zM14 10h1v5h-5v-1h4z" />
                    </svg>
                  </button>
                ) : null}
                <input
                  data-no-drag="true"
                  type="range"
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
                  }}
                  aria-label="Progresso"
                />
              </div>
              {isMobile ? (
                <div
                  style={{
                    marginTop: 8,
                    display: 'flex',
                    justifyContent: 'center',
                    fontSize: 11,
                    color: 'rgba(255,255,255,0.82)',
                  }}
                >
                  Toque no widget para exibir os controles
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>

      {/* Resize é por bordas/cantos (sem handle visual). */}
    </div>
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
    muted: {
      type: 'boolean',
      title: 'Iniciar mutado',
      description: 'Recomendado para autoplay.',
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
    desktopAnchor: {
      type: 'string',
      title: 'Posição inicial no desktop',
      enum: ['top-left', 'top-right', 'bottom-left', 'bottom-right'],
      enumNames: ['Superior esquerda', 'Superior direita', 'Inferior esquerda', 'Inferior direita'],
      default: 'bottom-right',
    },
    desktopOffsetX: {
      type: 'number',
      title: 'Offset X no desktop (px)',
      default: 16,
    },
    desktopOffsetY: {
      type: 'number',
      title: 'Offset Y no desktop (px)',
      default: 16,
    },
    mobileAnchor: {
      type: 'string',
      title: 'Posição inicial no mobile (<1024px)',
      enum: ['top-left', 'top-right', 'bottom-left', 'bottom-right'],
      enumNames: ['Superior esquerda', 'Superior direita', 'Inferior esquerda', 'Inferior direita'],
      default: 'bottom-right',
    },
    mobileOffsetX: {
      type: 'number',
      title: 'Offset X no mobile (px)',
      default: 12,
    },
    mobileOffsetY: {
      type: 'number',
      title: 'Offset Y no mobile (px)',
      default: 12,
    },
  },
}

YoutubeShortsWidget.defaultProps = {
  shortsUrl: '',
  startOnLoad: true,
  muted: true,
  closable: true,
  looping: true,
  desktopAnchor: 'bottom-right',
  desktopOffsetX: 16,
  desktopOffsetY: 16,
  mobileAnchor: 'bottom-right',
  mobileOffsetX: 12,
  mobileOffsetY: 12,
}

export default YoutubeShortsWidget

