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
}

type Pos = { left: number; top: number }

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n))
}

function isValidYoutubeVideoId(id: string) {
  // YouTube IDs são base64url-like e tipicamente têm 11 caracteres.
  // A regex abaixo cobre o formato comum sem ser permissiva demais.
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
    // Se vier sem protocolo, tenta tratar como domínio youtube? Mantemos seguro: não adivinhamos demais.
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

  // youtube.com/shorts/<id>
  // youtube.com/watch?v=<id>
  // youtube.com/embed/<id>
  const isYoutubeHost =
    host === 'youtube.com' ||
    host === 'm.youtube.com' ||
    host === 'music.youtube.com' ||
    host.endsWith('.youtube.com')

  if (!isYoutubeHost) return null

  if (segments[0] === 'shorts' && segments.length >= 2) {
    const id = segments[1]
    return isValidYoutubeVideoId(id) ? id : null
  }

  if (segments[0] === 'embed' && segments.length >= 2) {
    const id = segments[1]
    return isValidYoutubeVideoId(id) ? id : null
  }

  // watch?v=<id>
  const v = url.searchParams.get('v')
  if (v && isValidYoutubeVideoId(v)) return v

  return null
}

function buildYoutubeEmbedUrl(videoId: string, options: { muted: boolean; autoplay: boolean }) {
  const params = new URLSearchParams()
  // Autoplay no embed costuma precisar de autoplay=1
  if (options.autoplay) params.set('autoplay', '1')
  // mute=1
  if (options.muted) params.set('mute', '1')

  // Melhor UX / compatibilidade
  params.set('playsinline', '1')
  params.set('modestbranding', '1')
  params.set('rel', '0')
  params.set('showinfo', '0')
  params.set('controls', '0')

  // hide controls já ajuda a ficar “widget”, mas sem ser “suspeito”
  return `https://www.youtube.com/embed/${videoId}?${params.toString()}`
}

const YoutubeShortsWidget: React.FC<YoutubeShortsWidgetProps> = ({
  shortsUrl,
  startOnLoad,
  muted,
  closable,
}) => {
  const cardRef = useRef<HTMLDivElement | null>(null)

  const videoId = useMemo(() => extractYoutubeVideoId(shortsUrl), [shortsUrl])

  const [isClosed, setIsClosed] = useState(false)
  const [isPlaying, setIsPlaying] = useState(false)

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

  // Reset correto em SPA quando trocar de PDP (props mudam).
  useEffect(() => {
    setIsClosed(false)
    setIsPlaying(false)
  }, [shortsUrl, startOnLoad])

  // Ajuste inicial para ficar no canto inferior.
  useEffect(() => {
    if (!cardRef.current) return
    const rect = cardRef.current.getBoundingClientRect()
    const width = rect.width || 280
    const height = rect.height || 480
    const rightMargin = 16
    const bottomMargin = 16
    const initial: Pos = {
      left: window.innerWidth - width - rightMargin,
      top: window.innerHeight - height - bottomMargin,
    }
    setPos({
      left: clamp(initial.left, 0, window.innerWidth - width),
      top: clamp(initial.top, 0, window.innerHeight - height),
    })
  }, [videoId])

  // Re-clamp em resize.
  useEffect(() => {
    const onResize = () => {
      if (!cardRef.current) return
      const rect = cardRef.current.getBoundingClientRect()
      const width = rect.width || 280
      const height = rect.height || 480
      setPos((p) => ({
        left: clamp(p.left, 0, window.innerWidth - width),
        top: clamp(p.top, 0, window.innerHeight - height),
      }))
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const shouldMountIframe = !!videoId && !isClosed && (startOnLoad || isPlaying)
  const autoplay = startOnLoad || isPlaying

  const embedUrl = useMemo(() => {
    if (!videoId) return null
    return buildYoutubeEmbedUrl(videoId, { muted, autoplay })
  }, [videoId, muted, autoplay])

  const onClose = useCallback(() => {
    // “matar” o iframe para garantir pause e liberar recursos.
    setIsClosed(true)
  }, [])

  const onPlay = useCallback(() => {
    setIsPlaying(true)
  }, [])

  // Drag do card (handle).
  const dragRef = useRef<{
    pointerId: number
    startClientX: number
    startClientY: number
    startLeft: number
    startTop: number
    width: number
    height: number
  } | null>(null)

  const onPointerDownHandle = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!cardRef.current) return
      if (e.button !== 0) return
      // Evita começar drag quando o usuário clica no botão X.
      if (e.target instanceof HTMLElement && e.target.closest('button')) return

      const rect = cardRef.current.getBoundingClientRect()
      const width = rect.width || 280
      const height = rect.height || 480

      dragRef.current = {
        pointerId: e.pointerId,
        startClientX: e.clientX,
        startClientY: e.clientY,
        startLeft: posRef.current.left,
        startTop: posRef.current.top,
        width,
        height,
      }

      try {
        e.currentTarget.setPointerCapture(e.pointerId)
      } catch {
        // Sem problemas: se o browser não suportar, ainda assim tentaremos pelos eventos do handle.
      }
      e.preventDefault()
    },
    [],
  )

  const onPointerMoveHandle = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return
    if (!cardRef.current) return

    const d = dragRef.current
    if (e.pointerId !== d.pointerId) return

    const dx = e.clientX - d.startClientX
    const dy = e.clientY - d.startClientY

    const nextLeft = clamp(d.startLeft + dx, 0, window.innerWidth - d.width)
    const nextTop = clamp(d.startTop + dy, 0, window.innerHeight - d.height)

    setPosThrottled({ left: nextLeft, top: nextTop })
  }, [setPosThrottled])

  const onPointerUpHandle = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return
    if (e.pointerId !== dragRef.current.pointerId) return
    dragRef.current = null
    e.preventDefault()
  }, [])

  // Widget leve: sem buscar dados externos além do embed do próprio YouTube.
  // Quando “startOnLoad=false”, não montamos o iframe até ação do usuário.
  if (!videoId) return null
  if (isClosed) return null

  return (
    <div
      ref={cardRef}
      style={{
        position: 'fixed',
        left: pos.left,
        top: pos.top,
        width: '80vw',
        maxWidth: 320,
        zIndex: 9999,
        borderRadius: 12,
        overflow: 'hidden',
        background: 'transparent',
        touchAction: 'none', // ajuda a não “roubar” o drag no mobile
      }}
      aria-label="YouTube Shorts widget"
    >
      {/* Handle arrastável */}
      <div
        onPointerDown={onPointerDownHandle}
        onPointerMove={onPointerMoveHandle}
        onPointerUp={onPointerUpHandle}
        style={{
          height: 28,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 8px',
          background: 'rgba(0,0,0,0.55)',
          cursor: 'grab',
          userSelect: 'none',
        }}
      >
        <div style={{ color: 'white', fontSize: 12, fontWeight: 600, opacity: 0.9 }}>
          Shorts
        </div>

        {closable ? (
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            style={{
              appearance: 'none',
              border: 'none',
              background: 'transparent',
              color: 'white',
              fontSize: 16,
              lineHeight: 1,
              cursor: 'pointer',
              padding: 0,
              width: 24,
              height: 24,
            }}
          >
            ×
          </button>
        ) : (
          <div style={{ width: 24 }} />
        )}
      </div>

      {/* Conteúdo (proporção vertical) */}
      <div
        style={{
          position: 'relative',
          width: '100%',
          aspectRatio: '9 / 16',
          background: '#000',
        }}
      >
        {shouldMountIframe && embedUrl ? (
          <iframe
            key={videoId} // força remount quando trocar de PDP/produto
            title="YouTube Shorts"
            src={embedUrl}
            style={{
              position: 'absolute',
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
      </div>
    </div>
  )
}

// Schema para o Site Editor
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
      description: 'Se desativado, o vídeo só carrega quando o usuário tocar em “Tocar para iniciar”.',
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
  },
}

YoutubeShortsWidget.defaultProps = {
  shortsUrl: '',
  startOnLoad: true,
  muted: true,
  closable: true,
}

export default YoutubeShortsWidget

