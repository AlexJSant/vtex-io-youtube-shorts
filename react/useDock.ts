import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'

type Pos = { left: number; top: number }

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n))
}

function useDock(options: {
  isDockMode: boolean
  isMobile: boolean
  dockOffsetX: number
  size: { width: number; height: number }
  pos: Pos
}): {
  isDocked: boolean
  isDockHovering: boolean
  isDockedRef: React.MutableRefObject<boolean>
  dockPos: Pos
  dockPosRef: React.MutableRefObject<Pos>
  dockHoverIgnoreUntilRef: React.MutableRefObject<number>
  cancelDockHide: () => void
  scheduleDockHide: () => void
  applyDockMode: (isDockedMode: boolean) => void
  setIsDocked: (v: boolean) => void
  setIsDockHovering: (v: boolean) => void
} {
  const { isDockMode, dockOffsetX, size, pos } = options

  const [isDocked, setIsDockedState] = useState(false)
  const [isDockHovering, setIsDockHoveringState] = useState(false)

  const isDockedRef = useRef(isDocked)
  const dockHideTimerRef = useRef<number | null>(null)
  const dockPosRef = useRef<Pos>({ left: 0, top: 0 })
  const dockHoverIgnoreUntilRef = useRef<number>(0)

  const dockPos = useMemo(() => {
    if (typeof window === 'undefined') return { left: pos.left, top: pos.top }
    const rightEdgeX = window.innerWidth - dockOffsetX
    const left = clamp(rightEdgeX - size.width, 0, window.innerWidth - size.width)
    const top = (window.innerHeight - size.height) / 2
    const clampedTop = clamp(top, 0, window.innerHeight - size.height)
    return { left, top: clampedTop }
  }, [dockOffsetX, size.width, size.height, pos.left, pos.top])

  // Sync de refs (evita stale closure).
  isDockedRef.current = isDocked
  dockPosRef.current = dockPos

  const cancelDockHide = useCallback(() => {
    if (dockHideTimerRef.current == null) return
    window.clearTimeout(dockHideTimerRef.current)
    dockHideTimerRef.current = null
  }, [])

  const scheduleDockHide = useCallback(() => {
    if (!isDockMode) return
    cancelDockHide()
    dockHoverIgnoreUntilRef.current = performance.now() + 200
    dockHideTimerRef.current = window.setTimeout(() => {
      // Se não estiver mais acoplado, não faz sentido esconder.
      if (!isDockedRef.current) return
      setIsDockHoveringState(false)
      dockHideTimerRef.current = null
    }, 120)
  }, [cancelDockHide, isDockMode])

  const applyDockMode = useCallback((isDockedMode: boolean) => {
    cancelDockHide()
    setIsDockedState(isDockedMode)
    setIsDockHoveringState(false)
  }, [cancelDockHide])

  useEffect(() => () => {
    if (dockHideTimerRef.current != null) {
      window.clearTimeout(dockHideTimerRef.current)
      dockHideTimerRef.current = null
    }
  }, [])

  return {
    isDocked,
    isDockHovering,
    isDockedRef,
    dockPos,
    dockPosRef,
    dockHoverIgnoreUntilRef,
    cancelDockHide,
    scheduleDockHide,
    applyDockMode,
    setIsDocked: setIsDockedState,
    setIsDockHovering: setIsDockHoveringState,
  }
}

export default useDock
