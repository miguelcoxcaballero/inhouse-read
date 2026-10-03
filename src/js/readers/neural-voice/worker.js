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
import { createHebrewPhonemizer } from './hebrew.js'
import { createSupertonicRuntime } from './supertonic-runtime.js'
import { yieldToMessages } from './task-yield.js'
import { peakNormalize, trimSilence, fadeEdges, silence, concat, pauseAfter, splitSegments, limitIds, lengthScaleFor, PAUSE_MS } from './pcm.js'

let ort = null, phonemizer = null, phonBaseURL = null, hebrewPhonemizer = null, supertonicRuntime = null, session = null, config = null, voice = null, initPromise = null, loadChain = Promise.resolve()
const cancelled = new Set()
const queue = []
let draining = false, current = null, drainDone = Promise.resolve()
let diagnostics = false

const post = (message, transfer = []) => self.postMessage(message, transfer)
// Finite receipts at original await boundaries, enabled only by the native
// diagnostic bridge. No text, PCM, timers, polling or playback changes.
const stage = (domain, stage, id, part = 0) => { if (diagnostics) post({type:'stage',domain,stage,id,part}) }
// A segment of compute blocks this thread; yielding between segments lets 'cancel'/'load' messages in before the next one.

async function init({ ortBase, phonBase, runtime }) {
  // ONNX Runtime and the phonemizer are independent: load them side by side (a cold start is the sum of everything serial).
  phonBaseURL = phonBase
  const [module, phon] = await Promise.all([import(/* @vite-ignore */ ortBase + 'ort.wasm.min.mjs'), runtime === 'supertonic3' ? null : createPhonemizer({ base: phonBase })])
  ort = module
  ort.env.wasm.wasmPaths = ortBase       // ort-wasm-simd-threaded.{mjs,wasm}: our own copy, never a CDN
  ort.env.wasm.numThreads = 1            // 1 => never needs SharedArrayBuffer / COOP+COEP
  ort.env.wasm.proxy = false             // we ARE the worker already
  phonemizer = phon
}

async function releaseVoice() {
  const oldSession = session, oldHebrew = hebrewPhonemizer, oldSupertonic = supertonicRuntime
  session = null; hebrewPhonemizer = null; supertonicRuntime = null; config = null; voice = null
  if (oldSession) await oldSession.release().catch(() => {})
  if (oldHebrew) await oldHebrew.destroy().catch(() => {})
  if (oldSupertonic) await Promise.resolve(oldSupertonic.dispose()).catch(() => {})
}

async function load({ voice: key, config: cfg, model, phonemizerModel, buffers }) {
  while (draining) await drainDone // a cancelled synth finishes its segment first
  await releaseVoice()
  const t = performance.now()
  // Every fragment has another length, so the shapes change on each run. With the memory arena and the memory-pattern planner
  // on (ort's defaults) each new shape keeps its buffers and the WASM heap only grows: a phone's WebView runs out of memory
  // after a sentence or two and the worker dies. Off, buffers are freed after every run (a little slower, flat memory).
  try {
    if (cfg.runtime === 'supertonic3') {
      supertonicRuntime = await createSupertonicRuntime({ ort, buffers, config:cfg.config, indexer:cfg.indexer, styles:cfg.styles })
      config = cfg; voice = key
      return { createMs:performance.now() - t }
    }
    if (!phonemizer && cfg.phoneme_type !== 'hebrew') phonemizer = await createPhonemizer({ base:phonBaseURL })
    if (cfg.phoneme_type === 'hebrew') hebrewPhonemizer = await createHebrewPhonemizer({ ort, model: phonemizerModel, config: cfg })
    session = await ort.InferenceSession.create(new Uint8Array(model), { executionProviders: ['wasm'], graphOptimizationLevel: 'all', enableCpuMemArena: false, enableMemPattern: false })
  } catch (error) {
    await releaseVoice()
    throw error
  }
  config = cfg; voice = key
  return { createMs: performance.now() - t, inputs: session.inputNames }
}

async function runSegment(ids, { rate, speaker }) {
  const inference = config.inference || {}
  const scales = Float32Array.from([inference.noise_scale ?? 0.667, lengthScaleFor(inference.length_scale ?? 1, rate), inference.noise_w ?? 0.8])
  const feeds = {
    input: new ort.Tensor('int64', BigInt64Array.from(ids, BigInt), [1, ids.length]),
    input_lengths: new ort.Tensor('int64', BigInt64Array.from([BigInt(ids.length)]), [1]),
    scales: new ort.Tensor('float32', scales, [3])
  }
  if (session.inputNames.includes('sid')) feeds.sid = new ort.Tensor('int64', BigInt64Array.from([BigInt(speaker || 0)]), [1])
  const out = await session.run(feeds)
  const tensor = out[session.outputNames[0]]
  const pcm = new Float32Array(tensor.data) // a copy: the tensor's buffer lives in the wasm heap
  tensor.dispose?.()
  return pcm
}

async function synth({ id, text, rate, speaker, lang, style }) {
  if (supertonicRuntime) {
    post({ type:'plan', id, counts:[Math.max(1, [...text].length)] })
    const t = performance.now()
    stage(3,3,id)
    const { pcm:raw, sampleRate } = await supertonicRuntime.synthesize(text, { lang, style, rate, isActive:() => !cancelled.has(id) })
    stage(3,4,id)
    if (cancelled.has(id)) return
    if (!(raw instanceof Float32Array) || !raw.every(Number.isFinite) || !(sampleRate > 0)) throw new Error('invalid Supertonic audio')
    // The SDK deliberately returns no samples when normalization removes all
    // speakable text (for example an ornament). Keep Piper's short-rest policy.
    if (!raw.length) {
      const pcm = silence(sampleRate, 120)
      post({ type:'chunk', id, index:0, last:true, pcm, sampleRate, ms:performance.now() - t }, [pcm.buffer])
      await yieldToMessages()
      return
    }
    peakNormalize(raw)
    const speech = fadeEdges(trimSilence(raw, sampleRate), sampleRate)
    const rest = 1 / Math.min(3, Math.max(0.5, Number(rate) || 1))
    const pcm = concat([speech, silence(sampleRate, pauseAfter(text) * rest)])
    post({ type:'chunk', id, index:0, last:true, pcm, sampleRate, ms:performance.now() - t }, [pcm.buffer])
    await yieldToMessages()
    return
  }
  const sampleRate = config.audio.sample_rate
  stage(3,1,id)
  const ids = config.phoneme_type === 'hebrew' ? await hebrewPhonemizer.phonemize(text) : await phonemizer.phonemize(text, config.espeak.voice)
  stage(3,2,id)
  const segments = splitSegments(limitIds(ids, config.num_symbols))
  if (!segments.length) { // nothing speakable ("...", an ornament): a short rest keeps the reading flowing
    post({ type: 'plan', id, counts: [0] })
    const pcm = silence(sampleRate, 120)
    post({ type: 'chunk', id, index: 0, last: true, pcm, sampleRate, ms: 0 }, [pcm.buffer])
    return
  }
  post({ type: 'plan', id, counts: segments.map(ids => ids.length) })
  for (let index = 0; index < segments.length; index++) {
    if (cancelled.has(id)) return
    const t = performance.now()
    stage(3,3,id,index)
    const raw = await runSegment(segments[index], { rate, speaker })
    stage(3,4,id,index)
    const ms = performance.now() - t
    peakNormalize(raw, { model:voice })
    const speech = fadeEdges(trimSilence(raw, sampleRate), sampleRate)
    const last = index === segments.length - 1
    // Sentences of one fragment are separated by a rest at their start; the rest after the fragment comes with its last one.
    // (the rests shorten with the speaking rate, like the speech does)
    const rest = 1 / Math.min(3, Math.max(0.5, Number(rate) || 1))
    const pcm = concat([index ? silence(sampleRate, PAUSE_MS.sentence * rest) : new Float32Array(0), speech, last ? silence(sampleRate, pauseAfter(text) * rest) : new Float32Array(0)])
    if (cancelled.has(id)) return
    post({ type: 'chunk', id, index, last, pcm, sampleRate, ms }, [pcm.buffer])
    stage(3,5,id,index)
    await yieldToMessages()
    stage(3,6,id,index)
  }
}

async function drain() {
  if (draining) return
  draining = true
  let finishDrain
  drainDone = new Promise(resolve => { finishDrain = resolve })
  try {
  while (queue.length) {
    const job = queue.shift()
    if (cancelled.has(job.id)) { cancelled.delete(job.id); continue }
    current = job.id
    try {
      if (!session && !supertonicRuntime) throw new Error('no voice loaded')
      await synth(job)
      stage(3,7,job.id)
      if (!cancelled.has(job.id)) post({ type: 'end', id: job.id })
    } catch (error) {
      if (!cancelled.has(job.id)) post({ type: 'error', id: job.id, error: String(error?.stack || error) })
    }
    cancelled.delete(job.id)
  }
  } finally {
    current = null
    draining = false
    finishDrain()
  }
}

self.onmessage = async ({ data: m }) => {
  try {
    if (m.type === 'init') {
      diagnostics = m.diagnostics === true
      stage(1,1,m.id)
      await (initPromise ||= init(m))
      stage(1,2,m.id)
      post({ type: 'ready', id: m.id, version: ort.env.versions?.common, crossOriginIsolated: self.crossOriginIsolated })
    } else if (m.type === 'load') {
      await initPromise
      // One load at a time: two overlapping loads (the voice changed while the first model was still loading) would both
      // see "no session", and the first session would leak (~150 MB) when the second one overwrote it.
      const loading = loadChain.then(async () => { stage(2,1,m.id); const result = await load(m); stage(2,2,m.id); return result })
      loadChain = loading.catch(() => {})
      post({ type: 'loaded', id: m.id, ...(await loading) })
    } else if (m.type === 'synth') {
      queue.push(m); drain()
    } else if (m.type === 'cancel') {
      if (current === m.id || queue.some(job => job.id === m.id)) cancelled.add(m.id)
    } else if (m.type === 'free') {
      const freeing = loadChain.then(async () => {
        while (draining) await drainDone
        await releaseVoice()
      })
      loadChain = freeing.catch(() => {})
      await freeing
      post({ type: 'freed', id: m.id })
    }
  } catch (error) {
    post({ type: 'error', id: m.id, error: String(error?.stack || error) })
  }
}
