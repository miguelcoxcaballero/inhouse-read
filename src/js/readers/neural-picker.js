// The "Voces naturales" part of the audio panel: the list of downloadable on-device voices (Descargar /
// progress and Cancelar / Instalada, Usar and Quitar / error and Reintentar), the warning shown
// when the neural voice was given up on, and the first-use offer row. It talks to the engine only through
// neural-runtime.js, never downloads by itself, and stays hidden where the engine is unsupported or failed to load.
import { loadNeural, neuralEngine, neuralVoiceList } from './neural-runtime.js'
import { declaredLanguage, isNeuralId, langBase, languageName, orderNeuralVoices, recommendedNeuralFor } from './voice-catalog.js'

const OFFER_KEY = 'inhouse-read-neural-offer-dismissed', USED_KEY = 'inhouse-read-neural-used'
const OFFER_SNOOZE_DAYS = 30 // 'Ahora no' means not now: the offer comes back for that language after this long
const DOWNLOAD_ERRORS = {
  offline:'Sin conexión.',
  storage:'Sin espacio en el dispositivo.',
  default:'No se pudo descargar.'
}
const WARNINGS = {
  'not-installed':'La voz natural seleccionada no está instalada. Descárgala de nuevo.',
  default:'No se pudo iniciar la voz natural. Pulsa Reintentar para volver a usarla.'
}

const element = (tag, className, text) => {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text != null) node.textContent = text
  return node
}
function button(label, action, id, className = '', ariaLabel = '') {
  const node = element('button', `reading-neural-btn ${className}`.trim(), label)
  node.type = 'button'; node.dataset.neuralAction = action
  if (id) node.dataset.neuralId = id
  if (ariaLabel) node.setAttribute('aria-label', ariaLabel)
  return node
}
function progress(label, download, voice) {
  const wrap = element('div', 'reading-neural-progress')
  const bar = element('div', 'reading-neural-bar'), fill = element('i')
  bar.setAttribute('role', 'progressbar'); bar.setAttribute('aria-label', label)
  bar.setAttribute('aria-valuemin', '0'); bar.setAttribute('aria-valuemax', '100'); bar.append(fill)
  wrap.append(bar, element('span', 'reading-neural-percent'))
  paintProgress(wrap, download, voice)
  return wrap
}
/** Sets the numbers of a progress block built by progress() without rebuilding it (a pressed button must stay in the DOM). */
function paintProgress(wrap, download, voice) {
  const percent = Math.max(0, Math.min(100, Math.round((download?.fraction || 0) * 100)))
  const total = download?.total > 0 ? download.total / 1e6 : voice.sizeMB
  wrap.querySelector('[role="progressbar"]').setAttribute('aria-valuenow', String(percent))
  wrap.querySelector('i').style.width = `${percent}%`
  wrap.querySelector('.reading-neural-percent').textContent = `${percent} %${total ? ` · ${Math.round(total * percent / 100)} de ${Math.round(total)} MB` : ''}`
}

export class NeuralVoicePicker {
  /** `host` is the ReaderExperience: panel, voice (ReadingVoice), preferences, setPreference() and populateVoices(). */
  constructor(host) {
    this.host = host
    this.tasks = new Map() // voice id -> AbortController of the download this page started
    this.errors = new Map() // voice id -> message of the last failed download
    this.engine = null; this.signature = ''; this.frame = 0
    const panel = host.panel
    this.block = panel.querySelector('[data-neural]')
    this.offer = panel.querySelector('[data-neural-offer]')
    for (const root of [this.block, this.offer]) root.addEventListener('click', event => this.click(event))
    panel.querySelector('[data-neural-retry]').addEventListener('click', () => { host.voice.retryNeural?.(); host.voice.play?.(); this.render() })
  }
  /** Nothing loads at app start: a book being opened schedules the engine module for an idle moment, ready before Play is tapped. */
  warm() {
    if (this.warmed) return
    this.warmed = true
    // The worker (and its ~0.2-0.3 GB) is only started ahead of Play for people who have listened with a neural voice before;
    // for anyone else a book being opened just loads the engine module and the list of installed voices.
    const run = () => this.refresh({ warm:this.used() })
    if (typeof requestIdleCallback === 'function') requestIdleCallback(run, { timeout:2500 }); else setTimeout(run, 800)
  }
  /** (Re)loads the engine module if it is not there yet and re-reads what is installed. Cheap; called when the audio tab opens. */
  refresh({ warm = true } = {}) {
    loadNeural().then(() => this.attach(warm), () => {})
  }
  used() { try { return localStorage.getItem(USED_KEY) === '1' } catch { return false } }
  attach(warm = true) {
    const engine = neuralEngine()
    if (engine && engine !== this.engine) {
      this.engine = engine
      engine.addEventListener('change', () => this.changed())
      engine.addEventListener('status', () => { if (engine.status === 'speaking' && !this.used()) { try { localStorage.setItem(USED_KEY, '1') } catch { /* it just warms up at the audio tab */ } } })
      Promise.resolve(engine.refresh?.()).catch(() => {}).then(() => warm && this.warmUp())
    } else if (engine && warm) this.warmUp()
    if (!engine) this.engine = null
    this.host.populateVoices()
  }
  /**
   * Starts the engine's worker and loads the model of the voice the next Play will use, so the tap does not pay the cold start
   * (3-6 s). The engine tears it down by itself after ~90 s without speech. Does nothing unless that voice is a downloaded neural one.
   */
  warmUp() {
    try {
      const engine = neuralEngine(), { voice } = this.host.voice?.voiceFor?.('') || {}
      if (engine?.warmUp && voice?.neural && voice.installed) Promise.resolve(engine.warmUp(voice.id)).catch(() => {})
    } catch { /* the first speak() starts the worker as before */ }
  }
  /** Installed set changes rebuild the voice select too; download progress only repaints this block. */
  changed() {
    const engine = neuralEngine(), signature = engine ? [...engine.installed].sort().join(',') : ''
    if (signature !== this.signature) { this.signature = signature; this.host.populateVoices(); return }
    if (this.frame) return
    this.frame = requestAnimationFrame(() => { this.frame = 0; this.paint() })
  }
  /**
   * A repaint for a 'change' that did not alter the set of installed voices: while a download advances, only the numbers of
   * its progress bar change, so they are updated in place (rebuilding the rows eight times a second made a press on Cancelar
   * miss when a repaint landed between mouse down and up). Anything else (a state changed) rebuilds as usual.
   */
  paint() {
    const engine = neuralEngine()
    if (engine && this.patchProgress(engine)) return
    this.render()
  }
  patchProgress(engine) {
    const list = neuralVoiceList(engine)
    if (this.block.hidden || !list.length) return false
    for (const item of this.block.querySelectorAll('[data-neural-voice]')) {
      const voice = list.find(candidate => candidate.id === item.dataset.neuralVoice)
      if (!voice) return false
      const { name, download } = this.state(engine, voice)
      if (name !== item.dataset.state) return false
      if (name === 'downloading') { const wrap = item.querySelector('.reading-neural-progress'); if (!wrap) return false; paintProgress(wrap, download, voice) }
    }
    const offered = this.offerFor(engine, list)
    if ((offered?.id || '') !== (this.offer.dataset.voice || '')) return false
    if (offered) {
      const { name, download } = this.state(engine, offered)
      if (name !== this.offer.dataset.state) return false
      if (name === 'downloading') { const wrap = this.offer.querySelector('.reading-neural-progress'); if (!wrap) return false; paintProgress(wrap, download, offered) }
    }
    return true
  }
  get bookLang() { return this.host.bookLanguage() }
  announce(text) { this.host.panel.querySelector('[data-neural-status]').textContent = text }

  render() {
    cancelAnimationFrame(this.frame); this.frame = 0
    const engine = neuralEngine(), list = engine ? neuralVoiceList(engine) : []
    this.signature = engine ? [...engine.installed].sort().join(',') : ''
    this.block.hidden = !list.length
    if (!list.length) { this.offer.hidden = true; this.offer.replaceChildren(); return }
    const focus = this.focusKey()
    // The list sits inside the Voz dropdown, so it only shows the voices of the language chosen in the Idioma dropdown.
    const shown = this.host.voiceBaseShown
    const ordered = orderNeuralVoices(list, { bookLang:this.bookLang, deviceLang:navigator.language }).filter(voice => !shown || voice.base === shown)
    this.block.hidden = !ordered.length
    const reason = this.host.voice?.neuralOff
    this.block.querySelector('[data-neural-warning]').hidden = !reason
    this.block.querySelector('[data-neural-warning-text]').textContent = reason ? WARNINGS[reason] || WARNINGS.default : ''
    this.block.querySelector('[data-neural-list]').replaceChildren(...ordered.map(voice => this.row(engine, voice)))
    this.renderOffer(engine, list)
    this.restoreFocus(focus)
  }
  state(engine, voice) {
    const download = engine.downloads?.get(voice.id)
    if (engine.installed.has(voice.id)) return { name:'installed' }
    if (this.tasks.has(voice.id) || download?.state === 'downloading') return { name:'downloading', download }
    if (this.errors.has(voice.id) || download?.state === 'error') return { name:'error', message:this.errors.get(voice.id) || DOWNLOAD_ERRORS[download?.code] || DOWNLOAD_ERRORS.default }
    return { name:'idle' }
  }
  row(engine, voice) {
    const { name, download, message } = this.state(engine, voice), selected = this.host.preferences.voice === voice.id
    const item = element('li', 'reading-neural-voice'); item.dataset.neuralVoice = voice.id; item.dataset.state = name
    const text = element('div', 'reading-neural-voice__text'), title = element('span', 'reading-neural-voice__name', voice.name)
    if (voice.recommended) title.append(' ', element('small', 'reading-neural-voice__badge', 'Recomendada'))
    const detail = [languageName(voice.lang), name === 'installed' ? 'Instalada' : `${Math.round(voice.sizeMB)} MB`]
    text.append(title, element('span', 'reading-neural-voice__meta', detail.join(' · ')))
    const actions = element('div', 'reading-neural-voice__actions')
    const where = `${voice.name}, ${languageName(voice.lang)}`
    if (name === 'idle') actions.append(button('Descargar', 'install', voice.id, '', `Descargar la voz ${where} (${Math.round(voice.sizeMB)} MB)`))
    else if (name === 'downloading') actions.append(button('Cancelar', 'cancel', voice.id, '', `Cancelar la descarga de ${voice.name}`))
    else if (name === 'error') actions.append(button('Reintentar', 'install', voice.id, '', `Reintentar la descarga de ${voice.name}`))
    else {
      const use = button(selected ? 'En uso' : 'Usar', 'use', voice.id, selected ? 'is-selected' : '', `${selected ? 'Voz en uso' : 'Usar la voz'} ${where}`)
      use.setAttribute('aria-pressed', String(selected))
      actions.append(use, button('Quitar', 'remove', voice.id, 'is-quiet', `Quitar la voz ${where} del dispositivo`))
    }
    item.append(text, actions)
    if (name === 'downloading') item.append(progress(`Descargando ${voice.name}`, download, voice))
    if (name === 'error') { const note = element('p', 'reading-neural-voice__error', message); note.setAttribute('role', 'alert'); item.append(note) }
    return item
  }

  // --- Actions ------------------------------------------------------------------------------------------------------
  click(event) {
    const target = event.target.closest?.('[data-neural-action]')
    if (!target) return
    const { neuralAction:action, neuralId:id } = target.dataset
    if (action === 'install') this.install(id)
    else if (action === 'cancel') this.cancel(id)
    else if (action === 'use') this.use(id)
    else if (action === 'remove') this.remove(id)
    else if (action === 'dismiss') this.dismiss()
  }
  /** Aborts a download. Through the engine when it can (the speakers of one model share a download: the row that did not start it can cancel too). */
  cancel(id) {
    this.tasks.get(id)?.abort()
    try { neuralEngine()?.cancel?.(id) } catch { /* the controller above already did it */ }
  }
  voiceName(id) { return neuralVoiceList().find(voice => voice.id === id)?.name || 'natural' }
  /** Downloads a voice (only ever called by a tap) and selects it when it is ready. */
  async install(id) {
    const engine = neuralEngine()
    if (!engine || this.tasks.has(id) || !isNeuralId(id)) return
    try { engine.unlock?.() } catch { /* the play tap unlocks audio again */ }
    const controller = new AbortController(), name = this.voiceName(id)
    this.tasks.set(id, controller); this.errors.delete(id)
    this.announce(`Descargando ${name}.`)
    let task
    try { task = engine.install(id, { signal:controller.signal }) } catch (error) { task = Promise.reject(error) }
    this.render()
    try {
      await task
      this.tasks.delete(id)
      // Selected only for the language of the book being read: the saved voice is global, so a Spanish voice picked while
      // reading a Spanish book must not become the voice of an English one ('Automática' already prefers an installed
      // neural voice of each book's language, so nothing is lost).
      const declared = declaredLanguage(this.host.reader) // a book that declares no language (a PDF) takes it: the device language says nothing about it
      // A language picked in the Idioma dropdown is an explicit choice: its voices are selected whatever the book declares.
      const base = langBase(neuralVoiceList().find(voice => voice.id === id)?.lang), picked = this.host.preferences.voiceLang
      const here = picked ? base === picked : !declared || base === langBase(declared)
      this.announce(here ? `Voz ${name} instalada y seleccionada.` : `Voz ${name} instalada.`)
      if (here) this.host.setPreference('voice', id, { restart:false }) // the next fragment is already spoken with it
      this.host.populateVoices()
    } catch (error) {
      this.tasks.delete(id)
      if (error?.code === 'aborted' || controller.signal.aborted) this.announce('Descarga cancelada.')
      else { const message = DOWNLOAD_ERRORS[error?.code] || DOWNLOAD_ERRORS.default; this.errors.set(id, message); this.announce(`No se pudo descargar ${name}. ${message}`) }
      this.render()
    }
  }
  use(id) {
    try { neuralEngine()?.unlock?.() } catch { /* see install() */ }
    this.host.setPreference('voice', id)
    this.announce(`Voz ${this.voiceName(id)} seleccionada.`)
    this.host.populateVoices()
  }
  async remove(id) {
    const engine = neuralEngine(), name = this.voiceName(id)
    if (!engine) return
    // The saved choice goes first, then the reading in progress is told the voice is gone (it moves on to another voice at once,
    // also when the voice was only the automatic pick), so nothing keeps using it while its files disappear.
    if (this.host.preferences.voice === id) this.host.setPreference('voice', '', { restart:false })
    this.host.voice?.voiceRemoved?.(id)
    try { await engine.remove(id) } catch { /* nothing else to clean up */ }
    this.errors.delete(id)
    this.announce(`Voz ${name} quitada.`)
    this.host.populateVoices()
  }

  // --- First-use offer ------------------------------------------------------------------------------------------------
  dismissed() { try { return JSON.parse(localStorage.getItem(OFFER_KEY) || '{}') || {} } catch { return {} } }
  /** True while 'Ahora no' still holds for this language (it expires after OFFER_SNOOZE_DAYS). */
  snoozed(base) {
    const at = this.dismissed()[base]
    return at === true || (Number(at) > 0 && Date.now() - Number(at) < OFFER_SNOOZE_DAYS * 864e5)
  }
  dismiss() {
    const base = langBase(this.bookLang)
    try { localStorage.setItem(OFFER_KEY, JSON.stringify({ ...this.dismissed(), [base]:Date.now() })) } catch { /* it just asks again next time */ }
    this.render()
  }
  /** Offer a download when no installed natural voice speaks the book's language, including before the first playback. */
  offerFor(engine, list) {
    const base = langBase(this.bookLang)
    if (!engine || !base || !this.host.voice || this.snoozed(base)) return null
    if (list.some(voice => voice.base === base && engine.installed.has(voice.id))) return null
    return recommendedNeuralFor(list, this.bookLang, navigator.language)
  }
  renderOffer(engine, list) {
    const voice = this.offerFor(engine, list)
    this.offer.hidden = !voice
    if (!voice) { this.offer.replaceChildren(); delete this.offer.dataset.voice; delete this.offer.dataset.state; return }
    const { name, download, message } = this.state(engine, voice)
    this.offer.dataset.voice = voice.id; this.offer.dataset.state = name
    const size = Math.round(voice.sizeMB)
    const title = element('p', 'reading-neural-offer__title', `Voz natural · ${size} MB`)
    this.offer.setAttribute('role', 'group'); this.offer.setAttribute('aria-label', 'Voz natural')
    const head = [title]
    if (name === 'downloading') head.push(button('Cancelar', 'cancel', voice.id, '', `Cancelar la descarga de ${voice.name}`))
    else head.push(button(name === 'error' ? 'Reintentar' : 'Descargar', 'install', voice.id, 'is-primary', `${name === 'error' ? 'Reintentar la descarga de' : 'Descargar'} la voz natural ${voice.name} (${size} MB)`), button('Ahora no', 'dismiss', '', 'is-quiet'))
    const nodes = [element('div', 'reading-neural-offer__row')]
    nodes[0].append(...head)
    if (name === 'error') { const note = element('p', 'reading-neural-voice__error', message); note.setAttribute('role', 'alert'); nodes.push(note) }
    if (name === 'downloading') nodes.push(progress(`Descargando ${voice.name}`, download, voice))
    this.offer.replaceChildren(...nodes)
  }

  // --- Keyboard focus survives a repaint ---------------------------------------------------------------------------------
  focusKey() {
    const active = document.activeElement
    if (!active || !this.host.panel.contains(active) || !active.dataset?.neuralAction) return null
    return { action:active.dataset.neuralAction, id:active.dataset.neuralId || '', inOffer:this.offer.contains(active) }
  }
  restoreFocus(key) {
    if (!key) return
    const root = key.inOffer && !this.offer.hidden ? this.offer : this.block
    const all = [...root.querySelectorAll('[data-neural-action]')]
    const same = all.find(node => node.dataset.neuralAction === key.action && (node.dataset.neuralId || '') === key.id)
      || all.find(node => (node.dataset.neuralId || '') === key.id) || all[0]
    same?.focus({ preventScroll:true })
  }
}
