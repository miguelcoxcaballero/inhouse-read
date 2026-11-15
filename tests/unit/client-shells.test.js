// What the constructors of the two synthesis clients build is rust-ui client_shells.rs. This differential runs the
// frozen JavaScript constructors and the Rust ones over the same dependencies and a recording ledger class, and
// compares the fields in their order, every default, what the ledger was given and what its `released` makes.
import { describe, expect, it } from 'vitest'
import { rustUI as ui } from './helpers/rust-ui-ready.js'
import { referenceNativeConstruct, referenceSynthConstruct } from './helpers/reference-client-shells.js'

const plain = events => JSON.parse(JSON.stringify(events, (key, value) => value === undefined ? '<undefined>' : typeof value === 'function' ? `<function ${value.name}>` : value))
const both = async scene => {
  const outcomes = {}
  for (const engine of ['JavaScript', 'Rust']) { const events = []; await scene(engine, events); outcomes[engine] = plain(events) }
  expect(outcomes.Rust).toEqual(outcomes.JavaScript)
  expect(outcomes.Rust.length).toBeGreaterThan(0)
}
const none = async () => null

describe('constructor of the worker client', () => {
  const full = () => ({ createWorker() {}, ortBase:'ort/', phonBase:'phon/', readModel() {}, readConfig() {}, readPhonemizerModel() {}, readRuntimeAssets() {}, onStage() {}, extra:1 })
  const cases = {
    'every dependency': () => full(),
    'only what the engine must give': () => ({ createWorker() {}, ortBase:'ort/', phonBase:'phon/', readModel() {}, readConfig() {} }),
    'an empty object': () => ({}),
    'null and false are kept, undefined takes the default': () => ({ ...full(), readPhonemizerModel:null, readRuntimeAssets:undefined, onStage:false }),
    'getters are read once, in order': events => { const deps = {}; for (const name of ['onStage', 'readConfig', 'createWorker', 'readRuntimeAssets', 'ortBase', 'readModel', 'phonBase', 'readPhonemizerModel']) Object.defineProperty(deps, name, { enumerable:true, get() { events.push(['read', name]); return name } }); return deps },
    'a string': () => 'deps',
    'undefined': () => undefined,
    'null': () => null,
  }
  it.each(Object.keys(cases))('%s', async name => {
    await both(async (engine, events) => {
      class VoiceClientPlan { constructor(...args) { events.push(['plan', args.length, typeof args[0]]); this.released = args[0] } }
      const client = {}, deps = cases[name](events)
      try {
        if (engine === 'Rust') ui.synth_client_construct(client, deps, { VoiceClientPlan, none }); else referenceSynthConstruct.call(client, ui, VoiceClientPlan, deps)
      } catch (error) { events.push(['threw', error.constructor.name]); return }
      events.push(['keys', Object.keys(client)])
      events.push(['values', ...['createWorker', 'ortBase', 'phonBase', 'readModel', 'readConfig', 'onStage', 'worker', 'loaded', 'ready', 'loading'].map(key => client[key])])
      for (const key of ['readPhonemizerModel', 'readRuntimeAssets']) events.push([key, typeof client[key], deps && deps[key] !== undefined ? client[key] === deps[key] : await client[key]()])
      events.push(['state', client.plan instanceof VoiceClientPlan, client.calls instanceof Map, client.calls.size, client.jobs instanceof Map, client.jobs.size, client.calls !== client.jobs,
        client.preparationChain instanceof Promise, await client.preparationChain, client.preparations instanceof Set, client.preparations.size])
      const released = client.plan.released()
      events.push(['released', released instanceof Error, released.message, released.code, Object.keys(released), client.plan.released() !== released])
    })
  })
})

describe('constructor of the Android client', () => {
  const createNativeOrt = () => {}, createPhonemizer = () => {}
  const cases = {
    'no dependencies': () => undefined,
    'an empty object': () => ({}),
    'every dependency': () => ({ store:{ id:'store' }, phonBase:'https://example.test/phon/', env:{ id:'env' }, createOrt() {}, createPhon() {}, extra:1 }),
    'null and false are kept, undefined takes the default': () => ({ store:null, phonBase:0, env:null, createOrt:false, createPhon:undefined }),
    'getters are read once, in order': events => { const deps = {}; for (const name of ['createPhon', 'env', 'store', 'createOrt', 'phonBase']) Object.defineProperty(deps, name, { enumerable:true, get() { events.push(['read', name]); return name === 'env' ? undefined : name } }); return deps },
    'null': () => null,
    'a string': () => 'deps',
  }
  it.each(Object.keys(cases))('%s', async name => {
    await both((engine, events) => {
      class VoiceClientPlan { constructor(...args) { events.push(['plan', args.length, typeof args[0], JSON.stringify(args[1]), args[2]]); this.released = args[0] } }
      const kit = { createNativeOrt, createPhonemizer, VoiceClientPlan }, client = {}, deps = cases[name](events)
      try {
        if (engine === 'Rust') ui.native_client_construct(client, deps, kit); else referenceNativeConstruct.call(client, kit, deps)
      } catch (error) { events.push(['threw', error.constructor.name]); return }
      events.push(['keys', Object.keys(client)])
      events.push(['values', client.store, client.phonBase, client.env === globalThis ? '<globalThis>' : client.env,
        client.createOrt === createNativeOrt ? '<createNativeOrt>' : client.createOrt, client.createPhon === createPhonemizer ? '<createPhonemizer>' : client.createPhon])
      events.push(['state', client.plan instanceof VoiceClientPlan, client.jobs instanceof Map, client.jobs.size, client.loading, client.loaded, client.config, client.ort,
        client.chain instanceof Promise, client.preparationChain instanceof Promise, client.chain !== client.preparationChain])
      const released = client.plan.released()
      events.push(['released', released instanceof Error, released.message, released.code, Object.keys(released), client.plan.released() !== released])
    })
  })
})
