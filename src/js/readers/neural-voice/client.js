// Page-side handle of the synthesis worker (see worker.js for the protocol): spawns it lazily, loads a voice into it,
// runs synth jobs and tears it down. It knows nothing about audio or about reading: it turns messages into promises/callbacks.

/** Error whose `code` is the 'error' reason of the engine contract. */
const clientError = (code, message, cause) => Object.assign(new Error(message), { code }, cause ? { cause } : {})

export class SynthClient {
  /**
   * @param {{createWorker:()=>Worker, ortBase:string, phonBase:string, readModel:(piperId:string)=>Promise<ArrayBuffer>, readConfig:(piperId:string)=>Promise<object>}} deps
   */
  constructor({ createWorker, ortBase, phonBase, readModel, readConfig }) {
    Object.assign(this, { createWorker, ortBase, phonBase, readModel, readConfig })
    this.worker = null
    this.seq = 0
    this.calls = new Map()  // id -> {resolve, reject} for init/load/free
    this.jobs = new Map()   // id -> handlers of a running synth
    this.loaded = null      // piperId whose session the worker holds
    this.ready = null       // promise of init
    this.loading = null     // {piperId, promise}
  }

  get alive() { return !!this.worker }

  #spawn() {
    if (this.worker) return
    const worker = this.worker = this.createWorker()
    worker.onmessage = ({ data }) => this.#message(data)
    worker.onerror = event => { event.preventDefault?.(); this.#crash(clientError('init-failed', event.message || 'worker error')) }
    worker.onmessageerror = () => this.#crash(clientError('synth-failed', 'worker message error'))
  }
  #crash(error) {
    const calls = [...this.calls.values()], jobs = [...this.jobs.values()]
    this.dispose()
    for (const call of calls) call.reject(error)
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
  async prepare(piperId) {
    this.#spawn()
    const worker = this.worker
    this.ready ||= this.#call({ type: 'init', ortBase: this.ortBase, phonBase: this.phonBase })
    // Reading the model out of Cache Storage does not need the worker: do it while the worker starts.
    const reading = this.loaded === piperId || this.loading?.piperId === piperId ? null : Promise.all([this.readConfig(piperId), this.readModel(piperId)])
    reading?.catch(() => {})
    try { await this.ready } catch (error) { this.dispose(); throw error }
    if (this.loaded === piperId) return this.config
    if (this.loading?.piperId === piperId) return this.loading.promise
    const promise = (async () => {
      const [config, model] = await reading
      if (this.worker !== worker) throw clientError('init-failed', 'worker was released')
      const loaded = await this.#call({ type: 'load', voice: piperId, config, model }, [model])
      this.loaded = piperId; this.config = config; this.createMs = loaded.createMs
      return config
    })()
    this.loading = { piperId, promise }
    try { return await promise } finally { if (this.loading?.promise === promise) this.loading = null }
  }

  /**
   * Runs a synth job. Handlers: onPlan(counts), onChunk({index,last,pcm,sampleRate,ms}), onEnd(), onError(error).
   * Returns {cancel()}: after it, no handler is called any more.
   */
  synth({ text, rate, speaker }, handlers) {
    if (!this.worker) throw clientError('init-failed', 'worker is not running')
    const id = ++this.seq
    this.jobs.set(id, handlers)
    this.worker.postMessage({ type: 'synth', id, text, rate, speaker })
    return { id, cancel: () => { if (this.jobs.delete(id)) this.worker?.postMessage({ type: 'cancel', id }) } }
  }

  /** Terminates the worker (frees the ~0.6 GB of the WASM heap); the next prepare() rebuilds it from the cached model. */
  dispose() {
    const worker = this.worker
    this.worker = null; this.ready = null; this.loaded = null; this.loading = null; this.config = null
    this.calls.clear(); this.jobs.clear()
    try { worker?.terminate() } catch { /* already gone */ }
  }
}
