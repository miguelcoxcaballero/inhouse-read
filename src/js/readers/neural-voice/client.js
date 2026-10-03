// Page-side handle of the synthesis worker (see worker.js for the protocol): spawns it lazily, loads a voice into it,
// runs synth jobs and tears it down. It knows nothing about audio or about reading: it turns messages into promises/callbacks.

/** Error whose `code` is the 'error' reason of the engine contract. */
const clientError = (code, message, cause) => Object.assign(new Error(message), { code }, cause ? { cause } : {})
const familyOf = key => key === 'supertonic3' ? 'supertonic3' : 'piper'

export class SynthClient {
  /**
   * @param {{createWorker:()=>Worker, ortBase:string, phonBase:string, readModel:(piperId:string)=>Promise<ArrayBuffer>, readConfig:(piperId:string)=>Promise<object>}} deps
   */
  constructor({ createWorker, ortBase, phonBase, readModel, readConfig, readPhonemizerModel = async () => null, readRuntimeAssets = async () => null }) {
    Object.assign(this, { createWorker, ortBase, phonBase, readModel, readConfig, readPhonemizerModel, readRuntimeAssets })
    this.worker = null
    this.seq = 0
    this.calls = new Map()  // id -> {resolve, reject} for init/load/free
    this.jobs = new Map()   // id -> handlers of a running synth
    this.loaded = null      // piperId whose session the worker holds
    this.ready = null       // promise of init
    this.loading = null     // {piperId, promise}
    this.preparationChain = Promise.resolve()
    this.preparations = new Set()
    this.generation = 0
  }

  get alive() { return !!this.worker }

  #spawn() {
    if (this.worker) return
    const worker = this.worker = this.createWorker()
    worker.onmessage = ({ data }) => { if (this.worker === worker) this.#message(data) }
    worker.onerror = event => { event.preventDefault?.(); if (this.worker === worker) this.#crash(clientError('init-failed', event.message || 'worker error')) }
    worker.onmessageerror = () => { if (this.worker === worker) this.#crash(clientError('synth-failed', 'worker message error')) }
  }
  #crash(error) {
    const jobs = [...this.jobs.values()]
    this.dispose(error)
    for (const job of jobs) job.onError(error)
  }
  #message(m) {
    const call = this.calls.get(m.id)
    if (call && m.type !== 'error') { this.calls.delete(m.id); call.resolve(m); return }
    if (call) { this.calls.delete(m.id); call.reject(clientError('init-failed', m.error)); return }
    const job = this.jobs.get(m.id)
    if (!job) return // answer for a cancelled job
    if (m.type === 'plan') job.onPlan?.(m.counts)
    else if (m.type === 'chunk') job.onChunk(m)
    else if (m.type === 'end') { this.jobs.delete(m.id); job.onEnd() }
    else if (m.type === 'error') { this.jobs.delete(m.id); job.onError(clientError('synth-failed', m.error)) }
  }
  #call(message, transfer = []) {
    return new Promise((resolve, reject) => {
      const id = ++this.seq
      this.calls.set(id, { resolve, reject })
      this.worker.postMessage({ ...message, id }, transfer)
    })
  }

  /** Starts the worker if needed and makes `piperId` the voice it holds. Resolves with the voice's config. */
  prepare(piperId) {
    if (this.loading?.piperId === piperId) return this.loading.promise
    const generation = this.generation
    const work = this.preparationChain.then(() => this.#prepare(piperId, generation))
    let rejectPreparation
    const promise = new Promise((resolve, reject) => {
      rejectPreparation = reject
      this.preparations.add(reject)
      work.then(resolve, reject)
    })
    this.preparationChain = promise.catch(() => {})
    this.loading = { piperId, promise }
    const finished = () => {
      this.preparations.delete(rejectPreparation)
      if (this.loading?.promise === promise) this.loading = null
    }
    promise.then(finished, finished)
    return promise
  }

  async #prepare(piperId, generation) {
    if (generation !== this.generation) throw clientError('init-failed', 'worker was released')
    // ORT session.release() does not shrink WASM's grown heap. A family change
    // terminates that worker; language/profile changes share the same pack.
    if (this.loaded && familyOf(this.loaded) !== familyOf(piperId)) {
      const worker = this.worker, calls = [...this.calls.values()], jobs = [...this.jobs.values()]
      const error = clientError('init-failed', 'voice runtime was replaced')
      this.worker = null; this.ready = null; this.loaded = null; this.config = null
      this.calls.clear(); this.jobs.clear()
      try { worker?.terminate() } catch { /* already gone */ }
      for (const call of calls) call.reject(error)
      for (const job of jobs) job.onError(error)
    }
    this.#spawn()
    const worker = this.worker
    this.ready ||= this.#call({ type: 'init', ortBase: this.ortBase, phonBase: this.phonBase, ...(familyOf(piperId) === 'supertonic3' ? { runtime:'supertonic3' } : {}) })
    // Reading the model out of Cache Storage does not need the worker: do it while the worker starts.
    const reading = this.loaded === piperId ? null : this.readConfig(piperId).then(async config => {
      if (config.runtime === 'supertonic3') return { config, buffers:await this.readRuntimeAssets(piperId) }
      const [model, phonemizerModel] = await Promise.all([this.readModel(piperId), this.readPhonemizerModel(piperId)])
      return { config, model, phonemizerModel }
    })
    reading?.catch(() => {})
    try { await this.ready } catch (error) { if (this.worker === worker && generation === this.generation) this.dispose(); throw error }
    if (this.worker !== worker || generation !== this.generation) throw clientError('init-failed', 'worker was released')
    if (this.loaded === piperId) return this.config
    const { config, model, phonemizerModel, buffers } = await reading
    if (this.worker !== worker || generation !== this.generation) throw clientError('init-failed', 'worker was released')
    const transfer = buffers ? [...new Set(Object.values(buffers))] : phonemizerModel ? [model, phonemizerModel] : [model]
    const loaded = await this.#call({ type: 'load', voice: piperId, config, ...(buffers ? { buffers } : { model }), ...(phonemizerModel ? { phonemizerModel } : {}) }, transfer)
    if (this.worker !== worker || generation !== this.generation) throw clientError('init-failed', 'worker was released')
    this.loaded = piperId; this.config = config; this.createMs = loaded.createMs
    return config
  }

  /**
   * Runs a synth job. Handlers: onPlan(counts), onChunk({index,last,pcm,sampleRate,ms}), onEnd(), onError(error).
   * Returns {cancel()}: after it, no handler is called any more.
   */
  synth({ text, rate, speaker, lang, style }, handlers) {
    if (!this.worker) throw clientError('init-failed', 'worker is not running')
    const id = ++this.seq
    this.jobs.set(id, handlers)
    this.worker.postMessage({ type: 'synth', id, text, rate, speaker, ...(lang ? { lang } : {}), ...(style ? { style } : {}) })
    return { id, cancel: () => { if (this.jobs.delete(id)) this.worker?.postMessage({ type: 'cancel', id }) } }
  }

  /** Terminates the worker (frees the ~0.6 GB of the WASM heap); the next prepare() rebuilds it from the cached model. */
  dispose(error = clientError('init-failed', 'worker was released')) {
    const worker = this.worker
    const calls = [...this.calls.values()]
    const preparations = [...this.preparations]
    this.generation++
    this.preparationChain = Promise.resolve()
    this.worker = null; this.ready = null; this.loaded = null; this.loading = null; this.config = null
    this.calls.clear(); this.jobs.clear()
    this.preparations.clear()
    try { worker?.terminate() } catch { /* already gone */ }
    for (const call of calls) call.reject(error)
    for (const reject of preparations) reject(error)
  }
}
