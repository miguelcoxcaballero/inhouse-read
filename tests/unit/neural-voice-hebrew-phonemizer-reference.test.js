// @vitest-environment node
import { expect, it } from 'vitest'
import { createHebrewPhonemizer } from '../../src/js/readers/neural-voice/hebrew.js'
import { createHebrewPhonemizer as frozen } from './helpers/reference-hebrew.js'

// The Hebrew phonemizer's session checks, queue, inference and release (rust-ui voice_hebrew.rs) against the frozen
// JavaScript: the same recording fake of ONNX Runtime, the same calls, tensors, releases, ids and errors, in order.
const CONFIG = { phoneme_id_map:{ _:[0], '^':[1], $:[2], a:[3], b:[4], ʃ:[5], l:[6], o:[7], m:[8], ' ':[9] } }
function fixture(plan = {}) {
  const log = [], tensors = []
  class Tensor {
    constructor(type, data, dims) { Object.assign(this, { type, data, dims }); tensors.push(this); log.push(['tensor', type, Array.from(data), Array.from(dims)]) }
    dispose() { log.push(['dispose', tensors.indexOf(this)]) }
  }
  const output = (count, width, pick) => new Tensor('float32', Float32Array.from({ length:count * width }, (_, i) => (i % width) === pick(Math.floor(i / width)) ? 1 : 0), [1, count, width])
  const session = {
    inputNames:plan.inputNames ?? ['input_1'], outputNames:plan.outputNames ?? ['S', 'N', 'D'],
    run: async feeds => {
      const [name, input] = Object.entries(feeds)[0]
      log.push(['run', name, tensors.indexOf(input)])
      await plan.beforeRun?.()
      if (plan.runFails) throw Error('inference')
      const count = input.dims[1]
      return { N:output(count, 16, i => (i * 3) % 16), D:output(count, 3, i => i % 3), S:output(count, 4, i => i % 4), extra:plan.extra ? new Tensor('float32', [0], [1]) : undefined }
    },
    release: async () => { log.push(['release']); if (plan.releaseFails) throw Error('release') }
  }
  const ort = { Tensor, InferenceSession:{ create: async (bytes, options) => { log.push(['create', Array.from(bytes), JSON.stringify(options)]); return plan.session === undefined ? session : plan.session } } }
  return { ort, log }
}
const outcome = async promise => { try { return { value:await promise } } catch (error) { return { error:String(error?.message) } } }
async function session(create, plan, script) {
  const f = fixture(plan)
  const made = await outcome(create({ ort:f.ort, model:plan.model ?? Uint8Array.of(11, 12).buffer, config:plan.config ?? CONFIG }))
  if (made.error) return { log:f.log, made }
  return { log:f.log, results:await script(made.value) }
}
const both = async (plan, script) => expect(await session(createHebrewPhonemizer, plan, script)).toEqual(await session(frozen, plan, script))

it('phonemizes pointed, unpointed, empty and mixed texts like the original, one at a time', async () => {
  const texts = ['שלום עולם', 'שָׁלוֹם', '', null, 'abc', 'בְּרֵאשִׁית בָּרָא', '🙂שלום', 'ש\ud800ל', 42]
  for (const extra of [false, true]) await both({ extra }, async phon => {
    const jobs = texts.map(text => outcome(phon.phonemize(text)))
    const done = await Promise.all(jobs)
    return [done, await outcome(phon.destroy()), await outcome(phon.destroy()), await outcome(phon.phonemize('שלום'))]
  })
})
it('releases the input when inference fails, and stops queued work once destroyed', async () => {
  await both({ runFails:true }, async phon => [await outcome(phon.phonemize('שלום')), await outcome(phon.phonemize('שָׁלוֹם')), await outcome(phon.destroy())])
  let open
  await both({ beforeRun:() => new Promise(resolve => { open = resolve }) }, async phon => {
    const first = outcome(phon.phonemize('שלום')), second = outcome(phon.phonemize('עולם'))
    await new Promise(resolve => setTimeout(resolve, 0))
    const destroying = outcome(phon.destroy()); open()
    return [await first, await second, await destroying]
  })
  await both({ releaseFails:true }, async phon => [await outcome(phon.destroy())])
})
it('rejects missing models, maps and broken sessions like the original', async () => {
  for (const plan of [{ model:new Uint8Array(2) }, { model:new ArrayBuffer(0) }, { config:{} }, { config:{ phoneme_id_map:{ _:[0], '^':[], $:[2] } } },
    { inputNames:[] }, { outputNames:['N', 'D'] }, { outputNames:undefined }, { inputNames:undefined }, { session:null }, { inputNames:[], releaseFails:true }]) {
    await both(plan, async () => [])
  }
  for (const args of [undefined, null, {}]) expect(await outcome(createHebrewPhonemizer(args))).toEqual(await outcome(frozen(args)))
})
