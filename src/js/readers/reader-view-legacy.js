export class LegacyReaderView {
 constructor(screen,panel,mini,return_button){this.screen=screen;this.panel=panel;this.miniPlayer=mini;this.returnButton=return_button}
 setDocumentInfo(title,author,about,updateMini){
  this.panel.querySelector('#reading-book-title').textContent=title
  document.getElementById('reader-top-title').textContent=title
  document.getElementById('reader-top-byline').textContent=author
  this.panel.querySelector('#reading-document-about').textContent=about
  if(updateMini){const mini=this.miniPlayer?.querySelector('[data-mini-title]');if(mini)mini.textContent=title}
 }
 configureFormat(pdf,pageCount){
  for(const element of this.panel.querySelectorAll('[data-pdf]'))element.hidden=!pdf
  this.panel.querySelector('[data-epub]').hidden=pdf
  this.panel.querySelector('input[type="number"]').max=String(pageCount)
 }
 relocate(label,compact,progress,pdf,pageValue){
  const button=document.getElementById('reader-location')
  button.querySelector('.reader-location-label').textContent=compact
  button.setAttribute('aria-label',`Progreso y capítulos, ${label}`);button.title=label
  this.panel.querySelector('.reading-position').textContent=label
  this.panel.querySelector('[data-audio-where]').textContent=label
  const range=this.panel.querySelector('[data-progress]')
  if(document.activeElement!==range)range.value=String(progress)
  const page=this.panel.querySelector('input[type="number"]')
  if(document.activeElement!==page&&pdf)page.value=String(pageValue)
 }
 endSearch(){}
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
  syncMiniPlayerLayout() {
    const height = this.miniPlayer.hidden ? 0 : Math.ceil(this.miniPlayer.getBoundingClientRect().height)
    this.screen.style.setProperty('--reader-audio-height', `${height}px`)
  }
  syncReturnLayout() {
    const height = this.returnButton.hidden ? 0 : Math.ceil(this.returnButton.getBoundingClientRect().height)
    this.screen.style.setProperty('--reader-return-height', `${height}px`)
  }
  setSleepChoice(minutes) {
    for (const chip of this.panel.querySelectorAll('[data-sleep-value]')) chip.setAttribute('aria-checked', String(Number(chip.dataset.sleepValue) === minutes))
  }
  applyPreferences(p,theme,pdf) {
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
    for (const radio of this.panel.querySelectorAll('[data-rate]')) radio.checked = Number(radio.value) === p.rate
    for (const field of this.panel.querySelectorAll('[data-voice-option]')) field.checked = Boolean(p[field.dataset.voiceOption])
    for (const output of this.panel.querySelectorAll('[data-output]')) output.textContent = `${p[output.dataset.output]}${output.dataset.output === 'rate' ? '×' : ['zoom','brightness'].includes(output.dataset.output) ? '%' : ['fontSize','margin'].includes(output.dataset.output) ? ' px' : ''}`
    for (const button of this.panel.querySelectorAll('[data-theme]')) button.setAttribute('aria-pressed', String(button.dataset.theme === p.theme))
    const originalPdf = pdf && p.pdfMode === 'original'
    this.panel.querySelector('[data-typography]').hidden = originalPdf
    this.panel.querySelector('[data-pdf-hint]').hidden = !originalPdf
    this.panel.querySelector('[data-pdf-zoom]').hidden = !originalPdf
  }
  updateBookmarkButton(marked) {
    const button = this.panel.querySelector('[data-bookmark]')
    button.setAttribute('aria-pressed',String(marked))
    button.setAttribute('aria-label',marked ? 'Quitar marcador de esta página' : 'Marcar esta página')
    button.title = button.getAttribute('aria-label')
    const quick = document.getElementById('reader-save-bookmark')
    quick.setAttribute('aria-pressed',String(marked)); quick.setAttribute('aria-label',marked ? 'Quitar marcador rápido' : 'Guardar marcador rápido')
  }
  updateMiniPlayer(state,message,title,rate_label,has_book,icon) {
    const active = has_book && ['playing','paused','loading'].includes(state)
    this.screen.classList.toggle('has-reading-audio', active)
    this.miniPlayer.hidden = !active || this.panel.open
    this.screen.classList.toggle('has-reading-mini-player', !this.miniPlayer.hidden)
    this.miniPlayer.querySelector('[data-mini-title]').textContent = title
    this.miniPlayer.querySelector('[data-mini-status]').textContent = message || `${state === 'paused' ? 'En pausa' : state === 'loading' ? 'Preparando…' : 'Leyendo'} · ${rate_label}`
    const play = this.miniPlayer.querySelector('[data-mini-play]')
    play.innerHTML = icon
    play.setAttribute('aria-label',state === 'playing' ? 'Pausar lectura' : 'Continuar lectura')
    play.disabled = state === 'loading'
    this.syncMiniPlayerLayout()
  }
  updateReturnButton(audio,history,label) {
    this.returnButton.hidden = !audio && !history
    this.returnButton.textContent = audio ? '↶ Volver al audio' : history ? `↶ Volver a ${label}` : ''
    this.syncReturnLayout()
  }
}
