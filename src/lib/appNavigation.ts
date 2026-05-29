/** Al abrir la app, siempre arrancar en Inicio (/#/). */
export function resetAppRouteToInicio() {
  if (typeof window === 'undefined') return
  window.location.hash = '#/'
}
