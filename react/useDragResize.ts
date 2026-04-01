import React, { useCallback, useEffect, useRef, useState } from 'react'

type Pos = { left: number; top: number }
type ResizeEdge = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'

const ASPECT_RATIO_W_H = 9 / 16
const MIN_WIDTH = 200
const MAX_WIDTH = 350
const LONG_PRESS_MS = 180
const TAP_MOVE_TOLERANCE_PX = 8
const EDGE_THRESHOLD_PX = 10
const CORNER_THRESHOLD_PX = 14

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n))
}

function useDragResize(options: {
  cardRef: React.RefObject<HTMLDivElement>
  posRef: React.MutableRefObject<Pos>
  setPosThrottled: (pos: Pos) => void
  size: { width: number; height: number }
  setSize: React.Dispatch<React.SetStateAction<{ width: number; height: number }>>
  isMobile: boolean
  isDockMode: boolean
  isVideoPlaying: boolean
  dockPosRef: React.MutableRefObject<Pos>
  isDockedRef: React.MutableRefObject<boolean>
  setIsDocked: (v: boolean) => void
  setIsDockHovering: (v: boolean) => void
  setPos: React.Dispatch<React.SetStateAction<Pos>>
  onTapToggle?: () => void
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
    isMobile,
    isDockMode,
    isVideoPlaying,
    dockPosRef,
    isDockedRef,
    setIsDocked,
    setIsDockHovering,
    setPos,
    onTapToggle,
  } = options

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

  const onPointerDownCard = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!cardRef.current) return
      if (e.button !== 0) return

      const target = e.target as Element | null

      // Não inicia drag em botões/inputs/elementos explicitamente marcados.
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
    [cardRef, getResizeEdgeFromPoint, isMobile, posRef, size.height, size.width],
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
    [cardRef, getCursorForEdge, getResizeEdgeFromPoint, isMobile, setPosThrottled, setSize],
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
        const regionLeftX = window.innerWidth / 2
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
      left: clamp(p.left, 0, window.innerWidth - size.width),
      top: clamp(p.top, 0, window.innerHeight - size.height),
    }))
  }, [setPos, size.width, size.height])

  return {
    resizeCursor,
    onPointerDownCard,
    onPointerMoveCard,
    onPointerUpCard,
  }
}

export default useDragResize
