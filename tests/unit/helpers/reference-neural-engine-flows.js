// Frozen from aa1077be (src/js/readers/neural-voice/engine.js): the members of NeuralEngine that waited in JavaScript
// between exports of rust-ui neural_engine.rs, before neural_engine_flows.rs ran them. The reference of
// tests/unit/neural-engine-flows-wasm.test.js: the same engine with these five members as they were.
import { NeuralEngine, storeError } from '../../../src/js/readers/neural-voice/engine.js'
import { readerUI as ui } from '../../../src/js/readers/rust-ui-required.js'

export class ReferenceNeuralEngine extends NeuralEngine {
  async refresh() {
    let next
    try { const [listing, legacy] = ui().neural_list(this); next = ui().neural_listed(this, await listing, legacy) } catch { next = new Set() }
    ui().neural_installed_changed(this, next)
  }

  async install(id, { signal } = {}) {
    const begun = ui().neural_install_begin(this, id, signal)
    if (!Array.isArray(begun)) return begun // nothing to do, or the download of this model that is already running
    const [voice, siblings, abort] = begun
    let last = 0
    const job = (async () => {
      try {
        await this.store.download(voice.piperId, { signal: abort.signal, onProgress: progress => { last = ui().neural_install_progress(this, siblings, last, progress) } })
        ui().neural_install_done(this, siblings)
      } catch (error) { throw ui().neural_install_failed(this, siblings, error, storeError) }
      finally { ui().neural_install_finally(this, voice.piperId, abort) }
    })()
    this.installing.set(voice.piperId, job)
    return job
  }

  async remove(id) {
    const voice = ui().neural_remove_begin(this, id)
    if (!voice) return
    await this.store.remove(voice.piperId)
    ui().neural_remove_end(this, voice)
  }

  /**
   * Starts the worker and loads the voice's model ahead of the first speak() (a cold start is 3-6 s: worker, ONNX
   * Runtime, a 63 MB model). Resolves when ready, never rejects; the idle teardown still applies if nothing is spoken.
   */
  async warmUp(voiceId) {
    const voice = ui().neural_warm_begin(this, voiceId)
    if (!voice) return false
    let client = this.client
    try { client = ui().neural_client(this); await client.prepare(voice.piperId); return ui().neural_warm_done(this, client) }
    catch { return ui().neural_warm_failed(this, client) }
  }

  _prepare(run) {
    let begun
    try { begun = ui().neural_prepare_begin(this, run) } catch { ui().neural_prepare_failed(this, run); return }
    const [promise, started, cold] = begun
    Promise.resolve(promise).then(() => ui().neural_prepare_ready(this, run, started, cold), () => ui().neural_prepare_failed(this, run))
  }
}
