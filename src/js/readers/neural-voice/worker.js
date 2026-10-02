// The synthesis worker. Everything heavy happens here, never on the page: onnxruntime-web (single-threaded WASM: GitHub
// Pages has no COOP/COEP, so no SharedArrayBuffer), the espeak-ng phonemizer, and the clean-up of the audio (peak
// normalisation, silence trimming). The page only receives transferable Float32Array chunks.
//
// ONE model session is alive at a time (a second voice replaces the first). Messages carry request ids.
//
//   page -> worker
//     {type:'init',  id, ortBase, phonBase}                   load onnxruntime-web (files of OUR site) and the phonemizer
//     {type:'load',  id, voice, config, model:ArrayBuffer}    create the session from the cached bytes (replaces the previous one)
//     {type:'synth', id, text, rate, speaker}                 speak `text`: replies with plan + chunks (below), queued FIFO
//     {type:'cancel', id}                                     forget a queued/running synth (a running segment finishes first)
//     {type:'free'}                                           release the session
//   worker -> page
//     {type:'ready'|'loaded'|'freed', id, ...}                answers to init / load / free
//     {type:'plan',  id, counts:[phoneme ids per sentence]}   right after phonemising, so the page can predict durations
//     {type:'chunk', id, index, last, pcm:Float32Array, sampleRate, ms}   one sentence of audio, ready to play (ms = compute time)
//     {type:'end',   id}                                      synth finished
//     {type:'error', id, error}                               anything that failed (the worker stays usable)
import { createPhonemizer } from './phonemizer.js'
import { peakNormalize, trimSilence, fadeEdges, silence, concat, pauseAfter, splitSegments, limitIds, lengthScaleFor, PAUSE_MS } from './pcm.js'

let ort = null, phonemizer = null, session = null, config = null, voice = null, initPromise = null
const cancelled = new Set()
const queue = []
let draining = false, current = null

const post = (message, transfer = []) => self.postMessage(message, transfer)
// A segment of compute blocks this thread; yielding between segments lets 'cancel'/'load' messages in before the next one.
const yieldToMessages = () => new Promise(resolve => setTimeout(resolve, 0))

async function init({ ortBase, phonBase }) {
  // ONNX Runtime and the phonemizer are independent: load them side by side (a cold start is the sum of everything serial).
  const [module, phon] = await Promise.all([import(/* @vite-ignore */ ortBase + 'ort.wasm.min.mjs'), createPhonemizer({ base: phonBase })])
  ort = module
  ort.env.wasm.wasmPaths = ortBase       // ort-wasm-simd-threaded.{mjs,wasm}: our own copy, never a CDN
  ort.env.wasm.numThreads = 1            // 1 => never needs SharedArrayBuffer / COOP+COEP
  ort.env.wasm.proxy = false             // we ARE the worker already
  phonemizer = phon
}

async function load({ voice: key, config: cfg, model }) {
  while (draining) await new Promise(resolve => setTimeout(resolve, 5)) // a cancelled synth finishes its segment first
  if (session) { await session.release().catch(() => {}); session = null }
  const t = performance.now()
  session = await ort.InferenceSession.create(new Uint8Array(model), { executionProviders: ['wasm'], graphOptimizationLevel: 'all' })
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

async function synth({ id, text, rate, speaker }) {
  const sampleRate = config.audio.sample_rate
  const segments = splitSegments(limitIds(phonemizer.phonemize(text, config.espeak.voice), config.num_symbols))
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
    const raw = await runSegment(segments[index], { rate, speaker })
    const ms = performance.now() - t
    peakNormalize(raw)
    const speech = fadeEdges(trimSilence(raw, sampleRate), sampleRate)
    const last = index === segments.length - 1
    // Sentences of one fragment are separated by a rest at their start; the rest after the fragment comes with its last one.
    // (the rests shorten with the speaking rate, like the speech does)
    const rest = 1 / Math.min(3, Math.max(0.5, Number(rate) || 1))
    const pcm = concat([index ? silence(sampleRate, PAUSE_MS.sentence * rest) : new Float32Array(0), speech, last ? silence(sampleRate, pauseAfter(text) * rest) : new Float32Array(0)])
    if (cancelled.has(id)) return
    post({ type: 'chunk', id, index, last, pcm, sampleRate, ms }, [pcm.buffer])
    await yieldToMessages()
  }
}

async function drain() {
  if (draining) return
  draining = true
  while (queue.length) {
    const job = queue.shift()
    if (cancelled.has(job.id)) { cancelled.delete(job.id); continue }
    current = job.id
    try {
      if (!session) throw new Error('no voice loaded')
      await synth(job)
      if (!cancelled.has(job.id)) post({ type: 'end', id: job.id })
    } catch (error) {
      if (!cancelled.has(job.id)) post({ type: 'error', id: job.id, error: String(error?.stack || error) })
    }
    cancelled.delete(job.id)
  }
  current = null
  draining = false
}

self.onmessage = async ({ data: m }) => {
  try {
    if (m.type === 'init') {
      await (initPromise ||= init(m))
      post({ type: 'ready', id: m.id, version: ort.env.versions?.common, crossOriginIsolated: self.crossOriginIsolated })
    } else if (m.type === 'load') {
      await initPromise
      post({ type: 'loaded', id: m.id, ...(await load(m)) })
    } else if (m.type === 'synth') {
      queue.push(m); drain()
    } else if (m.type === 'cancel') {
      if (current === m.id || queue.some(job => job.id === m.id)) cancelled.add(m.id)
    } else if (m.type === 'free') {
      if (session) { await session.release().catch(() => {}); session = null; voice = null }
      post({ type: 'freed', id: m.id })
    }
  } catch (error) {
    post({ type: 'error', id: m.id, error: String(error?.stack || error) })
  }
}
