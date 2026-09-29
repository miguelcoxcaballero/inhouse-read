export function speechChunks(text) {
  return (String(text || '').replace(/\s+/g, ' ').trim().match(/[^.!?。！？]+[.!?。！？]*\s*/g) || [])
    .flatMap(sentence => sentence.match(/.{1,180}(?:\s|$)|.{1,180}/g) || []).map(x => x.trim()).filter(Boolean)
}

/** One short utterance at a time also avoids Android/browser long-speech timeouts. */
export class ReadingVoice {
  constructor(reader, onState = () => {}) {
    this.reader = reader
    this.onState = onState
    this.state = 'stopped'
    this.generation = 0
    this.index = 0
    this.chunks = []
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
      this.chunks = speechChunks(this.prepareText(await this.reader.getSpeechText()))
      if (generation !== this.generation) return
      this.index = 0
      if (!this.chunks.length) return this.fail('Esta página no contiene texto legible. Los PDF escaneados necesitan reconocimiento de texto para escucharlos.')
      this.state = 'playing'; this.notify(); this.speakCurrent()
    } catch { if (generation === this.generation) this.fail('No se pudo preparar el texto para la lectura en voz alta.') }
  }
  speakCurrent() {
    if (this.state !== 'playing') return
    const id = `${this.generation}-${this.index}-${Date.now()}`
    this.utteranceId = id
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
    const previous = JSON.stringify(this.reader.location)
    try {
      await this.reader.next()
      if (generation !== this.generation || this.state !== 'playing') return
      if (JSON.stringify(this.reader.location) === previous) { this.stop(); this.notify('Has llegado al final.'); return }
      this.chunks = speechChunks(this.prepareText(await this.reader.getSpeechText()))
      if (generation !== this.generation || this.state !== 'playing') return
      this.index = 0
      if (!this.chunks.length) return this.fail('La siguiente página no tiene texto legible. Puedes avanzar y volver a escuchar.')
      this.speakCurrent()
    } catch { if (generation === this.generation) this.fail('No se pudo continuar en la siguiente página.') }
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
    ++this.generation; this.state = 'paused'; this.cancelUtterance()
    if (this.index >= this.chunks.length) this.chunks = []
    this.notify()
  }
  stop() {
    ++this.generation; this.state = 'stopped'; this.cancelUtterance()
    this.chunks = []; this.index = 0; clearTimeout(this.sleepTimer); this.notify()
  }
  fail(message) { this.stop(); this.notify(message) }
  setSleep(minutes) {
    clearTimeout(this.sleepTimer)
    if (minutes > 0) this.sleepTimer = setTimeout(() => { this.stop(); this.notify('Se ha detenido la voz al terminar el temporizador.') }, minutes * 60000)
  }
}
