// A fake of the neural voice engine (src/js/readers/neural-voice/index.js contract) for the integration tests: no workers,
// no models, no audio. Unit tests call createFakeNeuralEngine() and hand it to setNeuralEngine(); e2e tests serialise the
// same function into the page (fakeEngineScript) so the built app finds it on window.__inhouseNeuralTest.
// createFakeNeuralEngine must stay self-contained (no imports, no outer variables): Function.prototype.toString ships it.

export const FAKE_CATALOG = [
  { id:'piper:es_ES-davefx-medium', piperId:'es_ES-davefx-medium', lang:'es-ES', name:'Davefx', quality:'medium', sizeMB:63, speaker:0, recommended:true },
  { id:'piper:es_MX-claude-high', piperId:'es_MX-claude-high', lang:'es-MX', name:'Claude', quality:'high', sizeMB:63, speaker:0 },
  { id:'piper:en_US-lessac-high', piperId:'en_US-lessac-high', lang:'en-US', name:'Lessac', quality:'high', sizeMB:63, speaker:0, recommended:true },
  { id:'piper:en_GB-alba-medium', piperId:'en_GB-alba-medium', lang:'en-GB', name:'Alba', quality:'medium', sizeMB:63, speaker:0 },
  { id:'piper:fr_FR-siwis-medium', piperId:'fr_FR-siwis-medium', lang:'fr-FR', name:'Siwis', quality:'medium', sizeMB:63, speaker:0, recommended:true },
  { id:'piper:de_DE-thorsten-medium', piperId:'de_DE-thorsten-medium', lang:'de-DE', name:'Thorsten', quality:'medium', sizeMB:63, speaker:0, recommended:true },
  { id:'piper:it_IT-paola-medium', piperId:'it_IT-paola-medium', lang:'it-IT', name:'Paola', quality:'medium', sizeMB:63, speaker:0, recommended:true },
  { id:'piper:pt_BR-faber-medium', piperId:'pt_BR-faber-medium', lang:'pt-BR', name:'Faber', quality:'medium', sizeMB:63, speaker:0, recommended:true },
  { id:'piper:ca_ES-upc_ona-medium', piperId:'ca_ES-upc_ona-medium', lang:'ca-ES', name:'Ona', quality:'medium', sizeMB:63, speaker:0, recommended:true }
]

/**
 * options: supported (true), installed ([] of ids), voices (FAKE_CATALOG), manual (false: downloads advance only through
 * engine.progress/finish/fail), steps (5) and stepMs (30) for automatic downloads, startDelay (0 ms before 'start'),
 * speakMs (40 ms between 'start' and 'done'), hold (true: speak() never starts nor ends by itself), holdAfter (a call count:
 * that fragment starts but does not end, so its highlight can be measured), failNext (a reason: the
 * next speak() answers with that 'error'), failInstall ({[id]: code} rejects that download once).
 * Recorded for the tests: calls (speak arguments), stops, unlocks, removed, installs, plus the highlight the page showed
 * when speak() was called (atSpeak) and when 'start' fired (atStart), read from window.__speechHighlight when it exists.
 */
export function createFakeNeuralEngine(options = {}) {
  const config = { supported:true, installed:[], steps:5, stepMs:30, startDelay:0, speakMs:40, manual:false, hold:false, holdAfter:null, failNext:'', failInstall:{}, ...options }
  const catalog = options.voices || []
  const sizeOf = id => Math.round(((catalog.find(voice => voice.id === id) || {}).sizeMB || 63) * 1e6)
  const coded = (code, message = code) => Object.assign(new Error(message), { code })
  const highlight = () => { try { return window.__speechHighlight?.() ?? '' } catch { return '' } }
  class FakeNeuralEngine extends EventTarget {
    constructor() {
      super()
      this.set = new Set(config.installed); this.map = new Map(); this.tasks = new Map(); this.timers = new Set()
      this.calls = []; this.stops = 0; this.unlocks = 0; this.removed = []; this.installs = []; this.refreshes = 0; this.warmed = []; this.config = config
    }
    static isSupported() { return config.supported }
    get supported() { return config.supported }
    get installed() { return this.set }
    get downloads() { return this.map }
    emitChange() { this.dispatchEvent(new Event('change')) }
    async refresh() { this.refreshes++ }
    async warmUp(id) { this.warmed.push(id); return true }
    install(id, { signal } = {}) {
      this.installs.push(id)
      if (this.tasks.has(id)) return this.tasks.get(id).promise
      const task = {}
      task.promise = new Promise((resolve, reject) => { task.resolve = resolve; task.reject = reject })
      this.tasks.set(id, task)
      this.map.set(id, { state:'downloading', fraction:0, received:0, total:sizeOf(id) })
      this.emitChange()
      signal?.addEventListener('abort', () => this.abort(id))
      if (config.failInstall[id]) { const code = config.failInstall[id]; delete config.failInstall[id]; this.later(() => this.fail(id, code), config.stepMs * 2) }
      else if (!config.manual) {
        let step = 0
        const tick = () => { step++; if (!this.tasks.has(id)) return; if (step >= config.steps) this.finish(id); else { this.progress(id, step / config.steps); this.later(tick, config.stepMs) } }
        this.later(tick, config.stepMs)
      }
      return task.promise
    }
    later(fn, ms) { const timer = setTimeout(() => { this.timers.delete(timer); fn() }, ms); this.timers.add(timer); return timer }
    progress(id, fraction) {
      if (!this.tasks.has(id)) return
      const total = sizeOf(id)
      this.map.set(id, { state:'downloading', fraction, received:Math.round(total * fraction), total })
      this.emitChange()
    }
    finish(id) {
      const task = this.tasks.get(id)
      if (!task) return
      this.tasks.delete(id); this.map.delete(id); this.set.add(id)
      this.emitChange(); task.resolve()
    }
    fail(id, code = 'offline') {
      const task = this.tasks.get(id)
      if (!task) return
      const known = this.map.get(id) || { fraction:0, received:0, total:sizeOf(id) }
      this.tasks.delete(id); this.map.set(id, { ...known, state:'error', error:`error ${code}`, code }) // like the real engine: a message in `error`, the machine-readable reason in `code`
      this.emitChange(); task.reject(coded(code))
    }
    abort(id) {
      const task = this.tasks.get(id)
      if (!task) return
      this.tasks.delete(id); this.map.delete(id)
      this.emitChange(); task.reject(coded('aborted'))
    }
    cancel(id) { this.abort(id) }
    async remove(id) { this.removed.push(id); this.set.delete(id); this.map.delete(id); this.emitChange() }
    unlock() { this.unlocks++ }
    emit(type, id, reason) { window.dispatchEvent(new CustomEvent('inhouse-tts', { detail:{ type, id, ...(reason ? { reason } : {}) } })) }
    speak({ text, voiceId, rate = 1, id, upcoming = [] }) {
      this.clearSpeech()
      const call = { text, voiceId, rate, id, upcoming: [...upcoming], atSpeak:highlight(), atStart:null }
      this.calls.push(call)
      this.current = call
      if (config.failNext) { const reason = config.failNext; config.failNext = ''; this.speechTimer = this.later(() => this.emit('error', id, reason), config.startDelay); return }
      if (config.hold) return
      this.speechTimer = this.later(() => {
        this.emit('start', id); call.atStart = highlight()
        if (config.holdAfter == null || this.calls.length < config.holdAfter) this.speechTimer = this.later(() => this.emit('done', id), config.speakMs)
      }, config.startDelay)
    }
    clearSpeech() { clearTimeout(this.speechTimer); this.timers.delete(this.speechTimer) }
    stop() { this.stops++; this.clearSpeech(); this.current = null }
  }
  return new FakeNeuralEngine()
}

/** An init script that installs the engine (and its catalogue) on the page before the app loads. */
export const fakeEngineScript = (options = {}) => {
  const withVoices = { voices:FAKE_CATALOG, ...options }
  return `window.__inhouseNeuralTest = { engine:(${createFakeNeuralEngine.toString()})(${JSON.stringify(withVoices)}), voices:${JSON.stringify(withVoices.voices)} }`
}
