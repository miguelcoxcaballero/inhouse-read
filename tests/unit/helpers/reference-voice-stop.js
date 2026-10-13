import {neuralEngine} from '../../../src/js/readers/neural-runtime.js'
import {nativeAudio} from '../../../src/js/readers/neural-voice/audio.js'
export class LegacyVoiceStop{
  restart() {
    if (this.state !== 'playing' || this.index >= this.chunks.length) return
    this.clearAhead()
    this.cancelUtterance('restart')
    this.waiting = true; this.notify('Preparando la voz natural…')
    this.speakCurrent()
  }
  cancelUtterance(reason = 'stop') {
    this.utteranceId = null; clearTimeout(this.presentTimer); clearTimeout(this.waitTimer); this.waiting = false
    if (this.transport === 'neural' || nativeAudio()) {
      this.transport = null
      try {
        const engine = neuralEngine()
        if (reason === 'restart' && engine?.cancelCurrent) engine.cancelCurrent()
        else if (reason === 'pause' && engine?.pause) engine.pause()
        else engine?.stop()
      } catch { /* nothing to stop */ }
    }
  }

  pause() {
    if (this.state !== 'playing' && this.state !== 'loading') return
    const pendingPage = this.deferredPage || this.preparingPage?.generation === this.generation
    // A joined PDF sentence contains an activation tied to this generation.
    // Rebuild that continuation on Resume instead of reusing a cancelled page.
    const original = this.items[this.index]?.unjoined
    if (original) { this.items[this.index] = original; this.chunks[this.index] = original.text }
    if (pendingPage) this.resumeNextPage = true
    this.clearAhead()
    this.diagnosticAdvance = null
    this.pausedLocation = JSON.stringify(this.reader.location)
    ++this.generation; this.state = 'paused'; this.cancelUtterance('pause'); this.unpaint()
    if (pendingPage) { this.chunks = []; this.items = []; this.source = null; this.index = 0; this.deferredPage = null }
    if (this.index >= this.chunks.length) this.chunks = []
    this.notify()
  }
  stop() {
    this.stoppedLocation = JSON.stringify(this.reader.location)
    this.completeOpening = false
    this.openingPlan = null
    this.clearAhead()
    this.diagnosticAdvance = null
    ++this.generation; this.state = 'stopped'; this.cancelUtterance(); this.unpaint()
    this.browsing = false; this.reader.stopSpeech?.()
    this.nativeSession = null
    this.preparingPage = null; this.deferredPage = null; this.resumeNextPage = false
    this.chunks = []; this.items = []; this.source = null; this.index = 0; this.missing.clear(); this.spokenWith = null; clearTimeout(this.sleepTimer); this.notify()
  }
  fail(message) { this.stop(); this.notify(message) }

  retryNeural() { this.neuralOff = ''; this.neuralRetries = 0; this.missing.clear() }
}
