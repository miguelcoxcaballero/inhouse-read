import {neuralEngine,neuralVoiceList} from '../../../src/js/readers/neural-runtime.js'
import {languageName,orderNeuralVoices} from '../../../src/js/readers/voice-catalog.js'
export const WARNINGS = {
  'not-installed':'La voz natural seleccionada no está instalada. Descárgala de nuevo.',
  default:'No se pudo iniciar la voz natural. Pulsa Reintentar para volver a usarla.'
}
export class LegacyPickerRender {
patchProgress(engine) {
    const list = neuralVoiceList(engine)
    if (this.block.hidden || !list.length) return false
    for (const item of this.block.querySelectorAll('[data-neural-voice]')) {
      const voice = list.find(candidate => candidate.id === item.dataset.neuralVoice)
      if (!voice) return false
      const { name, download } = this.state(engine, voice)
      if (name !== item.dataset.state) return false
      if (name === 'downloading') { const wrap = item.querySelector('.reading-neural-progress'); if (!wrap) return false; this.view.paintProgress(wrap, download, voice) }
    }
    const offered = this.offerFor(engine, list)
    if ((offered?.id || '') !== (this.offer.dataset.voice || '')) return false
    if (offered) {
      const { name, download } = this.state(engine, offered)
      if (name !== this.offer.dataset.state) return false
      if (name === 'downloading') { const wrap = this.offer.querySelector('.reading-neural-progress'); if (!wrap) return false; this.view.paintProgress(wrap, download, offered) }
    }
    return true
  }
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
row(engine, voice) {
    const expansion = Boolean(voice.sharedPack && voice.upgradeBytes > 0 && [...engine.installed].some(id=>id.startsWith(voice.modelKey+':')))
    const size = expansion ? Math.round(voice.upgradeBytes/1e6) : Math.round(voice.sizeMB)
    const license = voice.licenseUrl ? new URL(voice.licenseUrl, new URL(import.meta.env?.BASE_URL || '/', location.href)).href : ''
    return this.view.row(voice,this.state(engine,voice),this.host.preferences.voice === voice.id,expansion,languageName(voice.lang),size,license)
  }
}
