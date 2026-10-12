import { notifyCloudSettingsChanged } from '../cloud-settings.js'
import { readerPanelMarkup, readerIcon } from './reader-interface.js'
import { normalizeReadingPreferences, rateLabel, READING_THEMES } from './reading-preferences.js'
import { ReadingVoice } from './reading-voice.js'
import { declaredLanguage, langBase } from './voice-catalog.js'
import { SelectMenu } from './select-menu.js'
import { ReaderView } from './reader-view.js'
import { ReaderLists } from './reader-lists.js'
import { AUTO, languageOptions, voiceOptions } from './voice-menus.js'
import { neuralEngine, neuralVoiceList } from './neural-runtime.js'
import { NeuralVoicePicker } from './neural-picker.js'
import { clonePlace, cleanPlaces, cleanQuotes } from './reading-state.js'
import { isBookmarked, toggleBookmark, prependHistory } from './reading-places.js'
import { ReaderNavigation } from './reader-navigation.js'
import { displayBookTitle, normalizeBookAuthor } from '../book-title.js'

const STORAGE_KEY = 'inhouse-read-reading-preferences'

export class ReaderExperience {
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
    this.panel.querySelector('[data-close]').onclick = () => this.panel.close()
    this.panel.addEventListener('click', event => {
      const r = this.panel.getBoundingClientRect()
      if (event.target === this.panel && (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom)) this.panel.close()
    })
    this.panel.addEventListener('close', () => {
      if (this.panel.open) return
      // Hit marks stay on the page only after jumping to a result; any other close ends the search.
      if (!this.keepSearchHits) this.endSearch()
      this.keepSearchHits = false
      for (const id of ['reader-settings','reader-location','reader-audio']) document.getElementById(id).setAttribute('aria-expanded','false')
      this.updateMiniPlayer()
    })
    for (const tab of this.panel.querySelectorAll('[data-place-tab]')) {
      tab.onclick = () => this.showPlaceTab(tab.dataset.placeTab)
      tab.onkeydown = event => {
        if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return
        const tabs = [...this.panel.querySelectorAll('[data-place-tab]')].filter(t => !t.hidden)
        const index = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length-1 : (tabs.indexOf(tab) + (event.key === 'ArrowRight' ? 1 : tabs.length-1)) % tabs.length
        tabs[index].click(); tabs[index].focus(); event.preventDefault()
      }
    }
    for (const button of this.panel.querySelectorAll('[data-size-step]')) button.onclick = () => this.setPreference('fontSize', this.preferences.fontSize + Number(button.dataset.sizeStep))
    this.miniPlayer.querySelector('[data-mini-open]').onclick = () => this.show('audio')
    this.miniPlayer.querySelector('[data-mini-play]').onclick = () => this.voice.state === 'playing' ? this.voice.pause() : this.voice.play()
    this.miniPlayer.querySelector('[data-mini-stop]').onclick = () => this.voice.stop()
    for (const button of this.panel.querySelectorAll('[data-theme]')) button.onclick = () => this.setPreference('theme', button.dataset.theme)
    for (const control of this.panel.querySelectorAll('[data-pref]')) control.addEventListener('change', () => this.setPreference(control.dataset.pref, control.value))
    for (const radio of this.panel.querySelectorAll('[data-rate]')) radio.addEventListener('change', () => { if (radio.checked) this.setPreference('rate', radio.value) })
    this.panel.querySelector('[data-reset]').onclick = () => {
      this.preferences = normalizeReadingPreferences({ rate:this.preferences.rate, voice:this.preferences.voice, voiceLang:this.preferences.voiceLang })
      this.applyPreferences()
    }
    this.panel.querySelector('[data-progress]').addEventListener('input', event => {
      this.panel.querySelector('.reading-position').textContent = `${Math.round(Number(event.target.value))} % del libro`
    })
    this.panel.querySelector('[data-progress]').addEventListener('change', event => this.jump({ fraction:Number(event.target.value) / 100, locator:null }))
    this.panel.querySelector('.reading-page-form').onsubmit = event => {
      event.preventDefault()
      const page = Number(this.panel.querySelector('input[type="number"]').value)
      this.jump({ fraction:(page - 1) / Math.max(1, reader.pageCount - 1), locator:{ kind:'pdf-page', value:page } })
    }
    this.panel.querySelector('[data-bookmark]').onclick = () => this.addBookmark()
    document.getElementById('reader-save-bookmark').onclick = () => this.addBookmark()
    document.getElementById('reader-rotate').onclick = async () => {
      try {
        if (screen.orientation?.lock) { await screen.orientation.lock(screen.orientation.type.startsWith('portrait') ? 'landscape' : 'portrait'); this.error('') }
        else this.error('No se puede girar.')
      } catch { this.error('Gira el dispositivo.') }
    }
    this.panel.querySelector('[data-play]').onclick = () => this.voice.state === 'playing' ? this.voice.pause() : this.voice.play()
    this.panel.querySelector('[data-audio-prev]').onclick = () => this.step(-1)
    this.panel.querySelector('[data-audio-next]').onclick = () => this.step(1)
    this.panel.querySelector('[data-stop]').onclick = () => this.voice.stop()
    for (const chip of this.panel.querySelectorAll('[data-sleep-value]')) chip.onclick = () => { const minutes = Number(chip.dataset.sleepValue); this.setSleepChoice(minutes); this.voice.setSleep(minutes) }
    document.getElementById('reader-settings').onclick = () => this.show('appearance')
    document.getElementById('reader-audio').onclick = () => this.show('audio')
    this.locationButton.onclick = () => this.show('navigation')
    document.getElementById('reader-search-shortcut').onclick = () => this.show('search')
    document.getElementById('reader-toc-shortcut').onclick = () => {
      this.show('navigation')
      this.showPlaceTab(this.panel.querySelector('[data-place-tab="toc"]').hidden ? 'bookmarks' : 'toc')
    }
    document.getElementById('reader-more-shortcut').onclick = () => this.show('more')
    this.panel.querySelector('[data-search-form]').onsubmit = event => { event.preventDefault(); this.search(this.panel.querySelector('[data-search-query]').value) }
    this.panel.querySelector('[data-search-query]').addEventListener('input', event => { if (!event.target.value.trim()) this.endSearch() })
    this.panel.querySelector('[data-save-quote]').onclick = () => this.addQuote()
    this.panel.querySelectorAll('[data-quote-color]').forEach(button => button.onclick = () => {
      this.quoteColor = button.dataset.quoteColor
      this.panel.querySelectorAll('[data-quote-color]').forEach(item => item.setAttribute('aria-pressed',String(item === button)))
    })
    this.panel.querySelector('[data-about]').onclick = () => this.show('about')
    this.panel.querySelector('[data-share]').onclick = () => this.shareBook()
    this.panel.querySelector('[data-kids]').onclick = event => {
      const enabled = event.currentTarget.getAttribute('aria-pressed') !== 'true'
      event.currentTarget.setAttribute('aria-pressed',String(enabled)); this.screen.classList.toggle('reader-kids-mode',enabled)
      event.currentTarget.setAttribute('aria-label',enabled ? 'Salir del modo infantil' : 'Activar modo infantil')
    }
    this.panel.querySelectorAll('[data-voice-option]').forEach(control => control.addEventListener('change', () => this.setPreference(control.dataset.voiceOption,control.checked)))
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
  /** The title written on the spine or the author changed (in the shelf's
   * editor, maybe while this book was already prepared): show them here too. */
  refreshNames(bookId, fields) {
    if (!this.book || String(this.book.id) !== String(bookId)) return
    Object.assign(this.book, fields)
    const title = displayBookTitle(this.book)
    const author = normalizeBookAuthor(this.book.author) || normalizeBookAuthor(this.book.metadata?.creator)
    this.panel.querySelector('#reading-book-title').textContent = title
    document.getElementById('reader-top-title').textContent = title
    document.getElementById('reader-top-byline').textContent = author
    this.panel.querySelector('#reading-document-about').textContent = `${title}${author ? ` · ${author}` : ''}
${this.book.format || 'Documento'} · ${this.formatSize(this.book.sizeBytes)}`
    const mini = this.miniPlayer?.querySelector('[data-mini-title]')
    if (mini) mini.textContent = title
  }

  async open(record) {
    this.cancelNavigation()
    this.book = record
    this.history = cleanPlaces(record.readingHistory)
    this.bookmarks = cleanPlaces(record.bookmarks, 100)
    this.quotes = cleanQuotes(record.quotes)
    this.panel.querySelector('#reading-book-title').textContent = displayBookTitle(record)
    document.getElementById('reader-top-title').textContent = displayBookTitle(record)
    const author = normalizeBookAuthor(record.author) || normalizeBookAuthor(record.metadata?.creator)
    document.getElementById('reader-top-byline').textContent = author
    this.panel.querySelector('#reading-document-about').textContent = `${displayBookTitle(record)}${author ? ` · ${author}` : ''}\n${record.format || 'Documento'} · ${this.formatSize(record.sizeBytes)}`
    const pdf = this.reader.format?.engine === 'pdf'
    for (const element of this.panel.querySelectorAll('[data-pdf]')) element.hidden = !pdf
    this.panel.querySelector('[data-epub]').hidden = pdf
    this.panel.querySelector('input[type="number"]').max = String(this.reader.pageCount || 1)
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
    this.locationButton.querySelector('.reader-location-label').textContent = compactLabel
    this.locationButton.setAttribute('aria-label', `Progreso y capítulos, ${label}`)
    this.locationButton.title = label
    this.panel.querySelector('.reading-position').textContent = label
    this.panel.querySelector('[data-audio-where]').textContent = label
    const range = this.panel.querySelector('[data-progress]')
    if (document.activeElement !== range) range.value = String(this.location.fraction * 100)
    const page = this.panel.querySelector('input[type="number"]')
    if (document.activeElement !== page && this.location.locator?.kind === 'pdf-page') page.value = String(this.location.locator.value)
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
  setPreference(key, value, { restart = true } = {}) {
    const audio = ['rate','voice','voiceLang','footnotes','multilingual','skipHeaders'].includes(key)
    if (!audio) this.voice.stop()
    this.preferences = normalizeReadingPreferences({ ...this.preferences, [key]:value }); this.applyPreferences(!audio); notifyCloudSettingsChanged(STORAGE_KEY)
    this.voice.options = {footnotes:this.preferences.footnotes,multilingual:this.preferences.multilingual,skipHeaders:this.preferences.skipHeaders}
    if (key === 'rate' || key === 'voice' || key === 'voiceLang') { this.voice.retryNeural?.(); if (restart) this.voice.restart?.() } // a new speed or choice gives a neural voice another chance
    if (audio) this.neuralPicker?.warmUp()
  }
  async applyPreferences(updateBook = true) {
    const p = this.preferences
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(p)) } catch { /* reading still works without storage */ }
    const theme = READING_THEMES[p.theme]
    this.view.applyPreferences(p,theme,this.reader.format?.engine === 'pdf')
    this.voice.rate = p.rate; this.voice.voice = p.voice; this.voice.languageOverride = p.voiceLang
    this.neuralPicker?.render()
    this.voice.options = {footnotes:p.footnotes,multilingual:p.multilingual,skipHeaders:p.skipHeaders}
    this.updateMiniPlayer()
    try { if (updateBook) await this.reader.applyPreferences(p) } catch { this.error('No se pudo aplicar.') }
  }
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
  async savePlaces() {
    if (!this.book) return
    try { await this.persist(this.book.id, { readingHistory:cleanPlaces(this.history), bookmarks:cleanPlaces(this.bookmarks, 100), quotes:cleanQuotes(this.quotes) }) }
    catch { this.error('No se pudieron guardar los marcadores.') }
  }
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
    return this.queueNavigation(async isCurrent => {
      this.voice.browse(); this.error('')
      const origin = { ...clonePlace(this.location), label:this.label(this.location), createdAt:Date.now() }
      this.history = prependHistory(this.history,origin)
      await this.savePlaces()
      if (!isCurrent()) return
      this.renderPlaces()
      try {
        if (target !== undefined) await this.reader.goToTarget(target)
        else await this.reader.goToLocator(place.locator, place.fraction)
        if (!isCurrent()) return
        this.relocate(); this.panel.close()
      } catch { if (isCurrent()) this.error('No se pudo abrir.') }
    })
  }
  returnToReading(index = 0) {
    const place = this.history[index]
    if (!place) return Promise.resolve()
    return this.queueNavigation(async isCurrent => {
      if (!this.history.includes(place)) return
      this.voice.browse()
      try {
        await this.reader.goToLocator(place.locator, place.fraction)
        if (!isCurrent()) return
        this.history.splice(this.history.indexOf(place),1)
        await this.savePlaces()
        if (!isCurrent()) return
        this.relocate(); this.renderPlaces(); this.panel.close()
      } catch { if (isCurrent()) this.error('No se pudo volver.') }
    })
  }
  async addBookmark() {
    this.bookmarks = toggleBookmark(this.bookmarks,this.location,()=>({ ...clonePlace(this.location), label:this.label(this.location), createdAt:Date.now() }))
    await this.savePlaces(); this.renderPlaces(); this.showPlaceTab('bookmarks')
  }
  async addQuote() {
    const selection = this.reader.getSelection() || this.selectedQuoteSelection
    const text = typeof selection === 'string' ? selection : selection?.text
    if (!text) { this.error('Selecciona un texto primero.'); return }
    const locator = typeof selection === 'string' ? this.location.locator : selection.locator
    const quote = {id:globalThis.crypto?.randomUUID?.() || `${Date.now()}`,text,locator,fraction:this.location.fraction,label:this.label(this.location),color:this.quoteColor,createdAt:Date.now()}
    this.quotes = cleanQuotes([quote,...this.quotes]); this.reader.addQuoteAnnotation(quote)
    this.selectedQuoteSelection = null
    await this.savePlaces(); this.renderPlaces(); this.showPlaceTab('quotes')
  }
  async search(query) {
    this.lists.clearSearch('Buscando…')
    try {
      const results = await this.reader.search(query)
      this.searchActive = results.length > 0
      this.lists.renderSearch(results,result => { this.keepSearchHits = true; this.jump({fraction:result.fraction ?? this.location.fraction,locator:result.locator}) })
    } catch { this.panel.querySelector('[data-search-status]').textContent = 'No se pudo buscar.' }
  }
  // Clears the on-page hit marks together with the result list they belong to.
  endSearch() {
    if (!this.searchActive) return
    this.searchActive = false; this.keepSearchHits = false
    this.reader.clearSearch?.()
    this.lists.clearSearch('')
  }
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
