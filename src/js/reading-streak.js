// Racha de lectura: contador en la cabecera, temporizador de lectura, panel con
// calendario y pantalla de celebración al cumplir el objetivo del día.
//
// Solo cuenta el tiempo con el lector abierto y la página visible. Si no hay
// actividad (toques, teclas, cambio de página o audio en marcha) durante
// 3 minutos, el tiempo deja de contar hasta la siguiente actividad.
//
// The counters, the timer, the panel, the celebration and the widget payloads are
// rust-ui/src/reading_streak.rs (the shelf module, which the page head compiles and the
// first shelf frame awaits). JavaScript keeps the sound and vibration (Web Audio) and
// hands the controller the app's callbacks.
import { getRustShelf, needRustShelf, requireRustShelf } from './rust-shelf.js'
import { coverPng, minutesLeft, roundedMinutes } from './streak-widget-book.js'

const SOUNDS_KEY = 'inhouse-read-shelf-sounds'

/** Llama propia: exterior naranja, corazón amarillo y un brillo. En gris cuando hoy falta por leer. */
export const flameSvg = (className = '') => needRustShelf().streak_flame_svg(`${className}`)

// ---- Sonido y vibración ----
// Sonidos sintetizados aquí mismo (sin grabaciones): un soplo que sube al
// encenderse la llama, un acorde brillante, golpecitos al contar y un "pop".
function createFeedback(storage) {
  let context = null
  const enabled = () => { try { return storage.getItem(SOUNDS_KEY) !== 'off' } catch { return true } }
  const audio = () => {
    if (!enabled()) return null
    const Context = globalThis.AudioContext || globalThis.webkitAudioContext
    if (!Context) return null
    try { context ||= new Context() } catch { return null }
    if (context.state === 'suspended') context.resume().catch(() => {})
    return context
  }
  // Android y Chrome solo dejan arrancar el audio dentro de un toque: cuando
  // falta poco para el objetivo, el contexto se crea en el siguiente toque y
  // así ya está listo cuando la celebración suena sin que nadie toque nada.
  let wanted = () => false
  const unlock = () => {
    if (context?.state === 'suspended' || (!context && wanted())) audio()
  }
  addEventListener('pointerdown', unlock, { capture: true, passive: true })
  let rest = 0
  const sleepSoon = () => { clearTimeout(rest); rest = setTimeout(() => { if (context?.state === 'running') context.suspend().catch(() => {}) }, 3000) }

  function tone(ctx, { at = 0, freq, to = freq, type = 'sine', dur = .2, gain = .2, attack = .006 }) {
    const start = ctx.currentTime + at
    const osc = ctx.createOscillator(), amp = ctx.createGain()
    osc.type = type
    osc.frequency.setValueAtTime(freq, start)
    if (to !== freq) osc.frequency.exponentialRampToValueAtTime(to, start + dur * .8)
    amp.gain.setValueAtTime(0, start)
    amp.gain.linearRampToValueAtTime(gain, start + attack)
    amp.gain.exponentialRampToValueAtTime(.0001, start + dur)
    osc.connect(amp).connect(ctx.destination)
    osc.start(start); osc.stop(start + dur + .02)
  }
  function whoosh(ctx, at, dur) {
    const start = ctx.currentTime + at, length = Math.ceil(ctx.sampleRate * dur)
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate), data = buffer.getChannelData(0)
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1
    const source = ctx.createBufferSource(), filter = ctx.createBiquadFilter(), amp = ctx.createGain()
    source.buffer = buffer
    filter.type = 'bandpass'; filter.Q.value = 1.4
    filter.frequency.setValueAtTime(380, start)
    filter.frequency.exponentialRampToValueAtTime(3200, start + dur)
    amp.gain.setValueAtTime(0, start)
    amp.gain.linearRampToValueAtTime(.16, start + dur * .7)
    amp.gain.exponentialRampToValueAtTime(.0001, start + dur)
    source.connect(filter).connect(amp).connect(ctx.destination)
    source.start(start); source.stop(start + dur + .02)
  }
  const vibrate = pattern => { try { navigator.vibrate?.(pattern) } catch {} }

  return {
    ignite() {
      vibrate([28, 50, 18, 40, 70])
      const ctx = audio(); if (!ctx) return
      whoosh(ctx, 0, .34)
      // Acorde mayor en arpegio rápido con un brillo de octava.
      ;[[659.3, .26], [830.6, .32], [987.8, .38], [1318.5, .46]].forEach(([freq, at], index) => {
        tone(ctx, { at, freq, type: 'triangle', dur: .55 + index * .08, gain: .13 })
        tone(ctx, { at: at + .004, freq: freq * 2, type: 'sine', dur: .3, gain: .035 })
      })
    },
    tick() {
      vibrate(9)
      const ctx = audio(); if (ctx) tone(ctx, { freq: 1480, to: 1240, dur: .07, gain: .07 })
    },
    pop() {
      vibrate([16, 30, 10])
      const ctx = audio(); if (!ctx) return
      tone(ctx, { freq: 880, to: 520, dur: .12, gain: .16 })
      tone(ctx, { at: .05, freq: 1760, type: 'triangle', dur: .18, gain: .05 })
    },
    tap() { vibrate(10) },
    prepareWhen(test) { wanted = test },
    rest: sleepSoon,
    destroy() { clearTimeout(rest); removeEventListener('pointerdown', unlock, { capture: true }); context?.close?.().catch?.(() => {}) }
  }
}

export function createReadingStreak({ document, storage = localStorage, onChange = () => {}, now = () => Date.now(), latestBook = async () => null, bookTitle = record => record?.title || '' } = {}) {
  const feedback = createFeedback(storage)
  const host = { onChange, now, latestBook, bookTitle, feedback, coverPng, minutesLeft, roundedMinutes }
  let controller = null, destroyed = false
  const waiting = []
  const start = shelf => {
    if (destroyed) return
    controller = new shelf.ReadingStreak(document, storage, host)
    for (const run of waiting.splice(0)) run()
  }
  const ready = getRustShelf()
  // The shelf module has no JavaScript twin: one that cannot load rejects with its own message.
  if (ready) start(ready)
  else requireRustShelf().then(start)
  const later = run => { if (controller) return run(); if (!destroyed) waiting.push(run) }

  return {
    /** Otro dispositivo ha subido su racha: se combina con la de este. */
    reconcile() { later(() => controller.reconcile()) },
    get info() { return controller?.info() },
    celebrate() { later(() => controller.celebrate()) },
    openPanel(from) { later(() => controller.openPanel(from)) },
    destroy() {
      if (destroyed) return
      if (controller) controller.destroy()
      else feedback.destroy()
      destroyed = true
      waiting.length = 0
    }
  }
}
