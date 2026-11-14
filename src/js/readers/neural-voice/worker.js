// The synthesis worker. Everything heavy happens here, never on the page: onnxruntime-web (single-threaded WASM: GitHub
// Pages has no COOP/COEP, so no SharedArrayBuffer), the espeak-ng phonemizer, and the clean-up of the audio (peak
// normalisation, silence trimming). The page only receives transferable Float32Array chunks.
//
// One runtime family is alive at a time. Piper holds one voice session (and
// Nakdimon for Hebrew); Supertonic holds four shared sessions for its profiles.
// Messages carry request ids; the protocol is written down in rust-ui/src/voice_worker.rs, which runs the worker once it
// is initialized: loading and releasing a voice, the queue and every synthesis job. This file keeps what must exist
// before a voice module does (the routing of a message that arrives first, `init` with its dynamic imports) and `host`,
// the state both sides read.
import { createPhonemizer } from './phonemizer.js'
import { createHebrewPhonemizer } from './hebrew.js'
import { createSupertonicRuntime } from './supertonic-runtime.js'
import { yieldToMessages } from './task-yield.js'
import { VoiceClientPlan } from './client-plan.js'
import { loadedRustVoiceUI } from '../../rust-voice-ui.js'

let initPromise = null, bootstrapDiagnostics = false
const plan = new VoiceClientPlan(() => new Error('voice runtime was released'), {}, true)
const post = (message, transfer = []) => self.postMessage(message, transfer)
// Finite receipts at original await boundaries, enabled only by the native
// diagnostic bridge. No text, PCM, timers, polling or playback changes.
const stage = (domain, stage, id, part = 0) => { if (plan.pointer ? plan.diagnostics : bootstrapDiagnostics) post({type:'stage',domain,stage,id,part}) }
// `jobs`: host message handles; admission, FIFO and cancellation are Rust. The text -> phoneme ids of the loaded voice
// are Nakdimon + the Hebrew rules, or espeak.
const host = {
  plan, post, stage, yieldToMessages, createPhonemizer, createHebrewPhonemizer, createSupertonicRuntime, noop() {}, jobs: new Map(),
  ort: null, phonemizer: null, phonBase: null, hebrew: null, supertonic: null, session: null, config: null, voice: null, durationOutput: null,
  loadChain: Promise.resolve(), drainDone: Promise.resolve(),
  phonemize: async value => loadedRustVoiceUI().voice_host_limit_ids(plan.runtimeKind === 1 ? await host.hebrew.phonemize(value) : await host.phonemizer.phonemize(value, host.config.espeak.voice), host.config.num_symbols)
}

async function init({ ortBase, phonBase, runtime }) {
  // Module/phonemizer/core startup remains parallel. A late phonemizer must
  // not outlive an init failure or an explicit free during initialization.
  const generation = plan.capture()
  host.phonBase = phonBase
  let localPhon = null, released = false
  const phonReady = runtime === 'supertonic3' ? Promise.resolve(null) : Promise.resolve(createPhonemizer({ base: phonBase })).then(phon => {
    localPhon = phon
    if (released) { try { phon?.destroy() } catch {} }
    return phon
  })
  try {
    const [module, phon] = await Promise.all([import(/* @vite-ignore */ ortBase + 'ort.wasm.min.mjs'), phonReady,
      plan.ready().then(() => { plan.diagnostics = bootstrapDiagnostics })])
    if (!plan.current(generation)) throw new Error('voice runtime was released')
    module.env.wasm.wasmPaths = ortBase
    module.env.wasm.numThreads = 1
    module.env.wasm.proxy = false
    host.ort = module; host.phonemizer = phon
  } catch (error) {
    released = true
    try { localPhon?.destroy() } catch {}
    throw error
  }
}

self.onmessage = async ({ data: m }) => {
  try {
    // Before init owns a core, only bootstrap routing is possible. It must not
    // download WASM in response to a stray cancel/free or an invalid synth.
    const command = plan.pointer ? plan.command(m.type) : ({init:1,load:2,synth:3,cancel:4,free:5}[m.type] || 0)
    if (command === 1) {
      bootstrapDiagnostics = m.diagnostics === true
      plan.diagnostics = bootstrapDiagnostics
      stage(1,1,m.id)
      const initializing = initPromise ||= init(m)
      try { await initializing } catch (error) { if (initPromise === initializing) initPromise = null; throw error }
      stage(1,2,m.id)
      post({ type:'ready', id:m.id, version:host.ort.env.versions?.common, crossOriginIsolated:self.crossOriginIsolated })
    } else if (command === 2) {
      await initPromise
      if (!plan.pointer) throw new Error('no voice runtime initialized')
      await loadedRustVoiceUI().voice_worker_load(host, m)
    } else if (command === 3) {
      if (!plan.pointer) throw new Error('no voice loaded')
      loadedRustVoiceUI().voice_worker_enqueue(host, m)
    } else if (command === 4) {
      plan.cancel(m.id)
    } else if (command === 5) {
      if (plan.pointer) return await loadedRustVoiceUI().voice_worker_free(host, m)
      // No voice was ever loaded: only an initialization can be under way, and it must find itself released.
      const freeing = host.loadChain.then(async () => { await null; plan.invalidate(); host.jobs.clear() })
      host.loadChain = freeing.catch(() => {})
      await freeing
      post({ type:'freed', id:m.id })
    }
  } catch (error) { post({ type:'error', id:m.id, error:String(error?.stack || error) }) }
}
