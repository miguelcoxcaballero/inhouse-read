import {normalizeReadingPreferences} from './reading-preferences.js'
export class LegacyReaderControls {
 constructor(host){
  function bind(){const reader=this.reader;
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

  }
  bind.call(host)
 }
}
