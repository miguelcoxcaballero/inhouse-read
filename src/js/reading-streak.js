// Racha de lectura: contador en la cabecera, temporizador de lectura, panel con
// calendario y pantalla de celebración al cumplir el objetivo del día.
//
// Solo cuenta el tiempo con el lector abierto y la página visible. Si no hay
// actividad (toques, teclas, cambio de página o audio en marcha) durante
// IDLE_MS, el tiempo deja de contar hasta la siguiente actividad.
import {
  GOAL_SECONDS, STREAK_KEY, STREAK_LOCAL_KEY, addReading, dayKey, dayWord, formatClock, isComplete,
  mergeStreaks, monthGrid, parseStreak, pruneStreak, streakInfo, syncedStreak, weekDays
} from './reading-streak-core.js'
import { coverPng, minutesLeft, roundedMinutes } from './streak-widget-book.js'

const IDLE_MS = 180_000
const SAVE_EVERY_MS = 5_000
const SOUNDS_KEY = 'inhouse-read-shelf-sounds'
const WEEKDAYS = ['L', 'M', 'X', 'J', 'V', 'S', 'D']
const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']

let flameSerial = 0
/** Llama propia: exterior naranja, corazón amarillo y un brillo. En gris cuando hoy falta por leer. */
export function flameSvg(className = '') {
  const id = `ihr-flame-${++flameSerial}`
  return `<svg class="streak-flame ${className}" viewBox="0 0 64 76" aria-hidden="true" focusable="false">
  <defs>
    <linearGradient id="${id}-o" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--flame-top)"/><stop offset="1" stop-color="var(--flame-bottom)"/></linearGradient>
    <linearGradient id="${id}-i" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--flame-core-top)"/><stop offset="1" stop-color="var(--flame-core-bottom)"/></linearGradient>
  </defs>
  <path class="streak-flame-outer" fill="url(#${id}-o)" d="M34 4C36 14 44 20 50 28c6 8 9 15 9 23 0 13-12 23-27 23S5 64 5 51c0-9 4-16 9-22 1.5-1.5 3.5-.7 3.8 1.2.6 3.8 2.2 6.8 4.7 8.8-.5-12 3.5-24 9.5-34 .6-1.1 1.7-1.4 2-1Z"/>
  <path class="streak-flame-inner" fill="url(#${id}-i)" d="M33 38c2.5 7 11 12 11 21 0 7.5-5.5 13-12 13s-12-5.5-12-12c0-6 3.5-10 6.5-13 .8-.7 1.9-.2 2 .8.3 2.2 1.1 3.8 2.3 4.8-.2-5.6.7-10.1 1.6-14.4.1-.5.5-.6.6-.2Z"/>
  <path class="streak-flame-shine" d="M45 31.5c3.2 3.4 6 7.8 7 12.5" fill="none" stroke="#fff" stroke-opacity=".45" stroke-width="3.4" stroke-linecap="round"/>
</svg>`
}

const CHECK = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M5.5 12.5l4.2 4.2 8.8-9.4" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/></svg>'
const CLOSE = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M6 6l12 12M18 6 6 18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>'
const CHEVRON = d => `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="${d}" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`

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
  const body = document.body
  const read = key => { try { return storage.getItem(key) } catch { return null } }
  const write = (key, value) => { try { storage.setItem(key, value); return true } catch { return false } }

  // El estado combina la copia sincronizada y la de este dispositivo.
  let state = mergeStreaks(parseStreak(read(STREAK_KEY)), parseStreak(read(STREAK_LOCAL_KEY)))
  let today = dayKey(new Date(now()))
  let dirty = false, lastSave = now(), lastTick = 0, lastActivity = 0, timer = 0, clockTimer = 0
  let celebrating = null, panel = null, destroyed = false
  const feedback = createFeedback(storage)
  feedback.prepareWhen(() => reading() && !streakInfo(state, today).doneToday && streakInfo(state, today).remaining <= 120)

  function persist(force = false) {
    if (!dirty && !force) return
    state = pruneStreak(state, today)
    write(STREAK_LOCAL_KEY, JSON.stringify(state))
    publish()
    dirty = false; lastSave = now()
  }
  // El ajuste sincronizado solo cambia al cumplir un día o celebrarlo.
  function publish() {
    const text = JSON.stringify(syncedStreak(state))
    if (read(STREAK_KEY) !== text) { write(STREAK_KEY, text); onChange(STREAK_KEY) }
  }

  // ---- Contador de la cabecera ----
  const chips = [...document.querySelectorAll('[data-streak-chip]')]
  function renderChips() {
    const info = streakInfo(state, today)
    // El texto accesible cambia por minutos, no cada segundo: cada cambio de
    // atributo es un evento de accesibilidad que Android tiene que procesar.
    const minutes = Math.ceil(info.remaining / 60)
    const left = `${minutes} ${minutes === 1 ? 'minuto' : 'minutos'}`
    const label = info.doneToday
      ? `Racha de ${info.current} ${dayWord(info.current)}. Hoy ya has leído.`
      : `Racha de ${info.current} ${dayWord(info.current)}. Te ${minutes === 1 ? 'falta' : 'faltan'} ${left} de lectura hoy.`
    const look = info.doneToday ? 'lit' : 'idle'
    for (const chip of chips) {
      const progress = String(Math.floor(info.seconds / GOAL_SECONDS * 100) / 100)
      if (chip.style.getPropertyValue('--streak-progress') !== progress) chip.style.setProperty('--streak-progress', progress)
      if (chip.dataset.state !== look) chip.dataset.state = look
      const count = chip.querySelector('.streak-chip-count')
      if (count.textContent !== String(info.current)) count.textContent = String(info.current)
      if (chip.getAttribute('aria-label') !== label) {
        chip.setAttribute('aria-label', label)
        chip.title = info.doneToday ? 'Racha de lectura' : `Lee ${left} más hoy`
      }
    }
    if (panel && !panel.hidden) renderPanel()
    syncWidget()
  }

  // ---- Widget de la pantalla de inicio (Android 1.1.21+, window.InhouseStreak) ----
  // Recibe los días cumplidos y el progreso de hoy por minutos; el widget
  // calcula la racha con la fecha del teléfono, así que se apaga a medianoche.
  const widgetBridge = () => { try { return globalThis.InhouseStreak || null } catch { return null } }
  let widgetSent = ''
  function syncWidget() {
    const bridge = widgetBridge()
    if (typeof bridge?.update !== 'function') return
    const days = Object.keys(state.days).filter(key => isComplete(state, key)).sort().slice(-120)
    const seconds = Math.min(GOAL_SECONDS, Math.floor((state.days[today] || 0) / 60) * 60)
    const payload = JSON.stringify({ days, day: today, seconds })
    if (payload === widgetSent) return
    widgetSent = payload
    try { bridge.update(payload) } catch {}
  }
  const widgetCall = (name, fallback) => { try { return widgetBridge()?.[name]?.() ?? fallback } catch { return fallback } }

  // ---- Último libro en el widget (ajuste «Libro en el widget») ----
  const BOOK_KEY = 'inhouse-read-widget-book'
  const bookEnabled = () => read(BOOK_KEY) !== 'off'
  let bookSent = '', coverSent = '', bookTask = Promise.resolve()
  function syncWidgetBook() {
    const bridge = widgetBridge()
    if (typeof bridge?.updateBook !== 'function') return
    bookTask = bookTask.then(async () => {
      const record = bookEnabled() ? await latestBook().catch(() => null) : null
      if (!record) {
        if (bookSent !== 'none') { bookSent = 'none'; coverSent = ''; try { bridge.updateBook('') } catch {} }
        return
      }
      const title = String(bookTitle(record) || record.title || '').trim() || 'Libro'
      const minutes = roundedMinutes(minutesLeft(record))
      const key = `${record.id}|${title}|${minutes}`
      const cover = `${record.id}|${record.cover?.size || 0}`
      if (key === bookSent && cover === coverSent) return
      const payload = { title, minutes }
      if (cover !== coverSent) payload.cover = await coverPng(record, title)
      else payload.keepCover = true
      bookSent = key; coverSent = cover
      try { bridge.updateBook(JSON.stringify(payload)) } catch {}
    }).catch(() => {})
  }
  const bookToggle = document.getElementById('widget-book-toggle')
  const bookRow = bookToggle?.closest('[data-widget-book-setting]')
  if (bookToggle && typeof widgetBridge()?.updateBook === 'function') {
    if (bookRow) bookRow.hidden = false
    bookToggle.checked = bookEnabled()
    bookToggle.addEventListener('change', () => {
      write(BOOK_KEY, bookToggle.checked ? 'on' : 'off')
      syncWidgetBook()
    })
  }

  for (const chip of chips) {
    chip.innerHTML = `<span class="streak-chip-icon">${flameSvg('is-base is-idle')}${flameSvg('is-fill')}</span><span class="streak-chip-count">0</span>`
    chip.addEventListener('click', () => { feedback.tap(); openPanel(chip) })
  }

  // ---- Temporizador de lectura ----
  const readerScreen = document.getElementById('reader-screen')
  const reading = () => body.classList.contains('is-reading') && !readerScreen?.hidden && document.visibilityState === 'visible'
  const audioPlaying = () => !!document.querySelector('.reading-mini-player [data-mini-play][aria-label="Pausar lectura"]')
  const activity = () => { lastActivity = now() }
  for (const type of ['pointerdown', 'keydown', 'wheel', 'touchstart'])
    addEventListener(type, activity, { capture: true, passive: true })
  // Pasar página dentro del libro (iframes incluidos) cambia la barra de progreso.
  const pageObserver = new MutationObserver(activity)
  for (const node of [document.getElementById('reader-progress-fill'), document.querySelector('.reader-location-label')])
    if (node) pageObserver.observe(node, { attributes: true, childList: true, characterData: true, subtree: true })

  function tick() {
    const at = now()
    const elapsed = lastTick ? Math.min(at - lastTick, 2000) : 0
    lastTick = at
    const key = dayKey(new Date(at))
    if (key !== today) { today = key; renderChips() }
    if (celebrating || !reading()) return
    if (at - lastActivity > IDLE_MS && !audioPlaying()) return
    if (elapsed <= 0) return
    const result = addReading(state, elapsed / 1000, today)
    state = result.state; dirty = true
    if (result.reached) {
      persist(true)
      renderChips()
      if (state.celebrated !== today) celebrate()
      return
    }
    if (at - lastSave >= SAVE_EVERY_MS) persist()
    renderChips()
  }
  // El intervalo solo existe mientras hay un libro abierto.
  function syncTimer() {
    const active = reading()
    if (active && !timer) { lastTick = now(); activity(); timer = setInterval(tick, 1000) }
    else if (!active && timer) { tick(); clearInterval(timer); timer = 0; lastTick = 0; persist(); syncWidgetBook() }
  }
  const screenObserver = new MutationObserver(syncTimer)
  screenObserver.observe(body, { attributes: true, attributeFilter: ['class'] })
  if (readerScreen) screenObserver.observe(readerScreen, { attributes: true, attributeFilter: ['hidden'] })
  const onVisibility = () => { syncTimer(); if (document.visibilityState === 'hidden') { persist(); syncWidgetBook() } else refreshDay() }
  document.addEventListener('visibilitychange', onVisibility)
  addEventListener('pagehide', () => persist())
  // Cambiar de día con la app abierta pone el contador en gris si toca.
  function refreshDay() {
    const key = dayKey(new Date(now()))
    if (key !== today) { today = key; renderChips() }
  }
  clockTimer = setInterval(refreshDay, 60_000)

  // ---- Panel con el calendario ----
  let shownMonth = null, panelReturn = null, widgetOffer = false
  function ensurePanel() {
    if (panel) return panel
    panel = document.createElement('div')
    panel.className = 'streak-panel-layer'
    panel.hidden = true
    panel.innerHTML = `<div class="streak-panel-scrim" data-streak-close></div>
<section class="streak-panel" role="dialog" aria-modal="true" aria-labelledby="streak-panel-title">
  <button class="streak-panel-close" type="button" data-streak-close aria-label="Cerrar racha">${CLOSE}</button>
  <header class="streak-panel-hero">
    <div class="streak-panel-flame">${flameSvg('is-base is-idle')}${flameSvg('is-fill')}</div>
    <div><h2 id="streak-panel-title"><span data-streak-count>0</span> <span data-streak-unit>días</span> de racha</h2><p data-streak-status></p></div>
  </header>
  <div class="streak-today" data-streak-today>
    <div class="streak-today-bar"><span></span></div>
    <p><strong data-streak-clock>0:00</strong> de ${formatClock(GOAL_SECONDS)} leídos hoy</p>
  </div>
  <div class="streak-stats">
    <div><strong data-streak-best>0</strong><span>Racha más larga</span></div>
    <div><strong data-streak-total>0</strong><span>Días leídos</span></div>
  </div>
  <button type="button" class="streak-widget-cta" data-streak-widget hidden>
    <span class="streak-widget-art" aria-hidden="true"><span class="streak-widget-art-flame">${flameSvg()}</span><span class="streak-widget-art-lines"><i></i><i></i></span><span class="streak-widget-art-dots"><i></i><i></i><i></i><i></i><i class="is-today"></i></span></span>
    <span class="streak-widget-copy"><strong data-streak-widget-title>Añade la racha a tu pantalla de inicio</strong><small data-streak-widget-text>Un widget con tu llama y los días de esta semana.</small></span>
  </button>
  <div class="streak-calendar">
    <div class="streak-calendar-head">
      <button type="button" class="streak-month-nav" data-streak-month="-1" aria-label="Mes anterior">${CHEVRON('M15 5l-7 7 7 7')}</button>
      <h3 data-streak-month-label></h3>
      <button type="button" class="streak-month-nav" data-streak-month="1" aria-label="Mes siguiente">${CHEVRON('M9 5l7 7-7 7')}</button>
    </div>
    <div class="streak-calendar-weekdays" aria-hidden="true">${WEEKDAYS.map(day => `<span>${day}</span>`).join('')}</div>
    <div class="streak-calendar-grid" role="grid" data-streak-grid></div>
  </div>
</section>`
    body.append(panel)
    panel.addEventListener('click', event => {
      if (event.target.closest('[data-streak-close]')) closePanel()
      if (event.target.closest('[data-streak-widget]')) {
        feedback.tap()
        widgetCall('requestPin')
        panel.querySelector('[data-streak-widget-title]').textContent = 'Confírmalo en el aviso de Android'
        panel.querySelector('[data-streak-widget-text]').textContent = 'También puedes añadirlo desde los widgets del lanzador.'
      }
      const nav = event.target.closest('[data-streak-month]')
      if (nav && !nav.disabled) {
        const step = Number(nav.dataset.streakMonth)
        shownMonth = new Date(shownMonth.getFullYear(), shownMonth.getMonth() + step, 1)
        feedback.tap(); renderPanel()
      }
    })
    panel.addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.preventDefault(); closePanel() }
      if (event.key === 'Tab') trapFocus(event, panel.querySelector('.streak-panel'))
    })
    return panel
  }
  function renderPanel() {
    const info = streakInfo(state, today)
    const q = selector => panel.querySelector(selector)
    q('.streak-panel').dataset.state = info.doneToday ? 'lit' : 'idle'
    q('.streak-panel').style.setProperty('--streak-progress', String(Math.floor(info.seconds / GOAL_SECONDS * 100) / 100))
    q('[data-streak-count]').textContent = String(info.current)
    q('[data-streak-unit]').textContent = dayWord(info.current)
    q('[data-streak-status]').textContent = info.doneToday
      ? 'Hoy ya has leído. Vuelve mañana para mantenerla.'
      : info.atRisk
        ? `Lee ${formatClock(info.remaining)} más hoy para no perderla.`
        : `Lee ${GOAL_SECONDS / 60} minutos para empezar tu racha.`
    q('[data-streak-today]').dataset.done = String(info.doneToday)
    q('.streak-today-bar span').style.transform = `scaleX(${info.seconds / GOAL_SECONDS})`
    q('[data-streak-clock]').textContent = formatClock(info.seconds)
    q('[data-streak-best]').textContent = String(info.best)
    q('[data-streak-total]').textContent = String(info.total)
    q('[data-streak-widget]').hidden = !widgetOffer
    const year = shownMonth.getFullYear(), month = shownMonth.getMonth()
    q('[data-streak-month-label]').textContent = `${MONTHS[month]} ${year}`
    const current = new Date(`${today}T12:00:00`)
    q('[data-streak-month="1"]').disabled = year > current.getFullYear() || (year === current.getFullYear() && month >= current.getMonth())
    const cells = monthGrid(state, year, month, today)
    const rows = []
    for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7))
    q('[data-streak-grid]').innerHTML = rows.map(row => `<div role="row">${Array.from({ length: 7 }, (_, index) => {
      const cell = row[index]
      if (!cell) return '<span role="gridcell" class="streak-day is-empty"></span>'
      const classes = ['streak-day', cell.done && 'is-done', cell.today && 'is-today', cell.future && 'is-future',
        cell.joinPrev && index > 0 && 'join-prev', cell.joinNext && index < 6 && 'join-next'].filter(Boolean).join(' ')
      const label = `${cell.day} de ${MONTHS[month]}${cell.done ? ', leído' : ''}${cell.today ? ', hoy' : ''}`
      return `<span role="gridcell" class="${classes}" aria-label="${label}"><span>${cell.day}</span></span>`
    }).join('')}</div>`).join('')
  }
  function openPanel(from) {
    ensurePanel()
    panelReturn = from || document.activeElement
    const date = new Date(`${today}T12:00:00`)
    shownMonth = new Date(date.getFullYear(), date.getMonth(), 1)
    // Se pregunta una vez al abrir (son llamadas síncronas al sistema).
    widgetOffer = widgetCall('canPin', false) === true && widgetCall('isPlaced', false) === false
    panel.querySelector('[data-streak-widget-title]').textContent = 'Añade la racha a tu pantalla de inicio'
    panel.querySelector('[data-streak-widget-text]').textContent = 'Un widget con tu llama y los días de esta semana.'
    renderPanel()
    panel.hidden = false
    requestAnimationFrame(() => panel.classList.add('is-open'))
    panel.querySelector('.streak-panel-close').focus({ preventScroll: true })
  }
  function closePanel() {
    if (!panel || panel.hidden) return
    panel.classList.remove('is-open')
    const done = () => { panel.hidden = true; panelReturn?.focus?.({ preventScroll: true }) }
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) done()
    else setTimeout(done, 200)
  }

  // ---- Pantalla de celebración ----
  function celebrate() {
    if (celebrating) return
    state = { ...state, celebrated: today }; dirty = true; persist(true)
    const info = streakInfo(state, today)
    const week = weekDays(state, today)
    const before = Math.max(0, info.current - 1)
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
    const milestone = { 7: '¡Una semana entera leyendo!', 30: '¡Un mes sin fallar ni un día!', 100: '¡Cien días de lectura!', 365: '¡Un año entero leyendo cada día!' }[info.current]
    const title = info.current === 1 ? '¡Tu racha empieza hoy!' : milestone || '¡Racha ampliada!'
    const text = info.current === 1
      ? 'Has leído 5 minutos. Vuelve mañana para que siga creciendo.'
      : `Has leído 5 minutos hoy. Mañana llegarás a ${info.current + 1} días.`
    const layer = document.createElement('div')
    layer.className = 'streak-celebration'
    layer.setAttribute('role', 'dialog')
    layer.setAttribute('aria-modal', 'true')
    layer.setAttribute('aria-labelledby', 'streak-celebration-title')
    layer.setAttribute('aria-describedby', 'streak-celebration-text')
    layer.innerHTML = `<div class="streak-celebration-body">
  <div class="streak-burst" aria-hidden="true">
    <span class="streak-glow"></span>
    ${Array.from({ length: 12 }, (_, index) => `<i style="--a:${index * 30 + (index % 2 ? 12 : 0)}deg;--d:${index % 3 * 14 + 70}px;--s:${index % 2 ? 7 : 10}px"></i>`).join('')}
    <div class="streak-celebration-flame">${flameSvg('is-idle')}${flameSvg('is-lit')}</div>
  </div>
  <div class="streak-roll" aria-hidden="true"><span class="streak-roll-old">${before}</span><span class="streak-roll-new">${info.current}</span></div>
  <p class="streak-roll-unit">${dayWord(info.current)} de racha</p>
  <h2 id="streak-celebration-title" class="visually-hidden">${title} ${info.current} ${dayWord(info.current)} de racha</h2>
  <div class="streak-week" role="list" aria-label="Esta semana">${week.map((day, index) => `<div role="listitem" class="streak-week-day${day.done && !day.today ? ' is-done' : ''}${day.today ? ' is-today' : ''}${day.future ? ' is-future' : ''}" aria-label="${WEEKDAYS[index]}${day.done ? ', leído' : ''}${day.today ? ', hoy' : ''}"><span class="streak-week-name">${WEEKDAYS[index]}</span><span class="streak-week-dot">${CHECK}</span></div>`).join('')}</div>
  <p class="streak-celebration-title" aria-hidden="true">${title}</p>
  <p id="streak-celebration-text" class="streak-celebration-text">${text}</p>
</div>
<div class="streak-celebration-actions">
  <button type="button" class="streak-continue" data-streak-continue>Continuar</button>
  <button type="button" class="streak-link" data-streak-calendar>Ver calendario</button>
</div>`
    body.append(layer)
    const previous = document.activeElement
    celebrating = { layer, timers: [] }
    const later = (ms, run) => celebrating.timers.push(setTimeout(run, reduced ? 0 : ms))
    const finish = openCalendar => {
      if (!celebrating) return
      celebrating.timers.forEach(clearTimeout)
      celebrating = null
      lastTick = now(); activity()
      layer.classList.add('is-leaving')
      setTimeout(() => layer.remove(), reduced ? 0 : 260)
      if (openCalendar) openPanel(chips.find(chip => chip.offsetParent) || previous)
      else previous?.focus?.({ preventScroll: true })
      // El contador de la cabecera da un saltito al encenderse.
      for (const chip of chips) {
        chip.classList.remove('is-bumped'); void chip.offsetWidth; chip.classList.add('is-bumped')
        chip.addEventListener('animationend', () => chip.classList.remove('is-bumped'), { once: true })
      }
    }
    layer.querySelector('[data-streak-continue]').addEventListener('click', () => { feedback.tap(); finish(false) })
    layer.querySelector('[data-streak-calendar]').addEventListener('click', () => { feedback.tap(); finish(true) })
    layer.addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.preventDefault(); finish(false) }
      if (event.key === 'Tab') trapFocus(event, layer)
    })
    requestAnimationFrame(() => layer.classList.add('is-in'))
    later(300, () => { layer.classList.add('is-lit'); feedback.ignite() })
    later(680, () => { layer.classList.add('is-counted'); feedback.tick() })
    later(1080, () => { layer.classList.add('is-week'); feedback.pop() })
    later(1450, () => {
      layer.classList.add('is-ready')
      feedback.rest()
      layer.querySelector('[data-streak-continue]').focus({ preventScroll: true })
    })
    if (reduced) layer.querySelector('[data-streak-continue]').focus({ preventScroll: true })
  }

  function trapFocus(event, root) {
    const items = [...root.querySelectorAll('button:not([disabled])')].filter(item => item.offsetParent !== null)
    if (!items.length) return
    const first = items[0], last = items[items.length - 1]
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
  }

  renderChips()
  syncTimer()
  const bookStart = setTimeout(syncWidgetBook, 4000)

  return {
    /** Otro dispositivo ha subido su racha: se combina con la de este. */
    reconcile() {
      const merged = mergeStreaks(state, parseStreak(read(STREAK_KEY)), parseStreak(read(STREAK_LOCAL_KEY)))
      const changed = JSON.stringify(merged) !== JSON.stringify(state)
      state = merged
      write(STREAK_LOCAL_KEY, JSON.stringify(state))
      publish()
      if (changed) renderChips()
    },
    get info() { return streakInfo(state, today) },
    celebrate,
    openPanel,
    destroy() {
      if (destroyed) return
      destroyed = true
      persist()
      clearInterval(timer); clearInterval(clockTimer); clearTimeout(bookStart)
      pageObserver.disconnect(); screenObserver.disconnect()
      document.removeEventListener('visibilitychange', onVisibility)
      for (const type of ['pointerdown', 'keydown', 'wheel', 'touchstart']) removeEventListener(type, activity, { capture: true })
      feedback.destroy()
    }
  }
}
