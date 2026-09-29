import { readerPanelMarkup, readerIcon } from './reader-interface.js'
import { normalizeReadingPreferences, READING_THEMES } from './reading-preferences.js'
import { ReadingVoice } from './reading-voice.js'
import { clonePlace, cleanPlaces } from './reading-state.js'

const STORAGE_KEY = 'inhouse-read-reading-preferences'

export class ReaderExperience {
  constructor(reader, { persist = async () => {} } = {}) {
    this.reader = reader
    this.persist = persist
    this.history = []; this.bookmarks = []; this.location = { fraction:0, locator:null }
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
    this.panel.querySelector('[data-play]').onclick = () => this.voice.state === 'playing' ? this.voice.pause() : this.voice.play()
    this.panel.querySelector('[data-stop]').onclick = () => this.voice.stop()
    this.panel.querySelector('[data-sleep]').onchange = event => this.voice.setSleep(Number(event.target.value))
    document.getElementById('reader-settings').onclick = () => this.show('appearance')
    document.getElementById('reader-audio').onclick = () => this.show('audio')
    this.locationButton.onclick = () => this.show('navigation')
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
    this.panel.querySelector('#reading-book-title').textContent = record.title
    document.getElementById('reader-top-title').textContent = record.title
    const pdf = this.reader.format?.engine === 'pdf'
    for (const element of this.panel.querySelectorAll('[data-pdf]')) element.hidden = !pdf
    this.panel.querySelector('[data-epub]').hidden = pdf
    this.panel.querySelector('input[type="number"]').max = String(this.reader.pageCount || 1)
    this.renderPlaces(); this.renderToc(); await this.applyPreferences(); this.relocate()
  }
  reset() { this.voice.stop(); this.panel.close(); this.book = null; this.returnButton.hidden = true }
  relocate() {
    this.location = clonePlace(this.reader.location)
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
  label(place) { return place.locator?.kind === 'pdf-page' ? `Página ${place.locator.value}${this.reader.pageCount ? ` de ${this.reader.pageCount}` : ''}` : `${Math.round(place.fraction * 100)} % del libro` }
  show(tab) {
    this.showTab(tab)
    if (!this.panel.open) this.panel.showModal()
    this.updateMiniPlayer(); this.resizePanel()
    this.panel.querySelector('[data-close]').focus({preventScroll:true})
  }
  showTab(name) {
    for (const section of ['appearance','navigation','audio']) this.panel.querySelector(`#reading-${section}`).hidden = section !== name
    const title = {appearance:'Texto',navigation:'Contenido',audio:'Escuchar'}[name]
    this.panel.querySelector('#reading-panel-title').textContent = title
    this.panel.dataset.view = name
    this.panel.scrollTop = 0
    for (const [id,tab] of [['reader-settings','appearance'],['reader-location','navigation'],['reader-audio','audio']]) document.getElementById(id).setAttribute('aria-expanded',String(tab === name))
  }
  showPlaceTab(name) {
    this.placeTab = name
    for (const button of this.panel.querySelectorAll('[data-place-tab]')) {
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
  }
  setPreference(key, value) {
    const audio = ['rate','voice'].includes(key)
    if (!audio) this.voice.stop()
    this.preferences = normalizeReadingPreferences({ ...this.preferences, [key]:value }); this.applyPreferences(!audio)
  }
  async applyPreferences(updateBook = true) {
    const p = this.preferences
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(p)) } catch { /* reading still works without storage */ }
    this.screen.dataset.readingTheme = p.theme
    for (const surface of [this.screen,this.screen.parentElement,this.panel]) {
      surface.style.setProperty('--reading-paper', READING_THEMES[p.theme].background)
      surface.style.setProperty('--reading-ink', READING_THEMES[p.theme].color)
    }
    this.panel.querySelector('[data-size-step="-1"]').disabled = p.fontSize <= 14
    this.panel.querySelector('[data-size-step="1"]').disabled = p.fontSize >= 36
    for (const field of this.panel.querySelectorAll('[data-pref]')) field.value = String(p[field.dataset.pref])
    for (const output of this.panel.querySelectorAll('[data-output]')) output.textContent = `${p[output.dataset.output]}${output.dataset.output === 'rate' ? '×' : output.dataset.output === 'zoom' ? '%' : ['fontSize','margin'].includes(output.dataset.output) ? ' px' : ''}`
    for (const button of this.panel.querySelectorAll('[data-theme]')) button.setAttribute('aria-pressed', String(button.dataset.theme === p.theme))
    const originalPdf = this.reader.format?.engine === 'pdf' && p.pdfMode === 'original'
    this.panel.querySelector('[data-typography]').hidden = originalPdf
    this.panel.querySelector('[data-pdf-hint]').hidden = !originalPdf
    this.panel.querySelector('[data-pdf-zoom]').hidden = !originalPdf
    this.voice.rate = p.rate; this.voice.voice = p.voice
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
    try { await this.persist(this.book.id, { readingHistory:cleanPlaces(this.history), bookmarks:cleanPlaces(this.bookmarks, 100) }) }
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
  renderPlaces() {
    this.updateBookmarkButton()
    this.returnButton.hidden = !this.history.length
    this.returnButton.textContent = this.history.length ? `↶ Volver a ${this.history[0].label || this.label(this.history[0])}` : ''
    for (const [name, places] of [['history',this.history],['bookmarks',this.bookmarks]]) {
      const list = this.panel.querySelector(`[data-${name}]`)
      list.replaceChildren()
      if (!places.length) { const empty = document.createElement('p'); empty.className = 'reading-hint'; empty.textContent = name === 'history' ? 'Todavía no has saltado a otra parte.' : 'Guarda aquí las páginas que quieras recuperar.'; list.append(empty) }
      places.forEach((place,index) => {
        const row = document.createElement('div'); row.className = 'reading-place'
        const button = document.createElement('button'); button.type = 'button'; button.textContent = place.label || this.label(place)
        button.onclick = () => name === 'history' ? this.returnToReading(index) : this.jump(place)
        const remove = document.createElement('button'); remove.type = 'button'; remove.innerHTML = readerIcon('close'); remove.setAttribute('aria-label', `Eliminar ${place.label || this.label(place)}`)
        remove.onclick = async () => { places.splice(index,1); await this.savePlaces(); this.renderPlaces() }
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
