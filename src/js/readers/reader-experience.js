import {PreferenceFlow} from './preference-flow.js'
import { readerPanelMarkup, readerIcon } from './reader-interface.js'
import { normalizeReadingPreferences, rateLabel } from './reading-preferences.js'
import { ReadingVoice } from './reading-voice.js'
import { declaredLanguage, langBase } from './voice-catalog.js'
import { SelectMenu } from './select-menu.js'
import { ReaderView } from './reader-view.js'
import { ReaderLists } from './reader-lists.js'
import { AUTO, languageOptions, voiceOptions } from './voice-menus.js'
import { neuralEngine, neuralVoiceList } from './neural-runtime.js'
import { NeuralVoicePicker } from './neural-picker.js'
import { clonePlace, cleanPlaces, cleanQuotes } from './reading-state.js'
import { isBookmarked } from './reading-places.js'
import { ReaderNavigation } from './reader-navigation.js'
import { ReaderActions } from './reader-actions.js'
import { ReaderControls } from './reader-controls.js'
import { displayBookTitle, normalizeBookAuthor } from '../book-title.js'

const STORAGE_KEY = 'inhouse-read-reading-preferences'

export class ReaderExperience {
  preferenceFlow = new PreferenceFlow(this)
  actions = new ReaderActions(this)
  navigation = new ReaderNavigation()
  get navigating() { return this.navigation.navigating }

  constructor(reader, { persist = async () => {} } = {}) {
    this.reader = reader
    this.persist = persist
    this.history = []; this.bookmarks = []; this.quotes = []; this.location = { fraction:0, locator:null }
    try { this.preferences = normalizeReadingPreferences(JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')) }
    catch { this.preferences = normalizeReadingPreferences() }
    this.screen = document.getElementById('reader-screen')
    this.toolbar = document.getElementById('reader-toolbar')
    this.locationButton = document.getElementById('reader-location')
    this.returnButton = document.createElement('button')
    this.returnButton.type = 'button'
    this.returnButton.className = 'reader-return'
    this.returnButton.hidden = true
    this.returnButton.addEventListener('click', () => this.voice.browsing ? this.voice.returnToAudio() : this.returnToReading())
    this.audioHost = document.createElement('div')
    this.audioHost.className = 'reader-audio-dock'
    this.screen.append(this.audioHost)
    this.audioHost.append(this.returnButton)
    this.panel = document.createElement('dialog')
    this.panel.className = 'reading-panel'
    this.panel.id = 'reading-controls'
    for (const id of ['reader-settings','reader-location','reader-audio']) {
      const button = document.getElementById(id)
      button.setAttribute('aria-haspopup','dialog'); button.setAttribute('aria-controls','reading-controls'); button.setAttribute('aria-expanded','false')
    }
    this.panel.innerHTML = readerPanelMarkup
    this.panel.setAttribute('aria-labelledby', 'reading-panel-title')
    this.miniPlayer = document.createElement('div')
    this.miniPlayer.className = 'reading-mini-player'; this.miniPlayer.hidden = true
    this.miniPlayer.innerHTML = `<button type="button" data-mini-open><span data-mini-title></span><small data-mini-status></small></button><button type="button" class="reading-icon-button" data-mini-play aria-label="Pausar lectura">${readerIcon('pause')}</button><button type="button" class="reading-icon-button" data-mini-stop aria-label="Detener lectura">${readerIcon('stop')}</button>`
    this.audioHost.append(this.miniPlayer)
    this.view = new ReaderView(this.screen,this.panel,this.miniPlayer,this.returnButton)
    this.lists = new ReaderLists(this.panel)
    if (typeof ResizeObserver === 'function') {
      this.miniPlayerResizeObserver = new ResizeObserver(() => this.syncMiniPlayerLayout())
      this.miniPlayerResizeObserver.observe(this.miniPlayer)
      this.returnResizeObserver = new ResizeObserver(() => this.syncReturnLayout())
      this.returnResizeObserver.observe(this.returnButton)
    }
    document.body.append(this.panel)
    this.selectedQuoteSelection = null
    this.quoteColor = 'yellow'
    const rememberSelection = selection => { if (selection?.text) this.selectedQuoteSelection = selection }
    document.addEventListener('selectionchange', () => {
      if (!this.screen.contains(document.activeElement) && !this.screen.contains(window.getSelection()?.anchorNode?.parentElement)) return
      const selection = this.reader.getSelection()
      rememberSelection(typeof selection === 'string' ? {text:selection,locator:this.reader.location.locator} : selection)
    })
    window.addEventListener('inhouse-reader-selection',event => rememberSelection(event.detail))
    this.voice = new ReadingVoice(reader, (state, message) => {
      const label = state === 'playing' ? 'Pausar' : state === 'paused' ? 'Continuar' : state === 'loading' ? 'Preparando…' : 'Reproducir'
      this.panel.querySelector('[data-play]').setAttribute('aria-label', label)
      this.panel.querySelector('[data-play]').innerHTML = readerIcon(state === 'playing' ? 'pause' : 'play')
      this.panel.querySelector('[data-play]').disabled = state === 'loading'
      this.panel.querySelector('.reading-audio-status').textContent = message || (state === 'playing' ? 'Leyendo' : state === 'paused' ? 'En pausa' : 'Detenido')
      document.getElementById('reader-audio').classList.toggle('is-playing', state === 'playing')
      if (state === 'stopped') this.setSleepChoice(0)
      this.updateMiniPlayer(state, message)
      this.updateReturnButton()
      if (state === 'paused' && !this.voice.neuralOff) this.neuralPicker?.warmUp()
      this.neuralPicker?.render() // the first-use offer follows the audiobook, the warning follows the neural voice
    })
    this.controls = new ReaderControls(this)
    // Idioma first, then the voices of that language. Both are the app's own dropdowns (no operating-system <select>);
    // the downloadable natural voices of the chosen language live at the end of the voice list.
    this.languageMenu = new SelectMenu({ label:'Idioma', onChange:value => this.chooseLanguage(value) })
    this.voiceMenu = new SelectMenu({ label:'Voz', extra:this.panel.querySelector('[data-neural]'), onChange:value => this.setPreference('voice', value) })
    this.panel.querySelector('[data-voice-menus]').append(this.languageMenu.root, this.voiceMenu.root)
    this.neuralPicker = new NeuralVoicePicker(this)
    this.populateVoices()
    const resize = () => {
      if (!this.panel.open) return
      const viewport = window.visualViewport
      const visibleHeight = viewport?.height || innerHeight
      const keyboardInset = Math.max(0, innerHeight - visibleHeight - (viewport?.offsetTop || 0))
      const anchor = !keyboardInset && innerWidth >= 760 ? this.toolbar.getBoundingClientRect().height + 12 : 0
      this.panel.style.maxHeight = `${Math.max(0, Math.min(visibleHeight - anchor - 16, innerHeight * .82))}px`
      this.panel.style.bottom = `${keyboardInset + anchor}px`
      requestAnimationFrame(() => {
        const active = document.activeElement
        if (!this.panel.open || !this.panel.contains(active) || !active.matches('input,select')) return
        const field = active.getBoundingClientRect(), panel = this.panel.getBoundingClientRect()
        if (field.bottom > panel.bottom-16) this.panel.scrollTop += field.bottom-panel.bottom+16
        else if (field.top < panel.top+60) this.panel.scrollTop -= panel.top+60-field.top
      })
    }
    window.visualViewport?.addEventListener('resize', resize)
    window.visualViewport?.addEventListener('scroll', resize)
    window.addEventListener('resize', resize)
    this.resizePanel = resize
  }
  resetAppearance() {
    this.preferences = normalizeReadingPreferences({ rate:this.preferences.rate, voice:this.preferences.voice, voiceLang:this.preferences.voiceLang })
    this.applyPreferences()
  }
  async rotateReading() {
    try {
      if (screen.orientation?.lock) { await screen.orientation.lock(screen.orientation.type.startsWith('portrait') ? 'landscape' : 'portrait'); this.error('') }
      else this.error('No se puede girar.')
    } catch { this.error('Gira el dispositivo.') }
  }
  /** The title written on the spine or the author changed (in the shelf's
   * editor, maybe while this book was already prepared): show them here too. */
  refreshNames(bookId, fields) {
    if (!this.book || String(this.book.id) !== String(bookId)) return
    Object.assign(this.book, fields)
    const title = displayBookTitle(this.book)
    const author = normalizeBookAuthor(this.book.author) || normalizeBookAuthor(this.book.metadata?.creator)
    this.view.setDocumentInfo(title,author,`${title}${author ? ` · ${author}` : ''}
${this.book.format || 'Documento'} · ${this.formatSize(this.book.sizeBytes)}`,true)
  }

  async open(record) {
    this.cancelNavigation()
    this.book = record
    this.history = cleanPlaces(record.readingHistory)
    this.bookmarks = cleanPlaces(record.bookmarks, 100)
    this.quotes = cleanQuotes(record.quotes)
    const title = displayBookTitle(record)
    const author = normalizeBookAuthor(record.author) || normalizeBookAuthor(record.metadata?.creator)
    this.view.setDocumentInfo(title,author,`${title}${author ? ` · ${author}` : ''}\n${record.format || 'Documento'} · ${this.formatSize(record.sizeBytes)}`,false)
    this.view.configureFormat(this.reader.format?.engine === 'pdf',this.reader.pageCount || 1)
    this.neuralPicker.warm() // the engine module (needed synchronously at the first Play tap) loads while the book settles
    this.renderPlaces(); this.renderToc(); await this.applyPreferences(); this.relocate()
    for (const quote of this.quotes) this.reader.addQuoteAnnotation(quote)
  }
  // Explicit book close only; no await, preload, visibility or pause hook.
  closeVoice() {
    this.neuralPicker?.cancelWarm?.()
    this.voice.stop()
    try { neuralEngine()?.release?.() } catch { /* playback is already stopped */ }
  }
  reset() {
    this.neuralPicker?.cancelWarm?.()
    this.cancelNavigation(); this.voice.stop(); this.keepSearchHits = false; this.endSearch(); this.panel.close(); this.book = null
    this.returnButton.hidden = true; this.syncReturnLayout(); this.screen.classList.remove('reader-kids-mode')
    const kids = this.panel.querySelector('[data-kids]')
    kids.setAttribute('aria-pressed','false'); kids.setAttribute('aria-label','Activar modo infantil')
  }
  relocate() {
    this.location = {...clonePlace(this.reader.location),section:this.reader.location.section || '',page:this.reader.location.page || ''}
    const label = this.label(this.location)
    const compactLabel = this.location.locator?.kind === 'pdf-page'
      ? `${this.location.locator.value}${this.reader.pageCount ? ` / ${this.reader.pageCount}` : ''}`
      : `${Math.round(this.location.fraction * 100)} %`
    this.view.relocate(label,compactLabel,this.location.fraction * 100,
      this.location.locator?.kind === 'pdf-page',this.location.locator?.value)
    this.updateBookmarkButton()
  }
  label(place) { return place.locator?.kind === 'pdf-page' ? `Página ${place.locator.value}${this.reader.pageCount ? ` de ${this.reader.pageCount}` : ''}` : place.section ? `${place.section}${place.page ? ` · Página ${place.page}` : ''}` : `${Math.round(place.fraction * 100)} % del libro` }
  show(tab) {
    if (this.screen.getAttribute('aria-busy') === 'true') return
    this.showTab(tab)
    if (tab === 'audio') { this.populateVoices(); this.neuralPicker.refresh() }
    if (!this.panel.open) this.panel.showModal()
    this.updateMiniPlayer(); this.resizePanel()
    this.panel.querySelector('[data-close]').focus({preventScroll:true})
  }
  showTab(name) {
    if (name !== 'search') this.endSearch()
    this.view.showTab(name)
  }
  showPlaceTab(name) {
    this.placeTab = name
    this.view.showPlaceTab(name)
  }
  updateMiniPlayer(state = this.voice?.state, message = '') {
    this.view.updateMiniPlayer(state || '',message,displayBookTitle(this.book),rateLabel(this.preferences.rate),Boolean(this.book),readerIcon(state === 'playing' ? 'pause' : 'play'))
  }
  syncMiniPlayerLayout() {
    this.view.syncMiniPlayerLayout()
  }
  syncReturnLayout() {
    this.view.syncReturnLayout()
  }
  updateBookmarkButton() {
    const marked = isBookmarked(this.bookmarks,this.location)
    this.view.updateBookmarkButton(marked)
  }
  setPreference(key,value,{restart=true}={}) { return this.preferenceFlow.set(key,value,restart) }
  applyPreferences(updateBook=true) { return this.preferenceFlow.apply(updateBook) }
  /** The language of the open book (the device's when it has none or no book is open). */
  bookLanguage() {
    let bookLang = ''
    try { bookLang = this.reader.language || '' } catch { /* no book open yet */ }
    return bookLang || navigator.language || ''
  }
  setSleepChoice(minutes) {
    this.view.setSleepChoice(minutes)
  }
  /** Picking a language: the voice goes back to Automática unless the one in use already speaks it. */
  chooseLanguage(value) {
    const voices = this.voiceCatalog?.voices || []
    const base = value || langBase(this.bookLanguage())
    const keep = voices.some(voice => voice.id === this.preferences.voice && voice.installed && voice.base === base)
    if (!keep && this.preferences.voice) this.setPreference('voice', '', { restart:false })
    this.setPreference('voiceLang', value)
    this.populateVoices()
  }
  /** The language whose voices the second dropdown lists: the one picked, else the one of the voice in use, else the book's. */
  voiceBase(voices) {
    const book = langBase(this.bookLanguage()), { voice: id, voiceLang } = this.preferences
    if (voiceLang) return voiceLang
    const chosen = id && voices.find(voice => voice.id === id && voice.installed)
    const declared = declaredLanguage(this.reader)
    if (chosen && !(chosen.neural && declared && chosen.base !== langBase(declared))) return chosen.base
    return book
  }
  populateVoices() {
    const voices = neuralVoiceList()
    const bookLang = this.bookLanguage(), deviceLang = navigator.language
    const requestedBase = this.voiceBase(voices), bookBase = langBase(bookLang)
    const base = voices.some(voice => voice.base === requestedBase) ? requestedBase : ''
    this.voiceBaseShown = base
    const languages = languageOptions(voices, { bookLang, deviceLang })
    const pickedLanguage = this.preferences.voiceLang || (base && base !== bookBase ? base : AUTO)
    this.languageMenu.setOptions(languages, pickedLanguage)
    this.languageMenu.setValueText(pickedLanguage === AUTO ? `Automática · ${languages[0].hint}` : '')
    const options = voiceOptions(voices, base, { bookLang, deviceLang })
    const saved = options.some(option => option.value === this.preferences.voice) ? this.preferences.voice : AUTO // a voice that is gone falls back to Automática
    this.voiceMenu.setOptions(options, saved)
    this.voiceMenu.setValueText(saved === AUTO ? (options.length > 1 ? `Automática · ${options[0].hint}` : 'Sin voces instaladas') : '')
    this.voiceCatalog = { voices, bookLang }
    this.neuralPicker?.render()
  }
  error(message) { this.panel.querySelector('.reading-error').textContent = message }
  savePlaces() { return this.actions.savePlaces() }
  cancelNavigation() {
    this.navigation.cancel()
  }
  queueNavigation(action) {
    if (!this.book) return Promise.resolve()
    const book = this.book, generation = this.navigation.generation
    const isCurrent = () => this.book === book && this.navigation.generation === generation
    // A section becomes visible before its history write finishes. Preserve
    // links tapped in that interval instead of silently dropping the request.
    return this.navigation.enqueue(action,isCurrent)
  }
  jump(place, target) {
    return this.queueNavigation(current => this.actions.jump(place,target,current))
  }
  returnToReading(index = 0) {
    const place = this.history[index]
    if (!place) return Promise.resolve()
    return this.queueNavigation(current => this.actions.returnToReading(place,current))
  }
  addBookmark() { return this.actions.addBookmark() }
  addQuote() { return this.actions.addQuote() }
  search(query) { return this.actions.search(query) }
  endSearch() { return this.actions.endSearch() }
  async shareBook() {
    const content = this.book?.content
    if (!content) { this.error('Archivo original no disponible.'); return }
    const file = new File([content],this.book.fileName || `${this.book.title}.${String(this.book.format||'pdf').toLowerCase()}`,{type:this.book.mimeType || content.type || 'application/octet-stream'})
    try {
      if (navigator.canShare?.({files:[file]}) && navigator.share) await navigator.share({title:displayBookTitle(this.book),files:[file]})
      else { const url = URL.createObjectURL(file), link = document.createElement('a'); link.href=url; link.download=file.name; link.click(); setTimeout(()=>URL.revokeObjectURL(url),30000) }
      this.panel.close()
    } catch (error) { if (error.name !== 'AbortError') this.error('No se pudo compartir.') }
  }
  formatSize(bytes = 0) { return bytes >= 1048576 ? `${(bytes/1048576).toFixed(1)} MB` : `${Math.max(1,Math.round(bytes/1024))} KB` }
  renderPlaces() {
    this.updateBookmarkButton()
    this.updateReturnButton()
    for (const [name, places] of [['history',this.history],['bookmarks',this.bookmarks],['quotes',this.quotes]]) {
      this.lists.renderPlaces(name,places,places.map(place => place.label || this.label(place)),
        (index,place) => name === 'history' ? this.returnToReading(index) : this.jump(place),
        async index => { const [removed] = places.splice(index,1); if (name === 'quotes') this.reader.removeQuoteAnnotation(removed); await this.savePlaces(); this.renderPlaces() },readerIcon('close'))
    }
  }
  renderToc() {
    const available = this.lists.renderToc(this.reader.toc,href => this.jump(null,href))
    this.showPlaceTab(available ? 'toc' : 'bookmarks')
  }
  step(direction) {
    // Consult another page without moving the independent audible cursor.
    return this.queueNavigation(() => this.voice.continueFromPage(() => direction > 0 ? this.reader.next() : this.reader.prev()))
  }
  updateReturnButton() {
    const audio = this.voice?.browsing
    this.view.updateReturnButton(Boolean(audio),Boolean(this.history.length),this.history.length ? this.history[0].label || this.label(this.history[0]) : '')
  }
}
