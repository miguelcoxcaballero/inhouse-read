// Gestos táctiles compartidos por los lectores (PDF y foliate/EPUB/MOBI):
// swipe horizontal para pasar página, tap en el tercio izquierdo/derecho
// para navegar, tap central para alternar la barra de herramientas, y
// doble-tap para zoom. La lógica de "qué gesto es este" está separada del
// wiring a eventos DOM para poder testearla sin un navegador real.

export const ZONE = { PREV: 'prev', NEXT: 'next', CENTER: 'center' }

const EDGE_ZONE_FRACTION = 0.28
const SWIPE_MIN_DISTANCE = 40
const SWIPE_MAX_DURATION = 600
const DOUBLE_TAP_MAX_DELAY = 300
const TAP_MAX_MOVEMENT = 10

/** ¿En qué zona horizontal cae un tap, dado el ancho total del área? */
export function classifyTapZone(x, width) {
  if (width <= 0) return ZONE.CENTER
  const fraction = x / width
  if (fraction <= EDGE_ZONE_FRACTION) return ZONE.PREV
  if (fraction >= 1 - EDGE_ZONE_FRACTION) return ZONE.NEXT
  return ZONE.CENTER
}

/** ¿Este gesto de arrastre cuenta como swipe de página, y en qué sentido? */
export function classifySwipe({ dx, dy, durationMs }) {
  if (durationMs > SWIPE_MAX_DURATION) return null
  if (Math.abs(dx) < SWIPE_MIN_DISTANCE) return null
  if (Math.abs(dy) > Math.abs(dx)) return null // gesto más vertical que horizontal: no es swipe de página
  return dx < 0 ? ZONE.NEXT : ZONE.PREV
}

/**
 * Adjunta el manejo de gestos a un elemento contenedor. Devuelve una
 * función `detach()` para limpiar los listeners al cerrar el lector.
 */
export function attachSwipeNavigation(el, { onNext, onPrev, onToggleZoom, onToggleChrome } = {}) {
  let startX = 0
  let startY = 0
  let startTime = 0
  let lastTapTime = 0
  let lastTapX = 0
  let lastTapY = 0

  const onPointerDown = e => {
    startX = e.clientX
    startY = e.clientY
    startTime = performance.now()
  }

  const onPointerUp = e => {
    const dx = e.clientX - startX
    const dy = e.clientY - startY
    const durationMs = performance.now() - startTime
    const movement = Math.hypot(dx, dy)

    const swipe = classifySwipe({ dx, dy, durationMs })
    if (swipe === ZONE.NEXT) return onNext?.()
    if (swipe === ZONE.PREV) return onPrev?.()

    if (movement > TAP_MAX_MOVEMENT) return // arrastre que no llegó a swipe: ignorar

    const now = performance.now()
    const isDoubleTap = now - lastTapTime < DOUBLE_TAP_MAX_DELAY
      && Math.hypot(e.clientX - lastTapX, e.clientY - lastTapY) < 30
    lastTapTime = now
    lastTapX = e.clientX
    lastTapY = e.clientY

    if (isDoubleTap) {
      lastTapTime = 0 // evita que un tercer tap se lea como otro double-tap
      return onToggleZoom?.(e.clientX, e.clientY)
    }

    const rect = el.getBoundingClientRect()
    const zone = classifyTapZone(e.clientX - rect.left, rect.width)
    if (zone === ZONE.PREV) return onPrev?.()
    if (zone === ZONE.NEXT) return onNext?.()
    return onToggleChrome?.()
  }

  el.addEventListener('pointerdown', onPointerDown)
  el.addEventListener('pointerup', onPointerUp)

  return () => {
    el.removeEventListener('pointerdown', onPointerDown)
    el.removeEventListener('pointerup', onPointerUp)
  }
}
