// The synthesis worker. Everything heavy happens here, never on the page: onnxruntime-web (single-threaded WASM: GitHub
// Pages has no COOP/COEP, so no SharedArrayBuffer), the espeak-ng phonemizer, and the clean-up of the audio (peak
// normalisation, silence trimming). The page only receives transferable Float32Array chunks.
//
// One runtime family is alive at a time. Piper holds one voice session (and
// Nakdimon for Hebrew); Supertonic holds four shared sessions for its profiles.
// Messages carry request ids.
//
//   page -> worker
//     {type:'init',  id, ortBase, phonBase}                   load onnxruntime-web (files of OUR site) and the phonemizer
//     {type:'load',  id, voice, config, model|buffers, phonemizerModel?} create sessions from cached bytes
//     {type:'synth', id, text, rate, speaker, lang?, style?}  speak `text`: replies with plan + chunks (below), queued FIFO
//     {type:'cancel', id}                                     forget a queued/running synth (a running segment finishes first)
//     {type:'free'}                                           release the session
//   worker -> page
//     {type:'ready'|'loaded'|'freed', id, ...}                answers to init / load / free
//     {type:'plan',  id, counts:[phoneme ids per sentence]}   right after phonemising, so the page can predict durations
//     {type:'chunk', id, index, last, pcm:Float32Array, sampleRate, ms}   one sentence of audio, ready to play (ms = compute time)
//     {type:'end',   id}                                      synth finished
//     {type:'error', id, error}                               anything that failed (the worker stays usable)
import { createPhonemizer } from './phonemizer.js'
import { exposePiperDurations, phonemeMarks } from './piper-alignment.js'
import { createHebrewPhonemizer } from './hebrew.js'
import { createSupertonicRuntime } from './supertonic-runtime.js'
import { yieldToMessages } from './task-yield.js'
import { VoiceClientPlan } from './client-plan.js'
import { silence, limitIds, splitSegments, finishPiper, finishSupertonic, piperScales } from './synth-flow.js'

let ort = null, phonemizer = null, phonBaseURL = null, hebrewPhonemizer = null, supertonicRuntime = null, session = null, config = null, voice = null, initPromise = null, loadChain = Promise.resolve()
const plan = new VoiceClientPlan(() => new Error('voice runtime was released'))
const jobs = new Map() // Host message handles; admission, FIFO and cancellation are Rust.
let drainDone = Promise.resolve()
let durationOutput = null
let bootstrapDiagnostics = false

const post = (message, transfer = []) => self.postMessage(message, transfer)
// Finite receipts at original await boundaries, enabled only by the native
// diagnostic bridge. No text, PCM, timers, polling or playback changes.
const stage = (domain, stage, id, part = 0) => { if (plan.pointer ? plan.diagnostics : bootstrapDiagnostics) post({type:'stage',domain,stage,id,part}) }
// A segment of compute blocks this thread; yielding between segments lets 'cancel'/'load' messages in before the next one.

async function init({ ortBase, phonBase, runtime }) {
  // Module/phonemizer/core startup remains parallel. A late phonemizer must
  // not outlive an init failure or an explicit free during initialization.
  const generation = plan.capture()
  phonBaseURL = phonBase
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
    ort = module; phonemizer = phon
  } catch (error) {
    released = true
    try { localPhon?.destroy() } catch {}
    throw error
  }
}

async function releaseVoice() {
  const oldSession = session, oldHebrew = hebrewPhonemizer, oldSupertonic = supertonicRuntime
  session = null; hebrewPhonemizer = null; supertonicRuntime = null; config = null; voice = null
  if (plan.pointer) plan.model(3)
  if (oldSession) await oldSession.release().catch(() => {})
  if (oldHebrew) await oldHebrew.destroy().catch(() => {})
  if (oldSupertonic) await Promise.resolve(oldSupertonic.dispose()).catch(() => {})
}

async function load({ voice: key, config: cfg, model, phonemizerModel, buffers }) {
  while (plan.draining) await drainDone // a cancelled synth finishes its segment first
  await releaseVoice()
  const t = performance.now(), kind = plan.classifyRuntime(cfg)
  // Every fragment has another length, so the shapes change on each run. With the memory arena and the memory-pattern planner
  // on (ort's defaults) each new shape keeps its buffers and the WASM heap only grows: a phone's WebView runs out of memory
  // after a sentence or two and the worker dies. Off, buffers are freed after every run (a little slower, flat memory).
  try {
    if (kind === 2) {
      supertonicRuntime = await createSupertonicRuntime({ ort, buffers, config:cfg.config, indexer:cfg.indexer, styles:cfg.styles })
      config = cfg; voice = key; plan.model(2, key)
      return { createMs:performance.now() - t }
    }
    if (!phonemizer && kind !== 1) phonemizer = await createPhonemizer({ base:phonBaseURL })
    if (kind === 1) {
      hebrewPhonemizer = await createHebrewPhonemizer({ ort, model: phonemizerModel, config: cfg })
    }
    const aligned = exposePiperDurations(new Uint8Array(model))
    durationOutput = aligned.name
    session = await ort.InferenceSession.create(aligned.bytes, { executionProviders: ['wasm'], graphOptimizationLevel: 'all', enableCpuMemArena: false, enableMemPattern: false })
  } catch (error) {
    await releaseVoice()
    throw error
  }
  config = cfg; voice = key; plan.model(2, key)
  return { createMs: performance.now() - t, inputs: session.inputNames }
}

async function runSegment(ids, { rate, speaker }) {
  const scales = piperScales(config.inference || {}, rate)
  const feeds = {
    input: new ort.Tensor('int64', BigInt64Array.from(ids, BigInt), [1, ids.length]),
    input_lengths: new ort.Tensor('int64', BigInt64Array.from([BigInt(ids.length)]), [1]),
    scales: new ort.Tensor('float32', scales, [3])
  }
  if (session.inputNames.includes('sid')) feeds.sid = new ort.Tensor('int64', BigInt64Array.from([BigInt(speaker || 0)]), [1])
  const out = await session.run(feeds)
  const tensor = out[session.outputNames[0]]
  const pcm = new Float32Array(tensor.data) // a copy: the tensor's buffer lives in the wasm heap
  const durations = durationOutput && out[durationOutput] ? new Float32Array(out[durationOutput].data) : null
  for (const value of Object.values(out)) value.dispose?.()
  for (const value of Object.values(feeds)) value.dispose?.()
  return {pcm,durations}
}

async function synth({ id, text, rate, speaker, lang, style, marks = [] }) {
  if (supertonicRuntime) {
    post({ type:'plan', id, counts:[Math.max(1, [...text].length)] })
    const t = performance.now()
    stage(3,3,id)
    const { pcm:raw, sampleRate, marks:timeline = [] } = await supertonicRuntime.synthesize(text, { lang, style, rate, marks, isActive:() => plan.workerActive(id) })
    stage(3,4,id)
    if (!plan.workerActive(id)) return
    if (!(raw instanceof Float32Array) || !(sampleRate > 0)) throw new Error('invalid Supertonic audio')
    // The SDK deliberately returns no samples when normalization removes all
    // speakable text (for example an ornament). Keep Piper's short-rest policy.
    if (!raw.length) {
      const pcm = silence(sampleRate, 120)
      post({ type:'chunk', id, index:0, last:true, pcm, sampleRate, ms:performance.now() - t }, [pcm.buffer])
      return
    }
    const done = finishSupertonic(raw, text, timeline, { sampleRate, rate })
    if (!done) throw new Error('invalid Supertonic audio') // a sample that is not a number
    post({ type:'chunk', id, index:0, last:true, pcm:done.pcm, sampleRate, ms:performance.now() - t, marks:done.marks }, [done.pcm.buffer])
    // Inference already yields between its steps. This fragment is complete:
    // deliver 'end' now so the page can request its next prefetched fragment.
    return
  }
  const sampleRate = config.audio.sample_rate
  stage(3,1,id)
  const phonemize = async value => limitIds(plan.runtimeKind === 1 ? await hebrewPhonemizer.phonemize(value) : await phonemizer.phonemize(value, config.espeak.voice),config.num_symbols)
  const ids = await phonemize(text)
  if (!plan.workerActive(id)) return
  const points = durationOutput ? await phonemeMarks(text,marks,ids,phonemize) : []
  stage(3,2,id)
  if (!plan.workerActive(id)) return
  const segments = splitSegments(ids)
  if (!segments.length) { // nothing speakable ("...", an ornament): a short rest keeps the reading flowing
    post({ type: 'plan', id, counts: [0] })
    const pcm = silence(sampleRate, 120)
    post({ type: 'chunk', id, index: 0, last: true, pcm, sampleRate, ms: 0 }, [pcm.buffer])
    return
  }
  post({ type: 'plan', id, counts: segments.map(ids => ids.length) })
  let base = 0
  for (let index = 0; index < segments.length; index++) {
    if (!plan.workerActive(id)) return
    const t = performance.now()
    stage(3,3,id,index)
    const {pcm:raw,durations} = await runSegment(segments[index], { rate, speaker })
    stage(3,4,id,index)
    if (!plan.workerActive(id)) return
    const last = index === segments.length - 1
    // Cleaned, its page boundaries placed, sped up, and with its rests: sentences of one fragment are separated by a rest at
    // their start; the rest after the fragment comes with its last one (both shorten with the speaking rate, like the speech).
    const done = finishPiper(raw, durations, points, text, { sampleRate, model:voice, rate, last, first:index === 0,
      base, count:segments[index].length })
    base += segments[index].length
    if (!plan.workerActive(id)) return
    post({ type: 'chunk', id, index, last, pcm:done.pcm, sampleRate, ms:performance.now()-t, marks:done.marks }, [done.pcm.buffer])
    stage(3,5,id,index)
    await yieldToMessages()
    stage(3,6,id,index)
  }
}

async function drain() {
  let finishDrain
  drainDone = new Promise(resolve => { finishDrain = resolve })
  try {
    for (let id = plan.take(); !Number.isNaN(id); id = plan.take()) {
      const job = jobs.get(id); jobs.delete(id)
      if (!plan.workerActive(id)) continue
      try {
        if (!session && !supertonicRuntime) throw new Error('no voice loaded')
        await synth(job)
        stage(3,7,job.id)
        if (plan.workerActive(id)) post({ type:'end', id })
      } catch (error) {
        if (plan.workerActive(id)) post({ type:'error', id, error:String(error?.stack || error) })
      }
      plan.cancel(id)
    }
  } finally { plan.stopDraining(); finishDrain() }
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
      post({ type:'ready', id:m.id, version:ort.env.versions?.common, crossOriginIsolated:self.crossOriginIsolated })
    } else if (command === 2) {
      await initPromise
      if (!plan.pointer) throw new Error('no voice runtime initialized')
      const loading = loadChain.then(async () => { stage(2,1,m.id); const result = await load(m); stage(2,2,m.id); return result })
      loadChain = loading.catch(() => {})
      post({ type:'loaded', id:m.id, ...(await loading) })
    } else if (command === 3) {
      if (!plan.pointer) throw new Error('no voice loaded')
      const action = plan.enqueue(m.id)
      if (action === 2) throw new Error('invalid synthesis request id')
      if (action === 3) return // retransmission of an owned request, never infer twice
      jobs.set(m.id,m)
      if (action === 1) drain()
    } else if (command === 4) {
      plan.cancel(m.id)
    } else if (command === 5) {
      const freeing = loadChain.then(async () => {
        while (plan.draining) await drainDone
        await releaseVoice()
        plan.invalidate(); jobs.clear()
      })
      loadChain = freeing.catch(() => {})
      await freeing
      post({ type:'freed', id:m.id })
    }
  } catch (error) { post({ type:'error', id:m.id, error:String(error?.stack || error) }) }
}
