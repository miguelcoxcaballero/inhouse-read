import { readerPanelMarkup, readerIcon } from './reader-interface.js'
import { normalizeReadingPreferences, READING_THEMES } from './reading-preferences.js'
import { ReadingVoice } from './reading-voice.js'
import { bestVoiceFor, buildVoiceGroups, languageName, needsBetterVoice, readSystemVoices } from './voice-catalog.js'
import { neuralVoiceList } from './neural-runtime.js'
import { NeuralVoicePicker } from './neural-picker.js'
import { clonePlace, cleanPlaces, cleanQuotes } from './reading-state.js'
import { normalizeBookAuthor } from '../book-title.js'

const STORAGE_KEY = 'inhouse-read-reading-preferences'

export class ReaderExperience {
  navigationGeneration = 0
  navigationQueue = Promise.resolve()

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
    this.returnButton.addEventListener('click', () => this.returnToReading())
    this.screen.append(this.returnButton)
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
    this.screen.append(this.miniPlayer)
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
      if (state === 'stopped') this.panel.querySelector('[data-sleep]').value = '0'
      this.updateMiniPlayer(state, message)
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
    this.panel.querySelector('[data-reset]').onclick = () => {
      this.preferences = normalizeReadingPreferences({ rate:this.preferences.rate, voice:this.preferences.voice })
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
    this.panel.querySelector('[data-sleep]').onchange = event => this.voice.setSleep(Number(event.target.value))
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
    window.speechSynthesis?.addEventListener('voiceschanged', () => this.populateVoices())
    window.addEventListener('inhouse-tts', event => { if (event.detail?.type === 'voiceschanged') this.populateVoices() })
    this.panel.querySelector('[data-voice-settings]').onclick = () => {
      try { window.InhouseSpeech.openVoiceSettings() } catch { this.error('No se pudieron abrir los ajustes de voz.') }
    }
    // Coming back from Android's voice downloads: ask the bridge to re-read the installed voices.
    document.addEventListener('visibilitychange', () => { if (!document.hidden && this.panel.open) this.refreshNativeVoices() })
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
  async open(record) {
    this.cancelNavigation()
    this.book = record
    this.history = cleanPlaces(record.readingHistory)
    this.bookmarks = cleanPlaces(record.bookmarks, 100)
    this.quotes = cleanQuotes(record.quotes)
    this.panel.querySelector('#reading-book-title').textContent = record.title
    document.getElementById('reader-top-title').textContent = record.title
    const author = normalizeBookAuthor(record.author) || normalizeBookAuthor(record.metadata?.creator)
    document.getElementById('reader-top-byline').textContent = author
    this.panel.querySelector('#reading-document-about').textContent = `${record.title}${author ? ` · ${author}` : ''}\n${record.format || 'Documento'} · ${this.formatSize(record.sizeBytes)}`
    const pdf = this.reader.format?.engine === 'pdf'
    for (const element of this.panel.querySelectorAll('[data-pdf]')) element.hidden = !pdf
    this.panel.querySelector('[data-epub]').hidden = pdf
    this.panel.querySelector('input[type="number"]').max = String(this.reader.pageCount || 1)
    this.neuralPicker.warm() // the engine module (needed synchronously at the first Play tap) loads while the book settles
    this.renderPlaces(); this.renderToc(); await this.applyPreferences(); this.relocate()
    for (const quote of this.quotes) this.reader.addQuoteAnnotation(quote)
  }
  reset() {
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
    this.showTab(tab)
    if (tab === 'audio') { this.populateVoices(); this.refreshNativeVoices(); this.neuralPicker.refresh() } // the recommended list depends on the book's language
    if (!this.panel.open) this.panel.showModal()
    this.updateMiniPlayer(); this.resizePanel()
    this.panel.querySelector('[data-close]').focus({preventScroll:true})
  }
  showTab(name) {
    if (name !== 'search') this.endSearch()
    for (const section of ['appearance','navigation','audio','search','more']) this.panel.querySelector(`#reading-${section}`).hidden = section !== name
    this.panel.querySelector('#reading-about').hidden = name !== 'about'
    const title = {appearance:'Texto',navigation:'Contenido',audio:'Escuchar',search:'Buscar',more:'Más opciones',about:'Documento'}[name]
    this.panel.querySelector('#reading-panel-title').textContent = title
    this.panel.dataset.view = name
    this.panel.scrollTop = 0
    for (const [id,tab] of [['reader-settings','appearance'],['reader-location','navigation'],['reader-audio','audio']]) document.getElementById(id).setAttribute('aria-expanded',String(tab === name))
  }
  showPlaceTab(name) {
    this.placeTab = name
    for (const button of this.panel.querySelectorAll('[data-place-tab]')) {
      if (button.hidden) continue
      const selected = button.dataset.placeTab === name
      button.setAttribute('aria-selected',String(selected)); button.tabIndex = selected ? 0 : -1
      this.panel.querySelector(`[data-places="${button.dataset.placeTab}"]`).hidden = !selected
    }
  }
  updateMiniPlayer(state = this.voice?.state, message = '') {
    const active = Boolean(this.book) && ['playing','paused','loading'].includes(state)
    this.screen.classList.toggle('has-reading-audio', active)
    this.miniPlayer.hidden = !active || this.panel.open
    this.screen.classList.toggle('has-reading-mini-player', !this.miniPlayer.hidden)
    this.miniPlayer.querySelector('[data-mini-title]').textContent = this.book?.title || ''
    this.miniPlayer.querySelector('[data-mini-status]').textContent = message || `${state === 'paused' ? 'En pausa' : state === 'loading' ? 'Preparando…' : 'Leyendo'} · ${this.preferences.rate}×`
    const play = this.miniPlayer.querySelector('[data-mini-play]')
    play.innerHTML = readerIcon(state === 'playing' ? 'pause' : 'play')
    play.setAttribute('aria-label',state === 'playing' ? 'Pausar lectura' : 'Continuar lectura')
    play.disabled = state === 'loading'
    this.syncMiniPlayerLayout()
  }
  syncMiniPlayerLayout() {
    const height = this.miniPlayer.hidden ? 0 : Math.ceil(this.miniPlayer.getBoundingClientRect().height)
    this.screen.style.setProperty('--reader-audio-height', `${height}px`)
  }
  syncReturnLayout() {
    const height = this.returnButton.hidden ? 0 : Math.ceil(this.returnButton.getBoundingClientRect().height)
    this.screen.style.setProperty('--reader-return-height', `${height}px`)
  }
  updateBookmarkButton() {
    const marked = this.bookmarks.some(x => JSON.stringify(x.locator) === JSON.stringify(this.location.locator) && Math.abs(x.fraction-this.location.fraction)<.0001)
    const button = this.panel.querySelector('[data-bookmark]')
    button.setAttribute('aria-pressed',String(marked))
    button.setAttribute('aria-label',marked ? 'Quitar marcador de esta página' : 'Marcar esta página')
    button.title = button.getAttribute('aria-label')
    const quick = document.getElementById('reader-save-bookmark')
    quick.setAttribute('aria-pressed',String(marked)); quick.setAttribute('aria-label',marked ? 'Quitar marcador rápido' : 'Guardar marcador rápido')
  }
  setPreference(key, value, { restart = true } = {}) {
    const audio = ['rate','voice','footnotes','multilingual','skipHeaders'].includes(key)
    if (!audio) this.voice.stop()
    this.preferences = normalizeReadingPreferences({ ...this.preferences, [key]:value }); this.applyPreferences(!audio)
    this.voice.options = {footnotes:this.preferences.footnotes,multilingual:this.preferences.multilingual,skipHeaders:this.preferences.skipHeaders}
    if (key === 'rate' || key === 'voice') { this.voice.retryNeural?.(); if (restart) this.voice.restart?.() } // a new speed or choice gives a neural voice another chance
    if (key === 'voice') this.neuralPicker?.warmUp() // a neural voice is loaded (worker, model) before the tap, not at it
  }
  async applyPreferences(updateBook = true) {
    const p = this.preferences
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(p)) } catch { /* reading still works without storage */ }
    const theme = READING_THEMES[p.theme]
    for (const surface of [this.screen,this.panel,document.querySelector('.app-header')].filter(Boolean)) {
      surface.dataset.readingTheme = p.theme
      surface.style.colorScheme = theme.scheme
    }
    // 100% is the identity: leave the filter off so the viewport is not a filter surface during reader animations.
    this.screen.style.setProperty('--reader-brightness-filter',p.brightness === 100 ? 'none' : `brightness(${p.brightness}%)`)
    for (const surface of [this.screen,this.screen.parentElement,this.panel]) {
      surface.style.setProperty('--reading-paper', theme.background)
      surface.style.setProperty('--reading-ink', theme.color)
    }
    this.panel.querySelector('[data-size-step="-1"]').disabled = p.fontSize <= 14
    this.panel.querySelector('[data-size-step="1"]').disabled = p.fontSize >= 36
    for (const field of this.panel.querySelectorAll('[data-pref]')) field.value = String(p[field.dataset.pref])
    for (const field of this.panel.querySelectorAll('[data-voice-option]')) field.checked = Boolean(p[field.dataset.voiceOption])
    for (const output of this.panel.querySelectorAll('[data-output]')) output.textContent = `${p[output.dataset.output]}${output.dataset.output === 'rate' ? '×' : ['zoom','brightness'].includes(output.dataset.output) ? '%' : ['fontSize','margin'].includes(output.dataset.output) ? ' px' : ''}`
    for (const button of this.panel.querySelectorAll('[data-theme]')) button.setAttribute('aria-pressed', String(button.dataset.theme === p.theme))
    const originalPdf = this.reader.format?.engine === 'pdf' && p.pdfMode === 'original'
    this.panel.querySelector('[data-typography]').hidden = originalPdf
    this.panel.querySelector('[data-pdf-hint]').hidden = !originalPdf
    this.panel.querySelector('[data-pdf-zoom]').hidden = !originalPdf
    this.voice.rate = p.rate; this.voice.voice = p.voice
    this.updateVoiceInfo()
    this.neuralPicker?.render()
    this.voice.options = {footnotes:p.footnotes,multilingual:p.multilingual,skipHeaders:p.skipHeaders}
    this.updateMiniPlayer()
    try { if (updateBook) await this.reader.applyPreferences(p) } catch { this.error('No se pudo aplicar.') }
  }
  refreshNativeVoices() { try { window.InhouseSpeech?.refreshVoices?.() } catch { /* older app: voices stay as loaded */ } }
  /** The language of the open book (the device's when it has none or no book is open). */
  bookLanguage() {
    let bookLang = ''
    try { bookLang = this.reader.language || '' } catch { /* no book open yet */ }
    return bookLang || navigator.language || ''
  }
  populateVoices() {
    const select = this.panel.querySelector('[data-pref="voice"]')
    const voices = [...readSystemVoices(window), ...neuralVoiceList()]
    const bookLang = this.bookLanguage()
    const groups = buildVoiceGroups(voices, { bookLang, deviceLang:navigator.language })
    select.replaceChildren(new Option('Automática', ''))
    for (const [label, items] of [['Voces naturales', groups.neural], ['Recomendadas', groups.recommended], ['Todas las voces', groups.all]]) {
      if (!items.length) continue
      const group = document.createElement('optgroup'); group.label = label
      for (const item of items) group.append(new Option(item.label, item.id))
      select.append(group)
    }
    select.value = this.preferences.voice
    if (select.value !== this.preferences.voice) select.value = '' // a saved voice that is no longer installed falls back to Automática
    this.voiceCatalog = { voices, groups, bookLang }
    this.updateVoiceInfo()
    this.neuralPicker?.render()
  }
  /** Says which voice 'Automática' will use and, on Android only, offers the voice download when the best one is not high quality. */
  updateVoiceInfo() {
    if (!this.voiceCatalog) return
    const { voices, groups, bookLang } = this.voiceCatalog
    const native = typeof window.InhouseSpeech?.openVoiceSettings === 'function'
    const best = bestVoiceFor(voices, bookLang, navigator.language)
    const auto = !this.preferences.voice || !voices.some(voice => voice.id === this.preferences.voice && voice.installed)
    const better = native && needsBetterVoice(voices, bookLang, navigator.language)
    const info = this.panel.querySelector('[data-voice-info]')
    info.querySelector('[data-voice-auto]').textContent = !auto ? '' : best ? groups.labels.get(best.id) : voices.length ? `Sin voces en ${languageName(bookLang)}` : ''
    info.querySelector('[data-voice-settings]').hidden = !better
    info.hidden = !(better || info.querySelector('[data-voice-auto]').textContent)
  }
  error(message) { this.panel.querySelector('.reading-error').textContent = message }
  async savePlaces() {
    if (!this.book) return
    try { await this.persist(this.book.id, { readingHistory:cleanPlaces(this.history), bookmarks:cleanPlaces(this.bookmarks, 100), quotes:cleanQuotes(this.quotes) }) }
    catch { this.error('No se pudieron guardar los marcadores.') }
  }
  cancelNavigation() {
    this.navigationGeneration++
    this.navigationQueue = Promise.resolve()
    this.navigating = false
  }
  queueNavigation(action) {
    if (!this.book) return Promise.resolve()
    const book = this.book, generation = this.navigationGeneration
    const isCurrent = () => this.book === book && this.navigationGeneration === generation
    // A section becomes visible before its history write finishes. Preserve
    // links tapped in that interval instead of silently dropping the request.
    const task = this.navigationQueue.catch(() => {}).then(async () => {
      if (!isCurrent()) return
      this.navigating = true
      try { return await action(isCurrent) }
      finally { if (isCurrent()) this.navigating = false }
    })
    this.navigationQueue = task
    return task
  }
  jump(place, target) {
    return this.queueNavigation(async isCurrent => {
      this.voice.stop(); this.error('')
      const origin = { ...clonePlace(this.location), label:this.label(this.location), createdAt:Date.now() }
      this.history = [origin, ...this.history].slice(0,20)
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
      this.voice.stop()
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
    const duplicate = this.bookmarks.some(x => JSON.stringify(x.locator) === JSON.stringify(this.location.locator) && Math.abs(x.fraction - this.location.fraction) < .0001)
    if (duplicate) this.bookmarks = this.bookmarks.filter(x => !(JSON.stringify(x.locator) === JSON.stringify(this.location.locator) && Math.abs(x.fraction-this.location.fraction)<.0001))
    else this.bookmarks.unshift({ ...clonePlace(this.location), label:this.label(this.location), createdAt:Date.now() })
    this.bookmarks = this.bookmarks.slice(0,100)
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
    const status = this.panel.querySelector('[data-search-status]'), list = this.panel.querySelector('[data-search-results]')
    list.replaceChildren(); status.textContent = 'Buscando…'
    try {
      const results = await this.reader.search(query)
      this.searchActive = results.length > 0
      status.textContent = results.length ? `${results.length} ${results.length === 1 ? 'resultado' : 'resultados'}` : 'Sin resultados'
      for (const result of results) {
        // Where (chapter/page) above, the excerpt below with the match marked.
        const button = document.createElement('button'); button.type = 'button'; button.className = 'reading-search-hit'
        if (result.label) { const where = document.createElement('small'); where.textContent = result.label; button.append(where) }
        const line = document.createElement('span'), { pre = result.excerpt || '', match = '', post = '' } = result.parts || {}
        if (match) { const mark = document.createElement('mark'); mark.textContent = match; line.append(pre, mark, post) }
        else line.textContent = pre
        button.append(line)
        button.onclick = () => { this.keepSearchHits = true; this.jump({fraction:result.fraction ?? this.location.fraction,locator:result.locator}) }
        list.append(button)
      }
    } catch { status.textContent = 'No se pudo buscar.' }
  }
  // Clears the on-page hit marks together with the result list they belong to.
  endSearch() {
    if (!this.searchActive) return
    this.searchActive = false; this.keepSearchHits = false
    this.reader.clearSearch?.()
    this.panel.querySelector('[data-search-results]').replaceChildren()
    this.panel.querySelector('[data-search-status]').textContent = ''
  }
  async shareBook() {
    const content = this.book?.content
    if (!content) { this.error('Archivo original no disponible.'); return }
    const file = new File([content],this.book.fileName || `${this.book.title}.${String(this.book.format||'pdf').toLowerCase()}`,{type:this.book.mimeType || content.type || 'application/octet-stream'})
    try {
      if (navigator.canShare?.({files:[file]}) && navigator.share) await navigator.share({title:this.book.title,files:[file]})
      else { const url = URL.createObjectURL(file), link = document.createElement('a'); link.href=url; link.download=file.name; link.click(); setTimeout(()=>URL.revokeObjectURL(url),30000) }
      this.panel.close()
    } catch (error) { if (error.name !== 'AbortError') this.error('No se pudo compartir.') }
  }
  formatSize(bytes = 0) { return bytes >= 1048576 ? `${(bytes/1048576).toFixed(1)} MB` : `${Math.max(1,Math.round(bytes/1024))} KB` }
  renderPlaces() {
    this.updateBookmarkButton()
    this.returnButton.hidden = !this.history.length
    this.returnButton.textContent = this.history.length ? `↶ Volver a ${this.history[0].label || this.label(this.history[0])}` : ''
    this.syncReturnLayout()
    for (const [name, places] of [['history',this.history],['bookmarks',this.bookmarks],['quotes',this.quotes]]) {
      const list = this.panel.querySelector(`[data-${name}]`)
      list.replaceChildren()
      if (!places.length) { const empty = document.createElement('p'); empty.className = 'reading-hint'; empty.textContent = name === 'history' ? 'Sin recientes' : name === 'quotes' ? 'Sin citas' : 'Sin marcadores'; list.append(empty) }
      places.forEach((place,index) => {
        const row = document.createElement('div'); row.className = 'reading-place'
        const button = document.createElement('button'); button.type = 'button'; button.textContent = name === 'quotes' ? `“${place.text}” · ${place.label || this.label(place)}` : place.label || this.label(place)
        button.onclick = () => name === 'history' ? this.returnToReading(index) : this.jump(place)
        const remove = document.createElement('button'); remove.type = 'button'; remove.innerHTML = readerIcon('close'); remove.setAttribute('aria-label', `Eliminar ${place.label || this.label(place)}`)
        remove.onclick = async () => { const [removed] = places.splice(index,1); if (name === 'quotes') this.reader.removeQuoteAnnotation(removed); await this.savePlaces(); this.renderPlaces() }
        row.append(button,remove); list.append(row)
      })
    }
  }
  renderToc() {
    const list = this.panel.querySelector('[data-toc]'); list.replaceChildren()
    const add = (items, depth = 0) => {
      for (const item of items || []) {
        if (item.href != null) { const button = document.createElement('button'); button.type = 'button'; button.textContent = item.label || 'Capítulo'; button.style.paddingInlineStart = `${12 + Math.min(4,depth) * 12}px`; button.onclick = () => this.jump(null,item.href); list.append(button) }
        if (depth < 8) add(item.subitems,depth+1)
      }
    }
    add(this.reader.toc)
    this.panel.querySelector('[data-place-tab="toc"]').hidden = !list.childElementCount
    this.showPlaceTab(list.childElementCount ? 'toc' : 'bookmarks')
  }
  step(direction) {
    return this.queueNavigation(() => {
      this.voice.stop()
      return direction > 0 ? this.reader.next() : this.reader.prev()
    })
  }
}
