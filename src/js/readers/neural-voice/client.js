import {VoiceClientPlan} from './client-plan.js'
import { readerUI as ui } from '../rust-ui-required.js'
// Page-side handle of the synthesis worker (see worker.js for the protocol). The routing of its answers, the calls, the
// jobs, the preparation, the teardown and what the constructor builds are rust-ui (synth_client.rs, client_shells.rs,
// client_prepare.rs); this class keeps the handlers of the worker it starts, which every message of the worker passes
// through, and the handle of a job. `none` is what reads an asset the caller has no reader for.
const kit = { VoiceClientPlan, none: async () => null }

export class SynthClient {
  /**
   * @param {{createWorker:()=>Worker, ortBase:string, phonBase:string, readModel:(piperId:string)=>Promise<ArrayBuffer>, readConfig:(piperId:string)=>Promise<object>}} deps
   */
  constructor(deps) { ui().synth_client_construct(this, deps, kit) }

  get alive() { return !!this.worker }

  _spawn() {
    if (this.worker) return
    const worker = this.worker = this.createWorker()
    worker.onmessage = ({ data }) => { if (this.worker === worker) ui().synth_client_message(this, data) }
    worker.onerror = event => { event.preventDefault?.(); if (this.worker === worker) ui().synth_client_crash(this, ui().synth_client_error('init-failed', event.message || 'worker error')) }
    worker.onmessageerror = () => { if (this.worker === worker) ui().synth_client_crash(this, ui().synth_client_error('synth-failed', 'worker message error')) }
  }

  /** Starts the worker if needed and makes `piperId` the voice it holds. Resolves with the voice's config. */
  prepare(piperId) { const module = ui(); return module.synth_client_begin(this, piperId, module) }

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
