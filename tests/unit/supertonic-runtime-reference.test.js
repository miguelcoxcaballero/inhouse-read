import { describe, expect, it } from 'vitest'
import { createSupertonicRuntime } from '../../src/js/readers/neural-voice/supertonic-runtime.js'
import { createSupertonicRuntime as frozen } from './helpers/reference-supertonic-runtime.js'
import { SUPERTONIC_STYLES } from '../../src/js/readers/neural-voice/supertonic-catalog.js'

// The orchestration of the Supertonic runtime (rust-ui voice_supertonic.rs) against the frozen JavaScript it replaced:
// both drive the same recording fake of ONNX Runtime, and every session made, run, tensor created or released, every
// result and every error must be the same, in the same order.
const names = ['duration_predictor', 'text_encoder', 'vector_estimator', 'vocoder']
function fixture(plan = {}) {
  const log = [], tensors = []
  const id = value => tensors.indexOf(value)
  const describe = feeds => Object.fromEntries(Object.entries(feeds).map(([key, value]) => [key, id(value)]))
  class Tensor {
    constructor(type, data, dims) {
      Object.assign(this, { type, data, dims }); tensors.push(this)
      log.push(['tensor', tensors.length - 1, type, Array.from(dims), data.length, Array.from(data.slice?.(0, 4) ?? []).map(String)])
    }
    dispose() { log.push(['dispose', id(this)]); if (plan.disposeThrows === id(this)) throw Error('dispose') }
  }
  let made = 0, runs = 0
  const create = async (bytes, options) => {
    const name = names[made++]
    log.push(['create', name, bytes.byteLength, JSON.stringify(options)])
    if (plan.createFails === name) throw Error(`compile ${name}`)
    return {
      release: async () => { log.push(['release', name]); if (plan.releaseFails === name) throw Error('release') },
      run: async feeds => {
        const call = runs++
        log.push(['run', name, call, describe(feeds)])
        await plan.beforeRun?.(name, call)
        if (name === 'duration_predictor') return { duration:new Tensor('float32', Float32Array.of(plan.duration?.(call) ?? 0.1 + call / 100), [1]) }
        if (name === 'text_encoder') return { text_emb:new Tensor('float32', Float32Array.of(1, 2), [1, 2]) }
        if (name === 'vector_estimator') return plan.noLatent ? {} : { denoised_latent:new Tensor('float32', new Float32Array(feeds.noisy_latent.data).map(v => v * 0.5), feeds.noisy_latent.dims) }
        const length = plan.samples ?? 10000
        const wav = new Float32Array(length).map((_, i) => Math.sin(i / 7) * 0.3)
        if (plan.nonFinite) wav[3] = NaN
        return { wav_tts:new Tensor('float32', wav, [1, length]) }
      }
    }
  }
  const style = { style_ttl:{ dims:[1, 1, 2], data:[[[0.1, 0.2]]] }, style_dp:{ dims:[1, 1, 2], data:[[[0.3, 0.4]]] } }
  const styles = plan.styles ?? Object.fromEntries(SUPERTONIC_STYLES.map(n => [n, style]))
  let seed = 7
  const args = {
    ort:{ Tensor, InferenceSession:{ create } }, buffers:Object.fromEntries(names.map(n => [n, new ArrayBuffer(4)])),
    config:{ ae:{ sample_rate:8000, base_chunk_size:16 }, ttl:{ chunk_compress_factor:2, latent_dim:2 } },
    indexer:Array.from({ length:65536 }, (_, i) => i % 97), styles, steps:plan.steps ?? 2,
    random:() => (seed = (seed * 16807) % 2147483647) / 2147483647,
    yieldToMessages:async () => { log.push(['yield']); await plan.onYield?.() }
  }
  return { args, log }
}
const outcome = async promise => {
  try { const value = await promise; return { value:value && { pcm:value.pcm && Array.from(value.pcm).map(String), marks:value.marks, sampleRate:value.sampleRate } } }
  catch (error) { return { error:String(error?.message), code:error?.code, name:error?.name } }
}
async function session(create, plan, script) {
  const f = fixture(plan)
  let live
  try { live = await create(f.args) } catch (error) { return { log:f.log, failed:String(error?.message) } }
  return { log:f.log, results:await script(live, f) }
}
const both = async (plan, script) => {
  const actual = await session(createSupertonicRuntime, plan, script), expected = await session(frozen, plan, script)
  expect(actual).toEqual(expected)
  return actual
}

describe('Supertonic runtime against the frozen JavaScript', () => {
  it('speaks single and multi-chunk utterances with marks at every rate', async () => {
    const long = 'Primera frase del capítulo. '.repeat(14) + 'Y la última, más corta.'
    for (const rate of [1, 1.25, 2, 0.5]) {
      const done = await both({}, async runtime => [
        await outcome(runtime.synthesize('Hola mundo.', { lang:'es', style:'M1', rate })),
        await outcome(runtime.synthesize(long, { lang:'es', style:'F2', rate, marks:[0, 28, 300, 301, long.length - 3] })),
        await outcome(runtime.synthesize('안녕하세요. '.repeat(30), { lang:'ko', rate, marks:[5, 120] })),
        await outcome(runtime.synthesize('...', { lang:'en', rate })),
        await outcome(runtime.synthesize('', { lang:'en' })),
        await outcome(runtime.dispose()), await outcome(runtime.dispose())
      ])
      expect(done.results[1].value.marks.length).toBeGreaterThan(2)
    }
  })
  it('rejects options, overlaps, oversized audio and broken model outputs like the original', async () => {
    await both({}, async runtime => [
      await outcome(runtime.synthesize('Hola', { lang:'es', style:'fake' })), await outcome(runtime.synthesize('Hola', { lang:'es', rate:0 })),
      await outcome(runtime.synthesize('Hola', { lang:'xx' })), await outcome(runtime.synthesize('Hola', { lang:'es', rate:'1' })),
      await outcome(runtime.synthesize('Hola')), await outcome(runtime.synthesize('x '.repeat(5000), { lang:'es' })),
      await outcome(runtime.dispose())
    ])
    await both({ duration:() => 1000 }, async runtime => [await outcome(runtime.synthesize('Hola', { lang:'es' })), await outcome(runtime.dispose())])
    await both({ noLatent:true }, async runtime => [await outcome(runtime.synthesize('Hola', { lang:'es' })), await outcome(runtime.dispose())])
    await both({ samples:0 }, async runtime => [await outcome(runtime.synthesize('Hola', { lang:'es' })), await outcome(runtime.dispose())])
    await both({ nonFinite:true }, async runtime => [await outcome(runtime.synthesize('Hola', { lang:'es' })), await outcome(runtime.dispose())])
    await both({ duration:call => call === 0 ? 0.2 : (call % 2 ? -1 : NaN) }, async runtime => [await outcome(runtime.synthesize('Uno dos tres.', { lang:'es', marks:[4, 8] })), await outcome(runtime.dispose())])
  })
  it('cancels at every inference boundary and releases what it made', async () => {
    for (let at = 0; at < 9; at++) {
      let active = true
      await both({ beforeRun:(_, call) => { if (call === at) active = false } }, async runtime => {
        active = true
        const first = await outcome(runtime.synthesize('Hola mundo.', { lang:'es', marks:[5], isActive:() => active }))
        active = true
        return [first, await outcome(runtime.synthesize('Otra frase.', { lang:'es' })), await outcome(runtime.dispose())]
      })
    }
  })
  it('waits for the running utterance before releasing, and rejects a second one meanwhile', async () => {
    let open
    await both({ beforeRun:async (name, call) => { if (call === 0) await new Promise(resolve => { open = resolve }) } }, async runtime => {
      const running = runtime.synthesize('Hola', { lang:'es' })
      await new Promise(resolve => setTimeout(resolve, 0))
      const second = await outcome(runtime.synthesize('Otra', { lang:'es' }))
      const disposing = runtime.dispose(); open()
      return [second, await outcome(running), await outcome(disposing), await outcome(runtime.synthesize('Tarde', { lang:'es' }))]
    })
  })
  it('cleans up when creation fails at any step, styles included', async () => {
    for (const createFails of names) await both({ createFails }, async () => [])
    await both({ styles:{} }, async () => [])
    const bad = { style_ttl:{ dims:[1, 1, 3], data:[[[0.1, 0.2]]] }, style_dp:{ dims:[1, 1, 2], data:[[[0.3, 0.4]]] } }
    const good = { style_ttl:{ dims:[1, 1, 2], data:[[[0.1, 0.2]]] }, style_dp:{ dims:[1, 1, 2], data:[[[0.3, 0.4]]] } }
    await both({ styles:Object.fromEntries(SUPERTONIC_STYLES.map((n, i) => [n, i === 4 ? bad : good])) }, async () => [])
    await both({ styles:Object.fromEntries(SUPERTONIC_STYLES.map((n, i) => [n, i === 4 ? { style_ttl:good.style_ttl, style_dp:{ dims:[1, 1, 2], data:'xy' } } : good])) }, async () => [])
    await both({ releaseFails:'text_encoder', createFails:'vocoder' }, async () => [])
    await both({ releaseFails:'vocoder' }, async runtime => [await outcome(runtime.dispose())])
  })
  it('rejects broken arguments without touching the model', async () => {
    for (const args of [undefined, null, {}, { ort:{} }, { ort:{ InferenceSession:{}, Tensor:class {} }, indexer:{} }]) {
      expect(await outcome(createSupertonicRuntime(args))).toEqual(await outcome(frozen(args)))
    }
  })
})
