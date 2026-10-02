// The "Voces naturales · sin conexión" part of the audio panel: the list of downloadable on-device voices (Descargar /
// progress and Cancelar / Instalada, Usar and Quitar / error and Reintentar), the one-line honest note, the warning shown
// when the neural voice was given up on, and the first-use offer card. It talks to the engine only through
// neural-runtime.js, never downloads by itself, and stays hidden where the engine is unsupported or failed to load.
import { loadNeural, neuralEngine, neuralVoiceList } from './neural-runtime.js'
import { isNeuralId, langBase, languageName, orderNeuralVoices, recommendedNeuralFor } from './voice-catalog.js'

const OFFER_KEY = 'inhouse-read-neural-offer-dismissed'
const DOWNLOAD_ERRORS = {
  offline:'Sin conexión. Conéctate a internet para descargarla.',
  storage:'No hay espacio suficiente en el dispositivo.',
  default:'No se pudo descargar la voz. Inténtalo de nuevo.'
}
const WARNINGS = {
  'too-slow':'La voz natural no va lo bastante rápida en este dispositivo, así que se usa la voz del sistema. Baja la velocidad o vuelve a probar.',
  default:'La voz natural no ha podido arrancar, así que se usa la voz del sistema.'
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
  const percent = Math.max(0, Math.min(100, Math.round((download?.fraction || 0) * 100)))
  const total = download?.total > 0 ? download.total / 1048576 : voice.sizeMB
  const wrap = element('div', 'reading-neural-progress')
  const bar = element('div', 'reading-neural-bar'), fill = element('i')
  bar.setAttribute('role', 'progressbar'); bar.setAttribute('aria-label', label)
  bar.setAttribute('aria-valuemin', '0'); bar.setAttribute('aria-valuemax', '100'); bar.setAttribute('aria-valuenow', String(percent))
  fill.style.width = `${percent}%`; bar.append(fill)
  wrap.append(bar, element('span', 'reading-neural-percent', `${percent} %${total ? ` · ${Math.round(total * percent / 100)} de ${Math.round(total)} MB` : ''}`))
  return wrap
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
    panel.querySelector('[data-neural-retry]').addEventListener('click', () => { host.voice.retryNeural?.(); this.render() })
  }
  /** Nothing loads at app start: a book being opened schedules the engine module for an idle moment, ready before Play is tapped. */
  warm() {
    if (this.warmed) return
    this.warmed = true
    const run = () => this.refresh()
    if (typeof requestIdleCallback === 'function') requestIdleCallback(run, { timeout:2500 }); else setTimeout(run, 800)
  }
  /** (Re)loads the engine module if it is not there yet and re-reads what is installed. Cheap; called when the audio tab opens. */
  refresh() {
    loadNeural().then(() => this.attach(), () => {})
  }
  attach() {
    const engine = neuralEngine()
    if (engine && engine !== this.engine) {
      this.engine = engine
      engine.addEventListener('change', () => this.changed())
      engine.refresh?.()?.catch?.(() => {})
    }
    if (!engine) this.engine = null
    this.host.populateVoices()
  }
  /** Installed set changes rebuild the voice select too; download progress only repaints this block. */
  changed() {
    const engine = neuralEngine(), signature = engine ? [...engine.installed].sort().join(',') : ''
    if (signature !== this.signature) { this.signature = signature; this.host.populateVoices(); return }
    if (this.frame) return
    this.frame = requestAnimationFrame(() => { this.frame = 0; this.render() })
  }
  get bookLang() { return this.host.bookLanguage() }
  announce(text) { this.host.panel.querySelector('[data-neural-status]').textContent = text }

  render() {
    cancelAnimationFrame(this.frame); this.frame = 0
    const engine = neuralEngine(), list = neuralVoiceList(engine)
    this.signature = engine ? [...engine.installed].sort().join(',') : ''
    this.block.hidden = !list.length
    if (!list.length) { this.offer.hidden = true; this.offer.replaceChildren(); return }
    const focus = this.focusKey()
    const ordered = orderNeuralVoices(list, { bookLang:this.bookLang, deviceLang:navigator.language })
    const size = Math.max(...list.map(voice => voice.sizeMB)) || 63
    this.block.querySelector('[data-neural-note]').textContent = `Se descarga una vez (${Math.round(size)} MB) y funciona sin internet.`
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
    if (this.errors.has(voice.id) || download?.state === 'error') return { name:'error', message:this.errors.get(voice.id) || DOWNLOAD_ERRORS[download?.error] || DOWNLOAD_ERRORS.default }
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
    else if (action === 'cancel') this.tasks.get(id)?.abort()
    else if (action === 'use') this.use(id)
    else if (action === 'remove') this.remove(id)
    else if (action === 'dismiss') this.dismiss()
  }
  voiceName(id) { return neuralVoiceList().find(voice => voice.id === id)?.name || 'natural' }
  /** Downloads a voice (only ever called by a tap) and selects it when it is ready. */
  async install(id) {
    const engine = neuralEngine()
    if (!engine || this.tasks.has(id) || !isNeuralId(id)) return
    try { engine.unlock?.() } catch { /* the play tap unlocks audio again */ }
    const controller = new AbortController(), name = this.voiceName(id)
    this.tasks.set(id, controller); this.errors.delete(id)
    this.announce(`Descargando la voz ${name}.`)
    let task
    try { task = engine.install(id, { signal:controller.signal }) } catch (error) { task = Promise.reject(error) }
    this.render()
    try {
      await task
      this.tasks.delete(id)
      this.announce(`Voz ${name} instalada y seleccionada.`)
      this.host.setPreference('voice', id, { restart:false }) // the next fragment is already spoken with it
      this.host.populateVoices()
    } catch (error) {
      this.tasks.delete(id)
      if (error?.code === 'aborted' || controller.signal.aborted) this.announce('Descarga cancelada.')
      else { const message = DOWNLOAD_ERRORS[error?.code] || DOWNLOAD_ERRORS.default; this.errors.set(id, message); this.announce(`No se pudo descargar la voz ${name}. ${message}`) }
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
    // The saved choice goes first, so a voice being read stops using it before its files disappear.
    if (this.host.preferences.voice === id) this.host.setPreference('voice', '')
    try { await engine.remove(id) } catch { /* nothing else to clean up */ }
    this.errors.delete(id)
    this.announce(`Voz ${name} quitada.`)
    this.host.populateVoices()
  }

  // --- First-use offer ------------------------------------------------------------------------------------------------
  dismissed() { try { return JSON.parse(localStorage.getItem(OFFER_KEY) || '{}') || {} } catch { return {} } }
  dismiss() {
    const base = langBase(this.bookLang)
    try { localStorage.setItem(OFFER_KEY, JSON.stringify({ ...this.dismissed(), [base]:true })) } catch { /* it just asks again next time */ }
    this.render()
  }
  /** The voice to offer, or null: the audiobook is on, nothing neural speaks the book's language yet and the offer was not dismissed for it. */
  offerFor(engine, list) {
    const base = langBase(this.bookLang)
    if (!engine || !base || !this.host.voice || this.host.voice.state === 'stopped' || this.dismissed()[base]) return null
    if (list.some(voice => voice.base === base && engine.installed.has(voice.id))) return null
    return recommendedNeuralFor(list, this.bookLang, navigator.language)
  }
  renderOffer(engine, list) {
    const voice = this.offerFor(engine, list)
    this.offer.hidden = !voice
    if (!voice) { this.offer.replaceChildren(); return }
    const { name, download, message } = this.state(engine, voice)
    const size = Math.round(voice.sizeMB)
    const title = element('p', 'reading-neural-offer__title', `Voz natural sin conexión (${size} MB)`)
    const body = element('p', 'reading-hint', name === 'error' ? message : `Suena más natural que la del sistema. Mientras se descarga, la lectura sigue con la voz de ahora.`)
    this.offer.setAttribute('role', 'group'); this.offer.setAttribute('aria-label', 'Voz natural sin conexión')
    const nodes = [title, body]
    if (name === 'downloading') nodes.push(progress(`Descargando ${voice.name}`, download, voice), button('Cancelar', 'cancel', voice.id, 'is-block', `Cancelar la descarga de ${voice.name}`))
    else {
      const actions = element('div', 'reading-neural-offer__actions')
      actions.append(button(name === 'error' ? 'Reintentar' : 'Descargar', 'install', voice.id, 'is-primary', `${name === 'error' ? 'Reintentar la descarga de' : 'Descargar'} la voz natural ${voice.name} (${size} MB)`), button('Ahora no', 'dismiss', '', 'is-quiet'))
      nodes.push(actions)
    }
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
