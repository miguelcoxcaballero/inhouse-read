import {loadNeural,neuralEngine,unlockNeural} from './neural-runtime.js'
import {nativeAudio} from './neural-voice/audio.js'
const NEURAL_ERRORS={default:'No se pudo iniciar la voz natural. Pulsa Reintentar para volver a usarla.'}
export class LegacyVoiceStart{
  restartFromVisiblePage() {
    const saved = this.state === 'paused' ? this.pausedLocation : this.stoppedLocation
    return ['paused','stopped'].includes(this.state) && (this.browsing || saved !== undefined && saved !== JSON.stringify(this.reader.location))
  }
  async play() {
    if (this.state === 'playing' || this.state === 'loading') return
    this.retryNeural()
    // Retire the old reading position BEFORE opening Android's foreground
    // session. Starting then stopping it here can race onStartCommand and
    // Android kills the entire app with ForegroundServiceDidNotStartInTime.
    if (this.restartFromVisiblePage()) { this.stop(); this.completeOpening = true }
    unlockNeural() // still synchronous inside the tap, before the first await
    this.nativeSession = nativeAudio()?.session || null
    if (this.state === 'paused' && this.chunks.length && !this.resumeNextPage) {
      this.state = 'playing'; this.waiting = true; this.notify('Preparando la voz natural…'); this.speakCurrent(); return
    }
    const generation = ++this.generation
    this.state = 'loading'; this.notify('Preparando la voz natural…')
    try {
      await loadNeural()
      if (generation !== this.generation) return
      const engine = neuralEngine()
      if (!engine) return this.fail('Este dispositivo no puede reproducir voces naturales.')
      try { await engine.refresh?.() } catch {
        if (generation !== this.generation) return
        this.neuralOff = 'init-failed'; return this.fail(NEURAL_ERRORS.default)
      }
      if (generation !== this.generation) return
      const next = this.resumeNextPage ? await this.prepareNext(generation) : undefined
      if (generation !== this.generation) return
      if (next === null) { this.stop(); this.notify('Final del libro.'); return }
      const plan = next || await this.prepareOpening()
      this.openingPlan = null
      if (generation !== this.generation) return
      this.adopt(plan)
      const completeOpening = this.completeOpening
      this.completeOpening = false
      this.resumeNextPage = false
      if (!this.chunks.length && completeOpening && plan.source?.text?.trim()) return this.fail('No empieza ninguna frase completa en esta página. Cambia de página para continuar.')
      if (!this.chunks.length) return this.fail('Esta página no contiene texto legible. Los PDF escaneados necesitan reconocimiento de texto para escucharlos.')
      this.state = 'playing'; this.waiting = true; this.notify('Preparando la voz natural…'); this.speakCurrent()
    } catch { if (generation === this.generation) this.fail('No se pudo preparar el texto.') }
  }
}
