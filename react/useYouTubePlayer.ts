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
  iframeRef: React.RefObject<HTMLIFrameElement>
  videoId: string | null
  spaKey: number
  looping: boolean
  initialVolume: number
  startOnLoad: boolean
  isPlaying: boolean
  isHovering: boolean
  isMobile: boolean
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
    iframeRef,
    videoId,
    spaKey,
    looping,
    initialVolume,
    startOnLoad,
    isPlaying,
    isHovering,
    isMobile,
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

  isPlayingRef.current = isPlaying
  startOnLoadRef.current = startOnLoad

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
      setProgress({ currentTime: 0, duration: 0 })
      setVideoMeta({ title: '', author: '' })

      try {
        playerRef.current?.destroy?.()
      } catch {
        // noop
      }
      playerRef.current = null
    }
    // Dependências: recria quando o iframe é forçado por `spaKey`/troca de vídeo.
    // }, [shouldMountIframe, iframeRef, videoId, spaKey, looping])
  }, [shouldMountIframe, videoId, spaKey, looping, initialVolume])

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

  const onVolumeChange = useCallback((next: number) => {
    setVolume(next)
    if (isMobile) showMobileControls()
    const p = playerRef.current
    if (!p) return
    try {
      p.setVolume?.(next)
    } catch {
      // noop
    }
  }, [isMobile, showMobileControls])

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
