import {neuralEngine,neuralVoiceList} from '../../../src/js/readers/neural-runtime.js'
import {nativeAudio} from '../../../src/js/readers/neural-voice/audio.js'
import {langBase,isNeuralId} from '../../../src/js/readers/voice-catalog.js'
const NEURAL_WAIT_MS=900,NEURAL_RETRIES=3
const NEURAL_ERRORS={'not-installed':'La voz natural seleccionada no está instalada. Descárgala de nuevo.',default:'No se pudo iniciar la voz natural. Pulsa Reintentar para volver a usarla.'}
export class LegacyDispatch {
  speakCurrent() {
    if (this.state !== 'playing') return
    const current = this.items[this.index]
    if (this.needsPageJoin(current,this.index) && !current.joinChecked) {
      this.prepareAhead()
      if (this.aheadPage?.promise) {
        const generation = this.generation, index = this.index
        void this.aheadPage.promise.then(() => {
          if (generation !== this.generation || this.state !== 'playing' || index !== this.index) return
          this.joinPageSentence()
          this.items[index].joinChecked = true
          this.speakCurrent()
        })
        return
      }
      current.joinChecked = true
    }
    const id = `${this.generation}-${this.index}-${Date.now()}-${this.spoken = (this.spoken || 0) + 1}`
    this.utteranceId = id
    const text = this.chunks[this.index]
    const { language, voice } = this.voiceFor(text)
    this.spokenWith = voice
    if (voice?.neural) { this.speakNeural(id, text, voice); return }
    this.neuralOff = 'not-installed'
    const available = neuralVoiceList().some(candidate => candidate.base === langBase(language))
    this.fail(this.voice && isNeuralId(this.voice) ? NEURAL_ERRORS['not-installed'] : available
      ? 'Descarga una voz natural para este idioma.' : 'No hay voz natural para este idioma. Elige uno de los idiomas disponibles.')
  }
  speakNeural(id, text, voice) {
    const engine = neuralEngine()
    if (!engine) { this.neuralOff = 'init-failed'; this.fail(NEURAL_ERRORS.default); return false }
    clearTimeout(this.presentTimer)
    this.useTransport('neural')
    const { upcoming, deferAfter } = this.upcomingFor(voice)
    clearTimeout(this.waitTimer)
    this.waitTimer = setTimeout(() => { if (id === this.utteranceId && this.state === 'playing' && this.startedId !== id && !this.waiting) { this.waiting = true; this.notify('Preparando la voz natural…') } }, NEURAL_WAIT_MS)
    try {
      const marks = this.items[this.index]?.marks?.map(mark => mark.offset) || []
      engine.speak({ text, voiceId:voice.id, rate:this.rate, id, upcoming, deferAfter, ...(marks.length ? {marks} : {}) })
      this.nativeSession = nativeAudio()?.session || this.nativeSession
    } catch { queueMicrotask(() => this.engineFailed({ id, reason:'synth-failed' })) }
    return true
  }
  engineFailed(detail) {
    if (detail.id !== this.utteranceId || this.state !== 'playing' || this.transport !== 'neural') return
    const reason = detail.reason
    clearTimeout(this.waitTimer); this.waiting = false
    try { neuralEngine()?.stop() } catch { /* already stopped */ }
    if ((reason === 'synth-failed' || reason === 'init-failed') && this.neuralRetries < NEURAL_RETRIES) {
      // The engine already dropped its dead worker: speaking the same fragment again starts a fresh one.
      this.neuralRetries++; this.waiting = true
      this.notify('Reiniciando la voz natural…')
      this.speakCurrent()
      return
    }
    this.neuralOff = reason || 'synth-failed'
    if (reason === 'not-installed') { this.missing.add(this.spokenWith?.id); Promise.resolve(neuralEngine()?.refresh?.()).catch(() => {}) }
    this.pause()
    this.notify(NEURAL_ERRORS[reason] || NEURAL_ERRORS.default)
  }
  voiceRemoved(id) {
    this.missing.add(id)
    if (this.state === 'playing' && this.spokenWith?.id === id) { this.pause(); this.notify('Voz natural quitada. Elige otra voz natural para continuar.') }
  }
  setSleep(minutes) {
    clearTimeout(this.sleepTimer)
    if (minutes > 0) this.sleepTimer = setTimeout(() => { this.stop(); this.notify('Temporizador terminado.') }, minutes * 60000)
  }}
