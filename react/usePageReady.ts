import { useEffect, useState } from 'react'

/**
 * `true` somente depois de a página terminar de carregar (evento `load`), isto é,
 * depois de todo o HTML, CSS, imagens e scripts da loja.
 *
 * Dois motivos:
 *
 * - Performance: o widget é acessório. Montá-lo antes disso faz o iframe do
 *   YouTube disputar banda e main thread com o conteúdo principal da página.
 * - Estabilidade: durante o boot o `render-runtime` ainda reescreve a rota
 *   (`replaceState`). Criar o player nesse meio tempo o expõe a um ciclo de
 *   destruição/recriação imediato, que deixa o vídeo preto.
 *
 * Em navegação SPA o evento `load` não acontece de novo, mas o `readyState`
 * permanece `complete`, então uma remontagem posterior libera na hora.
 */
function usePageReady(): boolean {
  const [isPageReady, setIsPageReady] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') return

    let raf = 0

    const release = () => {
      // Um frame depois do `load`, para o runtime terminar de acomodar a rota.
      raf = window.requestAnimationFrame(() => {
        raf = 0
        setIsPageReady(true)
      })
    }

    if (document.readyState === 'complete') {
      release()
      return () => {
        if (raf) window.cancelAnimationFrame(raf)
      }
    }

    window.addEventListener('load', release)
    return () => {
      window.removeEventListener('load', release)
      if (raf) window.cancelAnimationFrame(raf)
    }
  }, [])

  return isPageReady
}

export default usePageReady
