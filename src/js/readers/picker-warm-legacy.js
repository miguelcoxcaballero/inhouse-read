import {neuralEngine,loadNeural} from './neural-runtime.js'
const USED_KEY='inhouse-read-neural-used'
export class LegacyWarm {warm() {
    if (this.warmed) return
    this.warmed = true
    // The worker (and its ~0.2-0.3 GB) is only started ahead of Play for people who have listened with a neural voice before;
    // for anyone else a book being opened just loads the engine module and the list of installed voices.
    const context = this.warmContext()
    const run = () => {
      this.warmHandle = null
      if (this.isWarmCurrent(context)) this.refresh({ warm:this.used() })
    }
    this.warmHandle = typeof requestIdleCallback === 'function'
      ? { idle:true, id:requestIdleCallback(run, { timeout:2500 }) }
      : { idle:false, id:setTimeout(run, 800) }
  }
refresh({ warm = true } = {}) {
    const context = this.warmContext()
    loadNeural().then(() => { if (this.isWarmCurrent(context)) this.attach(warm) }, () => {})
  }
used() { try { return localStorage.getItem(USED_KEY) === '1' } catch { return false } }
attach(warm = true) {
    const context = this.warmContext()
    const engine = neuralEngine()
    if (engine && engine !== this.engine) {
      this.engine = engine
      engine.addEventListener('change', () => this.changed())
      engine.addEventListener('status', () => { if (engine.status === 'speaking' && !this.used()) { try { localStorage.setItem(USED_KEY, '1') } catch { /* it just warms up at the audio tab */ } } })
      Promise.resolve(engine.refresh?.()).catch(() => {}).then(() => warm && this.isWarmCurrent(context) && this.warmUp())
    } else if (engine && warm) this.warmUp()
    if (!engine) this.engine = null
    this.host.populateVoices()
  }
warmContext() { return { generation:this.warmGeneration, book:this.host.book } }
isWarmCurrent(context) {
    return Boolean(context?.book && context.book === this.host.book && context.generation === this.warmGeneration)
  }
cancelWarm() {
    ++this.warmGeneration; this.warmed = false
    const handle = this.warmHandle
    this.warmHandle = null
    if (handle?.idle) { if (typeof cancelIdleCallback === 'function') cancelIdleCallback(handle.id) }
    else if (handle) clearTimeout(handle.id)
  }
warmUp() {
    if (!this.isWarmCurrent(this.warmContext())) return
    try {
      const engine = neuralEngine(), { voice } = this.host.voice?.voiceFor?.('') || {}
      if (engine?.warmUp && voice?.neural && voice.installed) {
        const context = this.warmContext()
        Promise.resolve(engine.warmUp(voice.id)).catch(() => {})
        Promise.resolve(this.host.voice?.preparePlayback?.(() => this.isWarmCurrent(context))).catch(() => {})
      }
    } catch { /* the first speak() starts the worker as before */ }
  }
changed() {
    const engine = neuralEngine(), signature = engine ? [...engine.installed].sort().join(',') : ''
    if (signature !== this.signature) { this.signature = signature; this.host.populateVoices(); return }
    if (this.frame) return
    this.frame = requestAnimationFrame(() => { this.frame = 0; this.paint() })
  }
paint() {
    const engine = neuralEngine()
    if (engine && this.patchProgress(engine)) return
    this.render()
  }}
