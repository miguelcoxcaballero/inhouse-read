// prepare() of the two synthesis clients is rust-ui client_prepare.rs. This differential runs the frozen JavaScript
// methods and the Rust ones over the same recording client, ledger and preparation flow, through scripted sequences of
// calls, settlements and releases, and compares every ledger call, state change and settlement at its microtask step.
import { describe, expect, it } from 'vitest'
import { rustUI as ui } from './helpers/rust-ui-ready.js'
import { referenceNativePrepare, referenceSynthPrepare } from './helpers/reference-client-prepare.js'

/** The module as prepare() sees it: the preparation flows are recorded and settled by the script. */
function world(kind, engine) {
  const events = [], flows = []
  // Each flow reads the arguments its export declares (a bound export is also handed what the chain resolved with).
  const settle = (key, record) => { events.push(record); return new Promise((resolve, reject) => flows.push({ key, resolve, reject })) }
  const module = { ...ui, synth_client_prepare:(client, key, generation) => settle(key, ['flow', key, generation]),
    native_client_prepare:(client, key, generation, kit) => settle(key, ['flow', key, generation, kit.tag]) }
  let generation = 0
  const state = { preparing:null, model:null }
  const plan = {
    preparing:key => { events.push(['preparing?', key]); return state.preparing === key },
    model:(bit, key) => { events.push(['model?', bit, key]); return state.model === key },
    capture:() => { events.push(['capture']); return ++generation },
    beginPreparation:key => { events.push(['begin', key]); state.preparing = key },
    finishPreparation:() => { events.push(['finish']); state.preparing = null },
  }
  const client = { plan, loading:null, config:{ sample_rate:22050 }, preparationChain:Promise.resolve(), preparations:new Set() }
  const kit = { tag:'kit' }
  const prepare = kind === 'worker'
    ? (engine === 'Rust' ? key => ui.synth_client_begin(client, key, module) : key => referenceSynthPrepare.call(client, module, key))
    : (engine === 'Rust' ? key => ui.native_client_begin(client, key, kit, module) : key => referenceNativePrepare.call(client, module, kit, key))
  return { events, flows, client, state, prepare }
}
const tick = async (events, steps) => { for (let n = 0; n < steps; n++) { await Promise.resolve(); events.push(['tick', n]) } }
const watch = (events, label, promise) => { promise.then(value => events.push([label, 'resolved', value]), error => events.push([label, 'rejected', String(error?.message ?? error)])); return promise }
const shape = client => [client.loading ? Object.keys(client.loading) : null, client.loading ? Object.values(client.loading)[0] : null, client.preparations.size]

const scripts = {
  'prepares one voice and settles the ledger when it is ready': async ({ events, flows, client, prepare }) => {
    const first = watch(events, 'first', prepare('es')); events.push(['state', ...shape(client), client.loading.promise === first])
    await tick(events, 4); flows[0].resolve({ voice:'es' }); await tick(events, 6); events.push(['state', ...shape(client)])
  },
  'hands the same promise to a second call for the voice being prepared': async ({ events, flows, client, prepare }) => {
    const first = prepare('es'), second = prepare('es'); events.push(['same', first === second]); watch(events, 'first', first)
    await tick(events, 3); flows[0].resolve('config'); await tick(events, 6); events.push(['flows', flows.length, ...shape(client)])
  },
  'queues a second voice behind the first, also when the first fails': async ({ events, flows, client, prepare }) => {
    watch(events, 'first', prepare('es')); watch(events, 'second', prepare('en')); events.push(['state', ...shape(client)])
    await tick(events, 4); events.push(['flows', flows.length]); flows[0].reject(new Error('offline')); await tick(events, 8)
    events.push(['flows', flows.length, ...shape(client)]); flows[1]?.resolve('en-config'); await tick(events, 8); events.push(['state', ...shape(client)])
  },
  'keeps the ledger of the newer preparation when an older one settles late': async ({ events, flows, client, state, prepare }) => {
    watch(events, 'first', prepare('es')); await tick(events, 3)
    state.preparing = null; watch(events, 'again', prepare('es')); events.push(['state', ...shape(client)])
    flows[0].resolve('old'); await tick(events, 8); events.push(['flows', flows.length, ...shape(client)])
    flows[1]?.resolve('new'); await tick(events, 8); events.push(['state', ...shape(client)])
  },
  'a release rejects what it finds in preparations (worker) or leaves the flow to fail (native)': async ({ events, flows, client, prepare }) => {
    watch(events, 'first', prepare('es')); watch(events, 'second', prepare('en')); await tick(events, 2)
    for (const reject of [...client.preparations]) reject(new Error('released'))
    await tick(events, 8); events.push(['state', ...shape(client)])
    for (const pending of flows) pending.reject(new Error('late')); await tick(events, 8); events.push(['flows', flows.length, ...shape(client)])
  },
  'answers at once for the voice already loaded (native) and prepares it again (worker)': async ({ events, flows, client, state, prepare }) => {
    state.model = 'es'; const answer = prepare('es'); events.push(['promise', answer instanceof Promise, ...shape(client)]); watch(events, 'loaded', answer)
    await tick(events, 4); flows[0]?.resolve('again'); await tick(events, 6); events.push(['flows', flows.length])
  },
  'a preparation chain that cannot be chained fails the call': async ({ events, client, prepare }) => {
    client.preparationChain = { then() { throw new Error('broken chain') } }
    try { prepare('es'); events.push(['returned']) } catch (error) { events.push(['threw', error.message]) }
    events.push(['state', ...shape(client)])
  },
}
describe.each(['worker', 'native'])('prepare() of the %s client', kind => {
  it.each(Object.keys(scripts))('%s', async script => {
    const outcomes = {}
    for (const engine of ['JavaScript', 'Rust']) {
      const scene = world(kind, engine)
      await scripts[script](scene)
      outcomes[engine] = JSON.parse(JSON.stringify(scene.events, (key, value) => value === undefined ? '<undefined>' : value))
    }
    expect(outcomes.Rust).toEqual(outcomes.JavaScript)
    expect(outcomes.Rust.length).toBeGreaterThan(1)
  })
})
