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
    this.panel.setAttribute('aria-label', 'Opciones de lectura')
    this.panel.innerHTML = `
      <header class="reading-panel__header"><div><p id="reading-book-title"></p><h2>Tu lectura</h2></div><button type="button" class="icon-btn" data-close aria-label="Cerrar opciones de lectura">×</button></header>
      <nav class="reading-tabs" role="tablist" aria-label="Opciones del lector">
        <button type="button" id="reading-tab-appearance" role="tab" aria-controls="reading-appearance" data-tab="appearance">Aspecto</button>
        <button type="button" id="reading-tab-navigation" role="tab" aria-controls="reading-navigation" data-tab="navigation">Navegar</button>
        <button type="button" id="reading-tab-audio" role="tab" aria-controls="reading-audio" data-tab="audio">Escuchar</button>
      </nav>
      <section id="reading-appearance" role="tabpanel" aria-labelledby="reading-tab-appearance">
        <fieldset class="reading-themes"><legend>Color de lectura</legend>
          <button type="button" data-theme="paper">Papel</button><button type="button" data-theme="sepia">Sepia</button><button type="button" data-theme="night">Noche</button><button type="button" data-theme="sage">Salvia</button>
        </fieldset>
        <label class="reading-field" data-pdf>Vista del PDF<select data-pref="pdfMode" aria-label="Vista del PDF"><option value="original">Página original</option><option value="text">Texto adaptable</option></select></label>
        <p class="reading-hint" data-pdf-hint>Para cambiar la letra de un PDF, elige Texto adaptable. Las imágenes y la maquetación se conservan en Página original.</p>
        <label class="reading-field" data-pdf-zoom>Zoom del PDF <span><input type="range" data-pref="zoom" min="70" max="200" step="10" aria-label="Zoom del PDF"><output data-output="zoom"></output></span></label>
        <div data-typography>
          <label class="reading-field">Tipografía<select data-pref="font" aria-label="Tipografía de lectura"><option value="book">Literaria · Georgia</option><option value="classic">Clásica · Palatino</option><option value="sans">Sencilla · Sans serif</option><option value="mono">Monoespaciada</option></select></label>
          <label class="reading-field">Tamaño de letra<span><input type="range" data-pref="fontSize" min="14" max="36" step="1" aria-label="Tamaño de letra"><output data-output="fontSize"></output></span></label>
          <label class="reading-field">Interlineado<span><input type="range" data-pref="lineHeight" min="1.2" max="2.4" step="0.1" aria-label="Interlineado"><output data-output="lineHeight"></output></span></label>
          <label class="reading-field">Márgenes<span><input type="range" data-pref="margin" min="8" max="64" step="4" aria-label="Márgenes"><output data-output="margin"></output></span></label>
          <label class="reading-field">Alineación<select data-pref="align" aria-label="Alineación"><option value="start">Natural</option><option value="justify">Justificada</option></select></label>
        </div>
        <label class="reading-field" data-epub>Pasar el texto<select data-pref="flow" aria-label="Modo de desplazamiento"><option value="paginated">Por páginas</option><option value="scrolled">Desplazamiento continuo</option></select></label>
        <button type="button" class="reading-text-button" data-reset>Restablecer aspecto</button>
      </section>
      <section id="reading-navigation" role="tabpanel" aria-labelledby="reading-tab-navigation" hidden>
        <p class="reading-position" aria-live="polite"></p>
        <label class="reading-field">Progreso del libro<input type="range" min="0" max="100" step="0.1" data-progress aria-label="Progreso del libro"></label>
        <form class="reading-page-form" data-pdf><label>Ir a la página<input type="number" min="1" step="1" inputmode="numeric" aria-label="Ir a la página" required></label><button type="submit" class="reading-primary">Ir</button></form>
        <div class="reading-section" data-toc-section><h3>Capítulos</h3><div data-toc class="reading-list"></div></div>
        <div class="reading-section"><div class="reading-section__heading"><h3>Marcadores</h3><button type="button" class="reading-text-button" data-bookmark>Marcar esta página</button></div><div data-bookmarks class="reading-list"></div></div>
        <div class="reading-section"><h3>Antes de saltar</h3><p class="reading-hint">Tu punto de lectura se guarda aquí cuando saltas a otra parte del libro.</p><div data-history class="reading-list"></div></div>
      </section>
      <section id="reading-audio" role="tabpanel" aria-labelledby="reading-tab-audio" hidden>
        <h3 class="reading-audio-title">Escucha tu libro</h3><p class="reading-hint">Lectura en voz alta desde la página actual. Continúa a la siguiente página automáticamente.</p>
        <div class="reading-audio-controls"><button type="button" class="reading-primary" data-play>Reproducir</button><button type="button" class="reading-secondary" data-stop>Detener</button></div>
        <p class="reading-audio-status" role="status"></p>
        <label class="reading-field">Velocidad<span><input type="range" data-pref="rate" min="0.5" max="2" step="0.1" aria-label="Velocidad de voz"><output data-output="rate"></output></span></label>
        <label class="reading-field">Voz<select data-pref="voice" aria-label="Voz de lectura"><option value="">Automática · idioma del libro</option></select></label>
        <label class="reading-field">Temporizador<select data-sleep aria-label="Temporizador de voz"><option value="0">Sin temporizador</option><option value="15">15 minutos</option><option value="30">30 minutos</option><option value="60">1 hora</option></select></label>
      </section>
      <p class="reading-error" role="status"></p>`
    document.body.append(this.panel)
    this.voice = new ReadingVoice(reader, (state, message) => {
      this.panel.querySelector('[data-play]').textContent = state === 'playing' ? 'Pausar' : state === 'paused' ? 'Continuar' : state === 'loading' ? 'Preparando…' : 'Reproducir'
      this.panel.querySelector('[data-play]').disabled = state === 'loading'
      this.panel.querySelector('.reading-audio-status').textContent = message || (state === 'playing' ? 'Leyendo en voz alta' : state === 'paused' ? 'En pausa' : 'Lista para escuchar')
      document.getElementById('reader-audio').classList.toggle('is-playing', state === 'playing')
      if (state === 'stopped') this.panel.querySelector('[data-sleep]').value = '0'
    })
    this.panel.querySelector('[data-close]').onclick = () => this.panel.close()
    this.panel.addEventListener('click', event => { if (event.target === this.panel && event.offsetY < 0) this.panel.close() })
    for (const tab of this.panel.querySelectorAll('[data-tab]')) {
      tab.onclick = () => this.showTab(tab.dataset.tab)
      tab.onkeydown = event => {
        if (!['ArrowLeft','ArrowRight'].includes(event.key)) return
        const tabs = [...this.panel.querySelectorAll('[data-tab]')]
        const next = tabs[(tabs.indexOf(tab) + (event.key === 'ArrowRight' ? 1 : 2)) % 3]
        next.click(); next.focus(); event.preventDefault()
      }
    }
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
      this.panel.style.maxHeight = `${(viewport?.height || innerHeight) - 16}px`
      this.panel.style.bottom = `${Math.max(0, innerHeight - (viewport?.height || innerHeight) - (viewport?.offsetTop || 0))}px`
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
    if (document.activeElement !== page) page.value = String(this.location.locator?.value || 1)
  }
  label(place) { return place.locator?.kind === 'pdf-page' ? `Página ${place.locator.value}${this.reader.pageCount ? ` de ${this.reader.pageCount}` : ''}` : `${Math.round(place.fraction * 100)} % del libro` }
  show(tab) { this.showTab(tab); if (!this.panel.open) this.panel.showModal(); this.resizePanel() }
  showTab(name) {
    for (const button of this.panel.querySelectorAll('[data-tab]')) {
      const selected = button.dataset.tab === name
      button.setAttribute('aria-selected', String(selected)); button.tabIndex = selected ? 0 : -1
      this.panel.querySelector(`#reading-${button.dataset.tab}`).hidden = !selected
    }
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
    this.screen.style.setProperty('--reading-paper', READING_THEMES[p.theme].background)
    this.screen.style.setProperty('--reading-ink', READING_THEMES[p.theme].color)
    for (const field of this.panel.querySelectorAll('[data-pref]')) field.value = String(p[field.dataset.pref])
    for (const output of this.panel.querySelectorAll('[data-output]')) output.textContent = `${p[output.dataset.output]}${output.dataset.output === 'rate' ? '×' : output.dataset.output === 'zoom' ? '%' : ['fontSize','margin'].includes(output.dataset.output) ? ' px' : ''}`
    for (const button of this.panel.querySelectorAll('[data-theme]')) button.setAttribute('aria-pressed', String(button.dataset.theme === p.theme))
    const originalPdf = this.reader.format?.engine === 'pdf' && p.pdfMode === 'original'
    this.panel.querySelector('[data-typography]').hidden = originalPdf
    this.panel.querySelector('[data-pdf-hint]').hidden = !originalPdf
    this.panel.querySelector('[data-pdf-zoom]').hidden = !originalPdf
    this.voice.rate = p.rate; this.voice.voice = p.voice
    try { if (updateBook) await this.reader.applyPreferences(p) } catch { this.error('No se pudo aplicar este ajuste. Inténtalo de nuevo.') }
  }
  populateVoices() {
    const select = this.panel.querySelector('[data-pref="voice"]')
    select.replaceChildren(new Option('Automática · idioma del libro', ''))
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
    if (!duplicate) this.bookmarks.unshift({ ...clonePlace(this.location), label:this.label(this.location), createdAt:Date.now() })
    this.bookmarks = this.bookmarks.slice(0,100)
    await this.savePlaces(); this.renderPlaces()
  }
  renderPlaces() {
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
        const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = '×'; remove.setAttribute('aria-label', `Eliminar ${place.label || this.label(place)}`)
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
    this.panel.querySelector('[data-toc-section]').hidden = !list.childElementCount
  }
  step(direction) { this.voice.stop(); return direction > 0 ? this.reader.next() : this.reader.prev() }
}
