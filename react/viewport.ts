/**
 * Largura útil da viewport.
 *
 * Diferente de `window.innerWidth`, não inclui a barra de rolagem clássica do desktop.
 * Posicionar elementos `position: fixed` por `innerWidth` os empurra para debaixo da
 * barra (~16px), cortando o que estiver encostado na borda direita. No mobile a barra
 * é sobreposta e os dois valores coincidem, por isso o desvio só aparece no desktop.
 *
 * Vive em módulo próprio porque a doca, o card e o resize precisam concordar no mesmo
 * valor — se divergirem, a geometria do widget se desalinha.
 */
export function getViewportWidth() {
  if (typeof document !== 'undefined') {
    return document.documentElement?.clientWidth || window.innerWidth
  }
  // No SSR não existe nem `document` nem `window`.
  return typeof window !== 'undefined' ? window.innerWidth : 0
}
