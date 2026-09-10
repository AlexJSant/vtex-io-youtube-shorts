import React, { useCallback, useEffect, useRef, useState } from 'react'

type VideoMeta = { title: string; author: string }

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

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n))
}

function useYouTubePlayer(options: {
  shouldMountIframe: boolean
  /**
   * Container controlado pelo React. O `<iframe>` é criado imperativamente dentro
   * dele porque `YT.Player#destroy()` remove o próprio nó do DOM: se o React fosse
   * o dono do iframe, a remoção seguinte feita pelo React falharia com
   * `NotFoundError: Failed to execute 'removeChild' on 'Node'`, quebrando a árvore
   * de componentes da página inteira.
   */
  hostRef: React.RefObject<HTMLDivElement>
  embedUrl: string | null
  videoId: string | null
  spaKey: number
  looping: boolean
  initialVolume: number
  startOnLoad: boolean
  isPlaying: boolean
  isHovering: boolean
  isCompact: boolean
  showMobileControls: () => void
}): {
  playerReady: boolean
  isVideoPlaying: boolean
  progress: { currentTime: number; duration: number }
  volume: number
  videoMeta: { title: string; author: string }
  togglePlayPause: () => void
  onSeekFromPercent: (percent: number) => void
  onVolumeChange: (next: number) => void
  pauseVideo: () => void
  playVideo: () => void
} {
  const {
    shouldMountIframe,
    hostRef,
    embedUrl,
    videoId,
    spaKey,
    looping,
    initialVolume,
    startOnLoad,
    isPlaying,
    isHovering,
    isCompact,
    showMobileControls,
  } = options

  const playerRef = useRef<any>(null)
  const [playerReady, setPlayerReady] = useState(false)
  const [isVideoPlaying, setIsVideoPlaying] = useState(false)
  const [progress, setProgress] = useState<{ currentTime: number; duration: number }>({
    currentTime: 0,
    duration: 0,
  })
  const [volume, setVolume] = useState<number>(initialVolume)
  const [videoMeta, setVideoMeta] = useState<VideoMeta>({ title: '', author: '' })
  const isPlayingRef = useRef(isPlaying)
  const startOnLoadRef = useRef(startOnLoad)
  const isUnmountedRef = useRef(false)

  isPlayingRef.current = isPlaying
  startOnLoadRef.current = startOnLoad

  // Declarado antes do efeito do player: no unmount o React roda os cleanups na
  // ordem de declaração dos hooks, então a flag já está ligada quando o player limpa.
  useEffect(
    () => () => {
      isUnmountedRef.current = true
    },
    [],
  )

  // Cria o iframe e inicializa o player do YouTube via IFrame API.
  useEffect(() => {
    if (!shouldMountIframe) return
    if (!embedUrl) return

    const host = hostRef.current
    if (!host) return

    let cancelled = false

    const iframe = document.createElement('iframe')
    iframe.title = 'YouTube Shorts'
    iframe.id = `ytw-${videoId}-${spaKey}`
    iframe.src = embedUrl
    iframe.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen'
    iframe.setAttribute('allowfullscreen', 'true')
    iframe.setAttribute('loading', startOnLoadRef.current ? 'eager' : 'lazy')
    iframe.setAttribute('frameborder', '0')
    iframe.referrerPolicy = 'strict-origin-when-cross-origin'
    iframe.style.position = 'absolute'
    iframe.style.zIndex = '0'
    iframe.style.top = '0'
    iframe.style.left = '0'
    iframe.style.width = '100%'
    iframe.style.height = '100%'
    iframe.style.border = '0'

    host.appendChild(iframe)

    loadYouTubeIframeAPI().then(() => {
      if (cancelled) return
      if (!window.YT?.Player) return
      // O iframe pode ter sido descartado enquanto a API carregava.
      if (!iframe.parentNode) return

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
              player.setVolume?.(initialVolume)
              setVolume(initialVolume)
            } catch {
              // noop
            }

            try {
              if (startOnLoadRef.current || isPlayingRef.current) player.playVideo?.()
            } catch {
              // noop
            }
          },
          onStateChange: (evt: any) => {
            if (cancelled) return
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

      if (!isUnmountedRef.current) {
        setPlayerReady(false)
        setIsVideoPlaying(false)
        setProgress({ currentTime: 0, duration: 0 })
        setVideoMeta({ title: '', author: '' })
      }

      try {
        // `destroy()` remove o nó do DOM por conta própria; por isso ele nunca
        // pode ser um nó renderizado pelo React.
        playerRef.current?.destroy?.()
      } catch {
        // noop
      }
      playerRef.current = null

      // Limpa o que sobrou (o iframe original ou o nó substituto criado pela API
      // do YouTube), sempre conferindo o pai real antes de remover.
      try {
        if (iframe.parentNode === host) host.removeChild(iframe)
        while (host.firstChild) host.removeChild(host.firstChild)
      } catch {
        // noop
      }
    }
    // Dependências: recria quando o iframe é forçado por `spaKey`/troca de vídeo.
  }, [shouldMountIframe, hostRef, embedUrl, videoId, spaKey, looping, initialVolume])

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

    if (isCompact) showMobileControls()

    try {
      if (isVideoPlaying) p.pauseVideo?.()
      else p.playVideo?.()
    } catch {
      // noop
    }
  }, [isCompact, isVideoPlaying, showMobileControls])

  const onSeekFromPercent = useCallback(
    (percent: number) => {
      const p = playerRef.current
      if (!p) return
      if (!progress.duration) return

      if (isCompact) showMobileControls()

      const seconds = (clamp(percent, 0, 100) / 100) * progress.duration
      try {
        p.seekTo?.(seconds, true)
      } catch {
        // noop
      }
    },
    [isCompact, progress.duration, showMobileControls],
  )

  const onVolumeChange = useCallback((next: number) => {
    setVolume(next)
    if (isCompact) showMobileControls()
    const p = playerRef.current
    if (!p) return
    try {
      p.setVolume?.(next)
    } catch {
      // noop
    }
  }, [isCompact, showMobileControls])

  const pauseVideo = useCallback(() => {
    try {
      playerRef.current?.pauseVideo?.()
    } catch {
      // noop
    }
  }, [])

  const playVideo = useCallback(() => {
    try {
      playerRef.current?.playVideo?.()
    } catch {
      // noop
    }
  }, [])

  return {
    playerReady,
    isVideoPlaying,
    progress,
    volume,
    videoMeta,
    togglePlayPause,
    onSeekFromPercent,
    onVolumeChange,
    pauseVideo,
    playVideo,
  }
}

export default useYouTubePlayer
