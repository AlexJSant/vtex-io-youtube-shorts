import { useEffect, useRef } from 'react'

type Listener = () => void

const listeners = new Set<Listener>()

let installed = false
let lastPath = ''

/**
 * Notifica os assinantes de forma assincrona.
 *
 * `pushState`/`replaceState` são chamados de dentro do commit do router do
 * `render-runtime`. Disparar `setState` de forma sincrona ali re-entra no
 * render de outro componente ("Cannot update a component while rendering a
 * different component") e pode corromper a árvore. O microtask garante que a
 * atualização aconteça depois do commit em andamento.
 *
 * A comparação é só de `pathname`: o runtime reescreve query string e hash da
 * própria URL durante o boot e a navegação, e tratar isso como troca de página
 * recriava o player recém-criado, deixando o vídeo preto.
 */
function notify() {
  if (typeof window === 'undefined') return

  const nextPath = window.location.pathname
  if (nextPath === lastPath) return
  lastPath = nextPath

  Promise.resolve().then(() => {
    listeners.forEach((listener) => {
      try {
        listener()
      } catch {
        // noop
      }
    })
  })
}

/**
 * O patch é instalado uma única vez por página e nunca é revertido.
 *
 * Reverter no unmount é o que quebrava a navegação da loja: com duas instâncias
 * (ou um remount), o cleanup restaurava uma referência já obsoleta de
 * `history.pushState` e o patch da outra instância era perdido.
 */
function installOnce() {
  if (installed) return
  if (typeof window === 'undefined') return
  installed = true

  lastPath = window.location.pathname

  window.addEventListener('popstate', notify)
  window.addEventListener('hashchange', notify)

  const originalPushState = window.history.pushState
  const originalReplaceState = window.history.replaceState

  window.history.pushState = function patchedPushState(this: History, ...args: any[]) {
    const ret = originalPushState.apply(this, args as any)
    notify()
    return ret
  } as typeof window.history.pushState

  window.history.replaceState = function patchedReplaceState(this: History, ...args: any[]) {
    const ret = originalReplaceState.apply(this, args as any)
    notify()
    return ret
  } as typeof window.history.replaceState
}

/**
 * Executa `onRouteChange` quando a rota muda numa navegação SPA.
 *
 * `enabled` existe para adiar a instalação até a página estar carregada: durante
 * o boot o runtime reescreve a própria URL, e nada disso é navegação de verdade.
 */
function useRouteChange(onRouteChange: () => void, enabled = true) {
  const handlerRef = useRef(onRouteChange)
  handlerRef.current = onRouteChange

  useEffect(() => {
    if (!enabled) return

    installOnce()

    const listener = () => handlerRef.current()
    listeners.add(listener)

    return () => {
      listeners.delete(listener)
    }
  }, [enabled])
}

export default useRouteChange
