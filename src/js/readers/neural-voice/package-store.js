// The reading engine sees model keys; each runtime retains its own atomic
// installation format. A Supertonic pack is shared by every language/profile.
import { VoiceStore } from './store.js'
import { SupertonicStore } from './supertonic-store.js'
import { SUPERTONIC_MODEL_ID } from './supertonic-catalog.js'

export class NeuralPackageStore {
  constructor({ piper = new VoiceStore(), supertonic = new SupertonicStore() } = {}) {
    Object.assign(this, { piper, supertonic })
  }
  async list() {
    const [piper, supertonic] = await Promise.allSettled([this.piper.list(), this.supertonic.installed()])
    return new Set([...(piper.status === 'fulfilled' ? piper.value : []), ...(supertonic.status === 'fulfilled' && supertonic.value ? [SUPERTONIC_MODEL_ID] : [])])
  }
  async listVoices(voices) {
    const [piper,styles]=await Promise.allSettled([this.piper.list(),this.supertonic.availableStyles()]);
    return new Set(voices.filter(voice=>voice.runtime==='supertonic3'
      ? styles.status==='fulfilled'&&styles.value.has(voice.style)
      : piper.status==='fulfilled'&&piper.value.has(voice.piperId)).map(voice=>voice.id));
  }
  has(key) { return key === SUPERTONIC_MODEL_ID ? this.supertonic.installed() : this.piper.has(key) }
  download(key, options) { return key === SUPERTONIC_MODEL_ID ? this.supertonic.install(options) : this.piper.download(key, options) }
  remove(key) { return key === SUPERTONIC_MODEL_ID ? this.supertonic.remove() : this.piper.remove(key) }
  async readConfig(key) {
    return key === SUPERTONIC_MODEL_ID ? { runtime:'supertonic3', ...await this.supertonic.readConfig() } : this.piper.readConfig(key)
  }
  readModel(key) { return this.piper.readModel(key) }
  readPhonemizerModel(key) { return this.piper.readPhonemizerModel?.(key) || null }
  readRuntimeAssets(key) { return key === SUPERTONIC_MODEL_ID ? this.supertonic.readAssets() : null }
}
