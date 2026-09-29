import { readerPanelMarkup, readerIcon } from './reader-interface.js'
import { normalizeReadingPreferences, READING_THEMES } from './reading-preferences.js'
import { ReadingVoice } from './reading-voice.js'
import { clonePlace, cleanPlaces, cleanQuotes } from './reading-state.js'

const STORAGE_KEY = 'inhouse-read-reading-preferences'

export class ReaderExperience {
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
      this.panel.querySelector('.reading-audio-status').textContent = message || (state === 'playing' ? 'Leyendo en voz alta' : state === 'paused' ? 'En pausa' : 'Lista para escuchar')
      document.getElementById('reader-audio').classList.toggle('is-playing', state === 'playing')
      if (state === 'stopped') this.panel.querySelector('[data-sleep]').value = '0'
      this.updateMiniPlayer(state, message)
    })
    this.panel.querySelector('[data-close]').onclick = () => this.panel.close()
    this.panel.addEventListener('click', event => {
      const r = this.panel.getBoundingClientRect()
      if (event.target === this.panel && (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom)) this.panel.close()
    })
    this.panel.addEventListener('close', () => {
      if (this.panel.open) return
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
        else this.error('Este dispositivo no permite cambiar la orientación desde la app.')
      } catch { this.error('Gira el dispositivo para cambiar la orientación.') }
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
    document.getElementById('reader-toc-shortcut').onclick = () => { this.show('navigation'); this.showPlaceTab('toc') }
    document.getElementById('reader-more-shortcut').onclick = () => this.show('more')
    this.panel.querySelector('[data-search-form]').onsubmit = event => { event.preventDefault(); this.search(this.panel.querySelector('[data-search-query]').value) }
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
    this.populateVoices()
    const resize = () => {
      if (!this.panel.open) return
      const viewport = window.visualViewport
      const visibleHeight = viewport?.height || innerHeight
      const keyboardInset = Math.max(0, innerHeight - visibleHeight - (viewport?.offsetTop || 0))
      this.panel.style.maxHeight = `${Math.min(visibleHeight - 16, innerHeight * .82)}px`
      this.panel.style.bottom = `${keyboardInset || (innerWidth >= 760 ? 82 : 0)}px`
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
    this.resizePanel = resize
  }
  async open(record) {
    this.book = record
    this.history = cleanPlaces(record.readingHistory)
    this.bookmarks = cleanPlaces(record.bookmarks, 100)
    this.quotes = cleanQuotes(record.quotes)
    this.panel.querySelector('#reading-book-title').textContent = record.title
    document.getElementById('reader-top-title').textContent = record.title
    document.getElementById('reader-top-byline').textContent = record.author || record.metadata?.creator || ''
    this.panel.querySelector('#reading-document-about').textContent = `${record.title}${record.author || record.metadata?.creator ? ` · ${record.author || record.metadata.creator}` : ''}\n${record.format || 'Documento'} · ${this.formatSize(record.sizeBytes)}`
    const pdf = this.reader.format?.engine === 'pdf'
    for (const element of this.panel.querySelectorAll('[data-pdf]')) element.hidden = !pdf
    this.panel.querySelector('[data-epub]').hidden = pdf
    this.panel.querySelector('input[type="number"]').max = String(this.reader.pageCount || 1)
    this.renderPlaces(); this.renderToc(); await this.applyPreferences(); this.relocate()
    for (const quote of this.quotes) this.reader.addQuoteAnnotation(quote)
  }
  reset() { this.voice.stop(); this.panel.close(); this.book = null; this.returnButton.hidden = true; this.screen.classList.remove('reader-kids-mode'); this.panel.querySelector('[data-kids]').setAttribute('aria-pressed','false') }
  relocate() {
    this.location = {...clonePlace(this.reader.location),section:this.reader.location.section || '',page:this.reader.location.page || ''}
    const label = this.label(this.location)
    this.locationButton.querySelector('.reader-location-label').textContent = label
    this.locationButton.setAttribute('aria-label', `Progreso y capítulos, ${label}`)
    this.panel.querySelector('.reading-position').textContent = label
    const range = this.panel.querySelector('[data-progress]')
    if (document.activeElement !== range) range.value = String(this.location.fraction * 100)
    const page = this.panel.querySelector('input[type="number"]')
    if (document.activeElement !== page && this.location.locator?.kind === 'pdf-page') page.value = String(this.location.locator.value)
    this.updateBookmarkButton()
  }
  label(place) { return place.locator?.kind === 'pdf-page' ? `Página ${place.locator.value}${this.reader.pageCount ? ` de ${this.reader.pageCount}` : ''}` : place.section ? `${place.section}${place.page ? ` · Página ${place.page}` : ''}` : `${Math.round(place.fraction * 100)} % del libro` }
  show(tab) {
    this.showTab(tab)
    if (!this.panel.open) this.panel.showModal()
    this.updateMiniPlayer(); this.resizePanel()
    this.panel.querySelector('[data-close]').focus({preventScroll:true})
  }
  showTab(name) {
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
    this.miniPlayer.querySelector('[data-mini-title]').textContent = this.book?.title || ''
    this.miniPlayer.querySelector('[data-mini-status]').textContent = message || `${state === 'paused' ? 'En pausa' : state === 'loading' ? 'Preparando…' : 'Escuchando'} · ${this.preferences.rate}×`
    const play = this.miniPlayer.querySelector('[data-mini-play]')
    play.innerHTML = readerIcon(state === 'playing' ? 'pause' : 'play')
    play.setAttribute('aria-label',state === 'playing' ? 'Pausar lectura' : 'Continuar lectura')
    play.disabled = state === 'loading'
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
  setPreference(key, value) {
    const audio = ['rate','voice','footnotes','multilingual','skipHeaders'].includes(key)
    if (!audio) this.voice.stop()
    this.preferences = normalizeReadingPreferences({ ...this.preferences, [key]:value }); this.applyPreferences(!audio)
    this.voice.options = {footnotes:this.preferences.footnotes,multilingual:this.preferences.multilingual,skipHeaders:this.preferences.skipHeaders}
  }
  async applyPreferences(updateBook = true) {
    const p = this.preferences
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(p)) } catch { /* reading still works without storage */ }
    this.screen.dataset.readingTheme = p.theme
    this.screen.style.setProperty('--reader-brightness',`${p.brightness}%`)
    for (const surface of [this.screen,this.screen.parentElement,this.panel]) {
      surface.style.setProperty('--reading-paper', READING_THEMES[p.theme].background)
      surface.style.setProperty('--reading-ink', READING_THEMES[p.theme].color)
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
    this.voice.options = {footnotes:p.footnotes,multilingual:p.multilingual,skipHeaders:p.skipHeaders}
    this.updateMiniPlayer()
    try { if (updateBook) await this.reader.applyPreferences(p) } catch { this.error('No se pudo aplicar este ajuste. Inténtalo de nuevo.') }
  }
  populateVoices() {
    const select = this.panel.querySelector('[data-pref="voice"]')
    select.replaceChildren(new Option('Automática', ''))
    let voices = window.speechSynthesis?.getVoices() || []
    try { if (this.voice.native) voices = JSON.parse(window.InhouseSpeech.getVoices()) } catch { /* default system voice */ }
    for (const voice of voices) select.add(new Option(`${voice.name} · ${voice.lang}`, voice.voiceURI))
    select.value = this.preferences.voice
  }
  error(message) { this.panel.querySelector('.reading-error').textContent = message }
  async savePlaces() {
    if (!this.book) return
    try { await this.persist(this.book.id, { readingHistory:cleanPlaces(this.history), bookmarks:cleanPlaces(this.bookmarks, 100), quotes:cleanQuotes(this.quotes) }) }
    catch { this.error('No se pudieron guardar los marcadores. Comprueba el espacio del dispositivo.') }
  }
  async jump(place, target) {
    if (!this.book || this.navigating) return
    this.navigating = true; this.voice.stop(); this.error('')
    const origin = { ...clonePlace(this.location), label:this.label(this.location), createdAt:Date.now() }
    this.history = [origin, ...this.history].slice(0,20)
    await this.savePlaces(); this.renderPlaces()
    try {
      if (target !== undefined) await this.reader.goToTarget(target)
      else await this.reader.goToLocator(place.locator, place.fraction)
      this.relocate(); this.panel.close()
    } catch { this.error('No se pudo abrir esa posición del libro.') }
    finally { this.navigating = false }
  }
  async returnToReading(index = 0) {
    if (this.navigating || !this.history[index]) return
    this.navigating = true; this.voice.stop()
    try {
      const place = this.history[index]
      await this.reader.goToLocator(place.locator, place.fraction)
      this.history.splice(index,1); await this.savePlaces(); this.relocate(); this.renderPlaces(); this.panel.close()
    } catch { this.error('No se pudo volver a ese punto de lectura.') }
    finally { this.navigating = false }
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
    if (!text) { this.error('Selecciona primero un fragmento del texto del libro.'); return }
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
      status.textContent = results.length ? `${results.length} resultados` : 'No se encontraron coincidencias.'
      for (const result of results) {
        const button = document.createElement('button'); button.type = 'button'; button.textContent = `${result.label}${result.excerpt ? ` · ${result.excerpt}` : ''}`
        button.onclick = () => this.jump({fraction:result.fraction ?? this.location.fraction,locator:result.locator})
        list.append(button)
      }
    } catch { status.textContent = 'No se pudo buscar en este documento.' }
  }
  async shareBook() {
    const content = this.book?.content
    if (!content) { this.error('El archivo original no está disponible en este dispositivo.'); return }
    const file = new File([content],this.book.fileName || `${this.book.title}.${String(this.book.format||'pdf').toLowerCase()}`,{type:this.book.mimeType || content.type || 'application/octet-stream'})
    try {
      if (navigator.canShare?.({files:[file]}) && navigator.share) await navigator.share({title:this.book.title,files:[file]})
      else { const url = URL.createObjectURL(file), link = document.createElement('a'); link.href=url; link.download=file.name; link.click(); setTimeout(()=>URL.revokeObjectURL(url),30000) }
      this.panel.close()
    } catch (error) { if (error.name !== 'AbortError') this.error('No se pudo compartir el archivo.') }
  }
  formatSize(bytes = 0) { return bytes >= 1048576 ? `${(bytes/1048576).toFixed(1)} MB` : `${Math.max(1,Math.round(bytes/1024))} KB` }
  renderPlaces() {
    this.updateBookmarkButton()
    this.returnButton.hidden = !this.history.length
    this.returnButton.textContent = this.history.length ? `↶ Volver a ${this.history[0].label || this.label(this.history[0])}` : ''
    for (const [name, places] of [['history',this.history],['bookmarks',this.bookmarks],['quotes',this.quotes]]) {
      const list = this.panel.querySelector(`[data-${name}]`)
      list.replaceChildren()
      if (!places.length) { const empty = document.createElement('p'); empty.className = 'reading-hint'; empty.textContent = name === 'history' ? 'Todavía no has saltado a otra parte.' : name === 'quotes' ? 'Aún no has guardado citas.' : 'Guarda aquí las páginas que quieras recuperar.'; list.append(empty) }
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
  step(direction) { this.voice.stop(); return direction > 0 ? this.reader.next() : this.reader.prev() }
}
