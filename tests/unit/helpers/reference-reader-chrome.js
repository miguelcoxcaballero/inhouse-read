export class LegacyReaderChrome{
 create(panelMarkup,miniMarkup,onReturn){
    this.screen = document.getElementById('reader-screen')
    this.toolbar = document.getElementById('reader-toolbar')
    this.locationButton = document.getElementById('reader-location')
    this.returnButton = document.createElement('button')
    this.returnButton.type = 'button'
    this.returnButton.className = 'reader-return'
    this.returnButton.hidden = true
    this.returnButton.addEventListener('click', onReturn)
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
    this.panel.innerHTML = panelMarkup
    this.panel.setAttribute('aria-labelledby', 'reading-panel-title')
    this.miniPlayer = document.createElement('div')
    this.miniPlayer.className = 'reading-mini-player'; this.miniPlayer.hidden = true
    this.miniPlayer.innerHTML = miniMarkup
    this.audioHost.append(this.miniPlayer)

 }
 voiceState(state,message,readerIcon){
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

 }
 resize(){
      if (!this.panel.open) return
      const viewport = window.visualViewport
      const visibleHeight = viewport?.height || innerHeight
      const keyboardInset = Math.max(0, innerHeight - visibleHeight - (viewport?.offsetTop || 0))
      const anchor = !keyboardInset && innerWidth >= 760 ? this.toolbar.getBoundingClientRect().height + 12 : 0
      this.panel.style.maxHeight = `${Math.max(0, Math.min(visibleHeight - anchor - 16, innerHeight * .82))}px`
      this.panel.style.bottom = `${keyboardInset + anchor}px`
return true
 }
 revealField(){

        const active = document.activeElement
        if (!this.panel.open || !this.panel.contains(active) || !active.matches('input,select')) return
        const field = active.getBoundingClientRect(), panel = this.panel.getBoundingClientRect()
        if (field.bottom > panel.bottom-16) this.panel.scrollTop += field.bottom-panel.bottom+16
        else if (field.top < panel.top+60) this.panel.scrollTop -= panel.top+60-field.top

 }
}
