import {VoiceClientPlan} from './client-plan.js'
// Page-side handle of the synthesis worker (see worker.js for the protocol): spawns it lazily, loads a voice into it,
// runs synth jobs and tears it down. It knows nothing about audio or about reading: it turns messages into promises/callbacks.

/** Error whose `code` is the 'error' reason of the engine contract. */
const clientError = (code, message, cause) => Object.assign(new Error(message), { code }, cause ? { cause } : {})

export class SynthClient {
  /**
   * @param {{createWorker:()=>Worker, ortBase:string, phonBase:string, readModel:(piperId:string)=>Promise<ArrayBuffer>, readConfig:(piperId:string)=>Promise<object>}} deps
   */
  constructor({ createWorker, ortBase, phonBase, readModel, readConfig, readPhonemizerModel = async () => null, readRuntimeAssets = async () => null, onStage = null }) {
    Object.assign(this, { createWorker, ortBase, phonBase, readModel, readConfig, readPhonemizerModel, readRuntimeAssets, onStage })
    this.worker = null
    this.plan = new VoiceClientPlan(() => clientError('init-failed', 'worker was released'))
    this.calls = new Map()  // id -> {resolve, reject} for init/load/free
    this.jobs = new Map()   // id -> handlers of a running synth
    this.loaded = null      // piperId whose session the worker holds
    this.ready = null       // promise of init
    this.loading = null     // {piperId, promise}
    this.preparationChain = Promise.resolve()
    this.preparations = new Set()
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
    const action = this.plan.message(m)
    if (action === 7) {
      try { this.onStage?.(m.domain, m.stage, m.id, m.part) } catch { /* diagnostics never settle a job */ }
      return
    }
    if (action === 1 || action === 2) {
      const call = this.calls.get(m.id); this.calls.delete(m.id)
      if (action === 1) call.resolve(m)
      else call.reject(clientError('init-failed', m.error))
      return
    }
    if (!action) return
    const job = this.jobs.get(m.id)
    if (action === 3) job.onPlan?.(m.counts)
    else if (action === 4) job.onChunk(m)
    else if (action === 5) { this.jobs.delete(m.id); job.onEnd() }
    else if (action === 6) { this.jobs.delete(m.id); job.onError(clientError('synth-failed', m.error)) }
  }
  #call(message, transfer = []) {
    return new Promise((resolve, reject) => {
      const id = this.plan.next('call')
      this.calls.set(id, { resolve, reject })
      this.worker.postMessage({ ...message, id }, transfer)
    })
  }

  /** Starts the worker if needed and makes `piperId` the voice it holds. Resolves with the voice's config. */
  prepare(piperId) {
    if (this.plan.preparing(piperId)) return this.loading.promise
    const generation = this.plan.capture()
    const work = this.preparationChain.then(() => this.#prepare(piperId, generation))
    let rejectPreparation
    const promise = new Promise((resolve, reject) => {
      rejectPreparation = reject
      this.preparations.add(reject)
      work.then(resolve, reject)
    })
    this.preparationChain = promise.catch(() => {})
    this.loading = { piperId, promise }; this.plan.beginPreparation(piperId)
    const finished = () => {
      this.preparations.delete(rejectPreparation)
      if (this.loading?.promise === promise) { this.loading = null; this.plan.finishPreparation() }
    }
    promise.then(finished, finished)
    return promise
  }

  async #prepare(piperId, generation) {
    if (!this.plan.pending(generation)) throw clientError('init-failed', 'worker was released')
    await this.plan.ready()
    if (!this.plan.current(generation)) throw clientError('init-failed', 'worker was released')
    // ORT session.release() does not shrink WASM's grown heap. A family change
    // terminates that worker; language/profile changes share the same pack.
    if (this.plan.model(1, piperId)) {
      const worker = this.worker, calls = [...this.calls.values()], jobs = [...this.jobs.values()]
      const error = clientError('init-failed', 'voice runtime was replaced')
      this.worker = null; this.ready = null; this.loaded = null; this.config = null
      this.calls.clear(); this.jobs.clear(); this.plan.model(3)
      try { worker?.terminate() } catch { /* already gone */ }
      for (const call of calls) call.reject(error)
      for (const job of jobs) job.onError(error)
    }
    this.#spawn()
    const worker = this.worker
    this.ready ||= this.#call({ type: 'init', ortBase: this.ortBase, phonBase: this.phonBase, ...(this.onStage ? {diagnostics:true} : {}), ...(this.plan.model(4, piperId) ? { runtime:'supertonic3' } : {}) })
    // Reading the model out of Cache Storage does not need the worker: do it while the worker starts.
    const reading = this.plan.model(0, piperId) ? null : this.readConfig(piperId).then(async config => {
      if (this.worker !== worker || !this.plan.current(generation)) throw clientError('init-failed', 'worker was released')
      if (this.plan.classifyRuntime(config) === 2) return { config, buffers:await this.readRuntimeAssets(piperId) }
      const [model, phonemizerModel] = await Promise.all([this.readModel(piperId), this.readPhonemizerModel(piperId)])
      return { config, model, phonemizerModel }
    })
    reading?.catch(() => {})
    try { await this.ready } catch (error) { if (this.worker === worker && this.plan.current(generation)) this.dispose(); throw error }
    if (this.worker !== worker || !this.plan.current(generation)) throw clientError('init-failed', 'worker was released')
    if (this.plan.model(0, piperId)) return this.config
    const { config, model, phonemizerModel, buffers } = await reading
    if (this.worker !== worker || !this.plan.current(generation)) throw clientError('init-failed', 'worker was released')
    const transfer = buffers ? [...new Set(Object.values(buffers))] : phonemizerModel ? [model, phonemizerModel] : [model]
    const loaded = await this.#call({ type: 'load', voice: piperId, config, ...(buffers ? { buffers } : { model }), ...(phonemizerModel ? { phonemizerModel } : {}) }, transfer)
    if (this.worker !== worker || !this.plan.current(generation)) throw clientError('init-failed', 'worker was released')
    this.plan.model(2, piperId)
    this.loaded = piperId; this.config = config; this.createMs = loaded.createMs
    return config
  }

  /**
   * Runs a synth job. Handlers: onPlan(counts), onChunk({index,last,pcm,sampleRate,ms}), onEnd(), onError(error).
   * Returns {cancel()}: after it, no handler is called any more.
   */
  synth({ text, rate, speaker, lang, style, marks }, handlers) {
    if (!this.worker) throw clientError('init-failed', 'worker is not running')
    const id = this.plan.next('job')
    this.jobs.set(id, handlers)
    this.worker.postMessage({ type: 'synth', id, text, rate, speaker, ...(lang ? { lang } : {}), ...(style ? { style } : {}), ...(marks?.length ? {marks} : {}) })
    return { id, cancel: () => { if (this.plan.cancel(id)) { this.jobs.delete(id); this.worker?.postMessage({ type: 'cancel', id }) } } }
  }

  /** Terminates the worker (frees the ~0.6 GB of the WASM heap); the next prepare() rebuilds it from the cached model. */
  dispose(error = clientError('init-failed', 'worker was released')) {
    const worker = this.worker
    const calls = [...this.calls.values()]
    const preparations = [...this.preparations]
    this.plan.dispose()
    this.preparationChain = Promise.resolve()
    this.worker = null; this.ready = null; this.loaded = null; this.loading = null; this.config = null
    this.calls.clear(); this.jobs.clear()
    this.preparations.clear()
    try { worker?.terminate() } catch { /* already gone */ }
    for (const call of calls) call.reject(error)
    for (const reject of preparations) reject(error)
  }
}
