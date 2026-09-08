import React, { useCallback, useEffect, useRef, useState } from 'react'
import { getViewportWidth } from './viewport'

type Pos = { left: number; top: number }
type ResizeEdge = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'

/** Acima desta duração o gesto deixa de ser considerado toque, mesmo sem movimento. */
const TAP_MAX_DURATION_MS = 180
const TAP_MOVE_TOLERANCE_PX = 8
const EDGE_THRESHOLD_PX = 10
const CORNER_THRESHOLD_PX = 14

/** Alça de drag renderizada fora do box do card (abaixo da borda inferior). */
export const DRAG_HANDLE_SELECTOR = '[data-ytw-drag-handle="true"]'

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n))
}

function useDragResize(options: {
  cardRef: React.RefObject<HTMLDivElement>
  posRef: React.MutableRefObject<Pos>
  setPosThrottled: (pos: Pos) => void
  size: { width: number; height: number }
  setSize: React.Dispatch<React.SetStateAction<{ width: number; height: number }>>
  isCompact: boolean
  isDockMode: boolean
  isVideoPlaying: boolean
  dockPosRef: React.MutableRefObject<Pos>
  isDockedRef: React.MutableRefObject<boolean>
  setIsDocked: (v: boolean) => void
  setIsDockHovering: (v: boolean) => void
  setPos: React.Dispatch<React.SetStateAction<Pos>>
  onTapToggle?: () => void
  /** Espaço ocupado abaixo do card (alça de drag) que deve caber na viewport. */
  bottomReservedPx?: number
  /** Proporção largura/altura preservada no resize (9/16 no padrão, 16/9 no modo Live). */
  aspectRatioWH: number
  minWidth: number
  maxWidth: number
}): {
  resizeCursor: string | null
  onPointerDownCard: (e: React.PointerEvent<HTMLDivElement>) => void
  onPointerMoveCard: (e: React.PointerEvent<HTMLDivElement>) => void
  onPointerUpCard: (e: React.PointerEvent<HTMLDivElement>) => void
} {
  const {
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
    onTapToggle,
    bottomReservedPx = 0,
    aspectRatioWH,
    minWidth,
    maxWidth,
  } = options

  const maxTopFor = useCallback(
    (height: number) => Math.max(0, window.innerHeight - height - bottomReservedPx),
    [bottomReservedPx],
  )

  const heightFor = useCallback(
    (width: number) => Math.round(width / aspectRatioWH),
    [aspectRatioWH],
  )
  const widthFor = useCallback(
    (height: number) => Math.round(height * aspectRatioWH),
    [aspectRatioWH],
  )

  const [resizeCursor, setResizeCursor] = useState<string | null>(null)
  const lastResizeCursorRef = useRef<string | null>(null)

  // Drag do widget: qualquer parte (exceto elementos interativos).
  const dragRef = useRef<{
    pointerId: number
    startClientX: number
    startClientY: number
    startLeft: number
    startTop: number
    width: number
    height: number
    /** Vira `true` assim que o ponteiro passa da tolerância de toque. */
    hasMoved: boolean
  } | null>(null)
  /** Ausente quando o arrasto começa pela alça: ela não tem janela de toque nem tap. */
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

  const getResizeEdgeFromPoint = useCallback(
    (x: number, y: number, rect: DOMRect): ResizeEdge | null => {
      // Elementos fora do box do card (ex.: alça de drag) não redimensionam:
      // sem esse guarda, um ponto abaixo de `rect.bottom` gera distância
      // negativa e passaria no teste de proximidade da borda sul.
      if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) return null

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

  const onPointerDownCard = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!cardRef.current) return
      if (e.button !== 0) return

      const target = e.target as Element | null

      // Não inicia drag em botões/inputs/elementos explicitamente marcados.
      if (target?.closest('button, input, select, textarea, [data-no-drag="true"]')) return

      const fromHandle = !!target?.closest(DRAG_HANDLE_SELECTOR)

      const rect = cardRef.current.getBoundingClientRect()
      const width = rect.width || size.width
      const height = rect.height || size.height

      const edge =
        isCompact || fromHandle ? null : getResizeEdgeFromPoint(e.clientX, e.clientY, rect)
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
        hasMoved: false,
      }

      // A alça arrasta de imediato: sem janela de toque e sem toque-para-pausar.
      pressRef.current = fromHandle
        ? null
        : {
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
    [cardRef, getResizeEdgeFromPoint, isCompact, posRef, size.height, size.width],
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

        const minHeight = heightFor(minWidth)
        const maxHeight = heightFor(maxWidth)
        // Com limites de largura maiores, a altura derivada pode estourar a viewport
        // antes de a largura atingir o teto.
        const maxWidthByViewportHeight = widthFor(maxTopFor(0))

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
            const maxW = Math.min(maxWidth, maxWidthByViewportHeight, getViewportWidth() - r.startLeft)
            nextWidth = clamp(nextWidth, minWidth, maxW)
          } else {
            // 'w' / 'nw' / 'sw'
            const fixedRight = r.startLeft + r.startWidth
            nextWidth = r.startWidth - dx
            const maxW = Math.min(maxWidth, maxWidthByViewportHeight, fixedRight)
            nextWidth = clamp(nextWidth, minWidth, maxW)
            nextLeft = fixedRight - nextWidth
          }

          nextHeight = heightFor(nextWidth)

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
            const maxH = Math.min(maxTopFor(0) - r.startTop, maxHeight)
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

          nextWidth = widthFor(nextHeight)
          nextHeight = heightFor(nextWidth)
        }

        // Clamps finais dentro da viewport
        nextWidth = Math.round(nextWidth)
        nextHeight = Math.round(nextHeight)
        nextLeft = clamp(nextLeft, 0, getViewportWidth() - nextWidth)
        nextTop = clamp(nextTop, 0, maxTopFor(nextHeight))

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

        // A distinção entre toque e arrasto é por distância, não por tempo: esperar
        // uma janela fixa antes de mover deixava o card travado no início do gesto.
        if (press && press.pointerId === e.pointerId && !d.hasMoved) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) <= TAP_MOVE_TOLERANCE_PX) return
          d.hasMoved = true
        }

        const nextLeft = clamp(d.startLeft + dx, 0, getViewportWidth() - d.width)
        const nextTop = clamp(d.startTop + dy, 0, maxTopFor(d.height))

        setPosThrottled({ left: nextLeft, top: nextTop })
        return
      }

      // Atualiza cursor nas bordas/cantos quando não está arrastando/redimensionando.
      if (isCompact) return
      if (!cardRef.current) return
      const rect = cardRef.current.getBoundingClientRect()
      const edge = getResizeEdgeFromPoint(e.clientX, e.clientY, rect)
      const cursor = edge ? getCursorForEdge(edge) : null

      if (cursor !== lastResizeCursorRef.current) {
        lastResizeCursorRef.current = cursor
        setResizeCursor(cursor)
      }
    },
    [
      cardRef,
      getCursorForEdge,
      getResizeEdgeFromPoint,
      heightFor,
      isCompact,
      maxTopFor,
      maxWidth,
      minWidth,
      setPosThrottled,
      setSize,
      widthFor,
    ],
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

      // Arrasto pela alça nunca conta como toque; o snap da doca segue valendo.
      let isTap = false
      if (press && press.pointerId === e.pointerId && !d.hasMoved) {
        const elapsedMs = performance.now() - press.startedAtMs
        const movedX = Math.abs(e.clientX - d.startClientX)
        const movedY = Math.abs(e.clientY - d.startClientY)
        const moved = Math.max(movedX, movedY)
        isTap = elapsedMs < TAP_MAX_DURATION_MS && moved <= TAP_MOVE_TOLERANCE_PX
      }
      void isVideoPlaying

      if (isTap) {
        onTapToggle?.()
      }

      // Dock snap: soltar arrastando perto do dock => fica “acoplado”.
      if (!isTap && isDockMode) {
        const current = posRef.current
        const dock = dockPosRef.current

        // A doca considera “todo o espaço do canto direito” com tolerancia de 10%
        // do espaço disponível entre o meio da tela e o lado direito.
        const currentRightEdge = current.left + size.width
        const dockRightEdge = dock.left + size.width
        const regionLeftX = getViewportWidth() / 2
        const regionWidth = Math.max(0, dockRightEdge - regionLeftX)
        const dockRightEdgeMin = dockRightEdge - regionWidth * 0.1
        const shouldDock = currentRightEdge >= dockRightEdgeMin

        if (shouldDock) {
          setIsDocked(true)
          setIsDockHovering(false)
          setPos(dock)
        } else if (isDockedRef.current) {
          setIsDocked(false)
          setIsDockHovering(false)
        }
      }

      e.preventDefault()
    },
    [
      dockPosRef,
      isDockMode,
      isDockedRef,
      isVideoPlaying,
      posRef,
      setIsDockHovering,
      setIsDocked,
      setPos,
      size.width,
      onTapToggle,
    ],
  )

  // Mantém o widget dentro dos limites da janela ao redimensionar.
  useEffect(() => {
    setPos((p) => ({
      left: clamp(p.left, 0, getViewportWidth() - size.width),
      top: clamp(p.top, 0, maxTopFor(size.height)),
    }))
  }, [maxTopFor, setPos, size.width, size.height])

  return {
    resizeCursor,
    onPointerDownCard,
    onPointerMoveCard,
    onPointerUpCard,
  }
}

export default useDragResize
