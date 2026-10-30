// Racha de lectura: contador en la cabecera, temporizador de lectura, panel con
// calendario y pantalla de celebración al cumplir el objetivo del día.
//
// Solo cuenta el tiempo con el lector abierto y la página visible. Si no hay
// actividad (toques, teclas, cambio de página o audio en marcha) durante
// 3 minutos, el tiempo deja de contar hasta la siguiente actividad.
//
// The counters, the timer, the panel, the celebration, its sounds and vibration, and the widget
// payloads are rust-ui/src/reading_streak.rs (the shelf module, which the page head compiles and the
// first shelf frame awaits). JavaScript hands the controller the app's callbacks.
import { needRustShelf, whenRustShelf } from './rust-shelf.js'

/** Llama propia: exterior naranja, corazón amarillo y un brillo. En gris cuando hoy falta por leer. */
export const flameSvg = (className = '') => needRustShelf().streak_flame_svg(`${className}`)

export function createReadingStreak({ document, storage = localStorage, onChange = () => {}, now = () => Date.now(), latestBook = async () => null, bookTitle = record => record?.title || '' } = {}) {
  const host = { onChange, now, latestBook, bookTitle }
  let controller = null, destroyed = false
  const waiting = []
  const start = shelf => {
    if (destroyed) return
    controller = new shelf.ReadingStreak(document, storage, host)
    for (const run of waiting.splice(0)) run()
  }
  // The shelf module has no JavaScript twin: a failed first load is retried by the shelf refresh.
  whenRustShelf(start)
  const later = run => { if (controller) return run(); if (!destroyed) waiting.push(run) }

  return {
    /** Otro dispositivo ha subido su racha: se combina con la de este. */
    reconcile() { later(() => controller.reconcile()) },
    get info() { return controller?.info() },
    celebrate() { later(() => controller.celebrate()) },
    openPanel(from) { later(() => controller.openPanel(from)) },
    destroy() {
      if (destroyed) return
      controller?.destroy()
      destroyed = true
      waiting.length = 0
    }
  }
}
