import { planSpeech, speechChunks } from './speech-text.js'

export { speechChunks }
// Blank or image-only pages passed over, one page turn at a time, before giving up.
const MAX_EMPTY_PAGES = 12

/** One short utterance at a time also avoids Android/browser long-speech timeouts. */
export class ReadingVoice {
  constructor(reader, onState = () => {}) {
    this.reader = reader
    this.onState = onState
    this.state = 'stopped'
    this.generation = 0
    this.index = 0
    this.chunks = []
    this.items = []
    this.source = null
    this.rate = 1
    this.voice = ''
    this.options = {footnotes:false,multilingual:false,skipHeaders:false}
    window.addEventListener('inhouse-tts', event => {
      if (event.detail?.id !== this.utteranceId || this.state !== 'playing') return
      if (event.detail.type === 'done') this.advance()
      if (event.detail.type === 'interrupted') this.pause()
      if (event.detail.type === 'error') this.fail('No hay una voz disponible para este idioma. Revisa las voces instaladas en Android.')
    })
  }
  get native() { return typeof window.InhouseSpeech?.speak === 'function' }
  get supported() { return this.native || Boolean(window.speechSynthesis && window.SpeechSynthesisUtterance) }
  notify(message = '') { this.onState(this.state, message) }
  async play() {
    if (!this.supported) return this.fail('Actualiza la app Android para activar la lectura en voz alta, o utiliza un navegador con síntesis de voz.')
    if (this.state === 'playing' || this.state === 'loading') return
    if (this.state === 'paused' && this.chunks.length) {
      this.state = 'playing'; this.notify(); this.speakCurrent(); return
    }
    const generation = ++this.generation
    this.state = 'loading'; this.notify('Preparando la voz…')
    try {
      const plan = await this.prepare()
      if (generation !== this.generation) return
      this.adopt(plan)
      if (!this.chunks.length) return this.fail('Esta página no contiene texto legible. Los PDF escaneados necesitan reconocimiento de texto para escucharlos.')
      this.state = 'playing'; this.notify(); this.speakCurrent()
    } catch { if (generation === this.generation) this.fail('No se pudo preparar el texto para la lectura en voz alta.') }
  }
  speakCurrent() {
    if (this.state !== 'playing') return
    const id = `${this.generation}-${this.index}-${Date.now()}-${this.spoken = (this.spoken || 0) + 1}`
    this.utteranceId = id
    this.present()
    const text = this.chunks[this.index]
    const language = this.options.multilingual ? this.detectLanguage(text) : this.reader.language || navigator.language || 'es-ES'
    if (this.native) { window.InhouseSpeech.speak(text, language, this.rate, this.options.multilingual ? '' : this.voice, id); return }
    const utterance = new SpeechSynthesisUtterance(text)
    this.utterance = utterance
    utterance.lang = language
    utterance.rate = this.rate
    const voices = speechSynthesis.getVoices()
    utterance.voice = (!this.options.multilingual && voices.find(v => v.voiceURI === this.voice)) || voices.find(v => v.lang.startsWith(language.split('-')[0])) || null
    utterance.onend = () => { if (id === this.utteranceId && this.state === 'playing') this.advance() }
    utterance.onerror = event => { if (id === this.utteranceId && !['canceled','interrupted'].includes(event.error)) this.fail('No se pudo reproducir la voz. Prueba otra voz instalada.') }
    speechSynthesis.speak(utterance)
  }
  async advance() {
    if (this.state !== 'playing') return
    if (++this.index < this.chunks.length) return this.speakCurrent()
    const generation = this.generation
    this.source?.clear?.()
    try {
      for (let blank = 0; blank < MAX_EMPTY_PAGES; blank++) {
        const previous = JSON.stringify(this.reader.location)
        await this.reader.next()
        if (generation !== this.generation || this.state !== 'playing') return
        if (JSON.stringify(this.reader.location) === previous) { this.stop(); this.notify('Has llegado al final.'); return }
        const plan = await this.prepare()
        if (generation !== this.generation || this.state !== 'playing') return
        this.adopt(plan)
        if (this.chunks.length) return this.speakCurrent()
      }
      this.fail('La siguiente página no tiene texto legible. Puedes avanzar y volver a escuchar.')
    } catch { if (generation === this.generation) this.fail('No se pudo continuar en la siguiente página.') }
  }
  /**
   * Text to speak from the visible page on. Readers that can map text back to the
   * page hand over a source (offsets -> DOM) so each sentence can be highlighted
   * and followed; the others keep the plain text path, unhighlighted.
   */
  async prepare() {
    const pending = this.reader.getSpeechSource?.()
    const source = pending ? await pending : null
    if (!source) return { source, items:speechChunks(this.prepareText(await this.reader.getSpeechText())).map(text => ({ text })) }
    const { footnotes, skipHeaders } = this.options
    return { source, items:planSpeech(source.text, { footnotes, skipHeaders }, source.start || 0) }
  }
  adopt({ source, items }) {
    if (this.source && this.source !== source) this.source.clear?.()
    this.source = source; this.items = items; this.chunks = items.map(item => item.text); this.index = 0
  }
  /** Highlights the whole sentence being spoken and lets the reader bring it on screen. Cosmetic: it can never stop the voice. */
  present() {
    const item = this.items[this.index], source = this.source
    if (!source || !item?.sentence) return
    try {
      source.highlight?.(item.sentence.start, item.sentence.end)
      Promise.resolve(source.follow?.(item.start, item.end)).catch(() => {})
    } catch { /* the page may have changed under a paused voice */ }
  }
  /** Re-speaks the current fragment, so a new speed or voice is heard now instead of at the next one. */
  restart() {
    if (this.state !== 'playing' || this.index >= this.chunks.length) return
    this.cancelUtterance(); this.speakCurrent()
  }
  cancelUtterance() {
    this.utteranceId = null
    if (this.native) window.InhouseSpeech.stop()
    else window.speechSynthesis?.cancel()
  }
  prepareText(text) {
    let value = String(text || '')
    if (!this.options.footnotes) value = value.replace(/\[(?:\d{1,3}|[*†‡])\]/g,'').replace(/\(\s*(?:note|nota)\s+\d+\s*\)/gi,'')
    if (this.options.skipHeaders) {
      const lines = value.split(/\n+/)
      const counts = new Map()
      for (const line of lines) { const key=line.trim().toLocaleLowerCase(); if (key.length && key.length<90) counts.set(key,(counts.get(key)||0)+1) }
      value = lines.filter(line => { const key=line.trim().toLocaleLowerCase(); return !(key.length<90 && counts.get(key)>1) }).join(' ')
    }
    return value
  }
  detectLanguage(text) {
    const sample = String(text || '').toLocaleLowerCase()
    if (/[ñ¿¡]|\b(el|la|los|las|que|para|con|una|del)\b/.test(sample)) return 'es-ES'
    if (/[àâçéèêëîïôûùüÿœ]/.test(sample)) return 'fr-FR'
    if (/[äöüß]/.test(sample)) return 'de-DE'
    if (/[ãõ]/.test(sample)) return 'pt-PT'
    return this.reader.language || navigator.language || 'en-US'
  }
  pause() {
    if (this.state !== 'playing') return
    ++this.generation; this.state = 'paused'; this.cancelUtterance(); this.source?.clear?.()
    if (this.index >= this.chunks.length) this.chunks = []
    this.notify()
  }
  stop() {
    ++this.generation; this.state = 'stopped'; this.cancelUtterance(); this.source?.clear?.()
    this.chunks = []; this.items = []; this.source = null; this.index = 0; clearTimeout(this.sleepTimer); this.notify()
  }
  fail(message) { this.stop(); this.notify(message) }
  setSleep(minutes) {
    clearTimeout(this.sleepTimer)
    if (minutes > 0) this.sleepTimer = setTimeout(() => { this.stop(); this.notify('Se ha detenido la voz al terminar el temporizador.') }, minutes * 60000)
  }
}
