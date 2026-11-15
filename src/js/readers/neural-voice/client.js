import {VoiceClientPlan} from './client-plan.js'
import { readerUI as ui } from '../rust-ui-required.js'
// Page-side handle of the synthesis worker (see worker.js for the protocol). The routing of its answers, the calls, the
// jobs, the preparation and the teardown are rust-ui (synth_client.rs); this class keeps the injected services and the
// closures the worker and the promises call back.

export class SynthClient {
  /**
   * @param {{createWorker:()=>Worker, ortBase:string, phonBase:string, readModel:(piperId:string)=>Promise<ArrayBuffer>, readConfig:(piperId:string)=>Promise<object>}} deps
   */
  constructor({ createWorker, ortBase, phonBase, readModel, readConfig, readPhonemizerModel = async () => null, readRuntimeAssets = async () => null, onStage = null }) {
    Object.assign(this, { createWorker, ortBase, phonBase, readModel, readConfig, readPhonemizerModel, readRuntimeAssets, onStage })
    this.worker = null
    this.plan = new VoiceClientPlan(() => ui().synth_client_error('init-failed', 'worker was released'))
    this.calls = new Map()  // id -> {resolve, reject} for init/load/free
    this.jobs = new Map()   // id -> handlers of a running synth
    this.loaded = null      // piperId whose session the worker holds
    this.ready = null       // promise of init
    this.loading = null     // {piperId, promise}
    this.preparationChain = Promise.resolve()
    this.preparations = new Set()
  }

  get alive() { return !!this.worker }

  _spawn() {
    if (this.worker) return
    const worker = this.worker = this.createWorker()
    worker.onmessage = ({ data }) => { if (this.worker === worker) ui().synth_client_message(this, data) }
    worker.onerror = event => { event.preventDefault?.(); if (this.worker === worker) ui().synth_client_crash(this, ui().synth_client_error('init-failed', event.message || 'worker error')) }
    worker.onmessageerror = () => { if (this.worker === worker) ui().synth_client_crash(this, ui().synth_client_error('synth-failed', 'worker message error')) }
  }

  /** Starts the worker if needed and makes `piperId` the voice it holds. Resolves with the voice's config. */
  prepare(piperId) {
    if (this.plan.preparing(piperId)) return this.loading.promise
    const generation = this.plan.capture()
    const work = this.preparationChain.then(() => ui().synth_client_prepare(this, piperId, generation))
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

  /**
   * Runs a synth job. Handlers: onPlan(counts), onChunk({index,last,pcm,sampleRate,ms}), onEnd(), onError(error).
   * Returns {cancel()}: after it, no handler is called any more.
   */
  synth(request, handlers) {
    const id = ui().synth_client_synth(this, request, handlers)
    return { id, cancel: () => ui().synth_client_cancel(this, id) }
  }

  /** Terminates the worker (frees the ~0.6 GB of the WASM heap); the next prepare() rebuilds it from the cached model. */
  dispose(error) { ui().synth_client_dispose(this, error) }
}
