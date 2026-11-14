// @vitest-environment node
// The facade of the natural voices (neural-voice/index.js) answered by rust-ui (neural_facade.rs), against the frozen
// JavaScript facade: the same random script of calls runs on both, with a recording fake engine, modules that arrive
// (or fail) when the script says, and a voice core that is there, arrives late or fails. Every call into the engine,
// the planner's loader, the audio bridge and every event and settled promise is logged with the microtask at which it
// happened; the two logs must be equal.
import { expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
const fixture = vi.hoisted(() => ({ loaded:null, require:null }))
vi.mock('../../src/js/rust-voice-core.js', () => ({ getRustVoiceCore:() => fixture.loaded, requireRustVoiceCore:() => fixture.require() }))
import './helpers/rust-ui-ready.js'
import { rustMethods } from '../../src/js/readers/rust-ui-required.js'
import { NeuralVoiceEngine as Frozen, imports } from './helpers/reference-neural-voice-index.js'
import { NeuralVoiceEngine as Live } from '../../src/js/readers/neural-voice/index.js'
import * as planModule from '../../src/js/readers/neural-voice/client-plan.js'
import { nativePcmBridge, pauseNativeAudio, stopNativeAudio, unlockAudio, resetAudio } from '../../src/js/readers/neural-voice/audio.js'

const voiceCore = new WebAssembly.Instance(new WebAssembly.Module(readFileSync('src/wasm/inhouse_read_voice.wasm'))).exports
const MEMBERS = 'getDiagnosticState preload !refresh !install cancel !remove !warmUp !prime current unlock speak extendUpcoming stop release pause cancelCurrent'

// The facade as index.js declares it, with the two imports a test can hold back.
class Rust extends EventTarget {
  constructor(options = {}) { super(); this.options = options; this.core = null; this.loading = null; this.queue = []; this.resourceToken = {}; this.plan = null }
}
rustMethods(Rust, 'facade_method', MEMBERS, { engine:() => imports.engine(), plan:() => imports.plan(), nativePcmBridge, pauseNativeAudio, stopNativeAudio, unlockAudio })

const random = seed => () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296 }
const deferred = () => { let resolve, reject; const promise = new Promise((done, fail) => { resolve = done; reject = fail }); return { promise, resolve, reject } }

function script(seed) {
  const next = random(seed), pick = list => list[Math.floor(next() * list.length)], ops = []
  const kinds = ['speak', 'speak', 'speak', 'stop', 'pause', 'release', 'cancelCurrent', 'cancel', 'extendUpcoming', 'warmUp', 'prime', 'refresh', 'install', 'remove',
    'preload', 'unlock', 'getDiagnosticState', 'current', 'engineOk', 'engineOk', 'engineFail', 'planOk', 'planOk', 'planFail', 'coreOk', 'coreOk', 'coreFail',
    'coreEvent', 'tick', 'tick', 'tick']
  const length = 4 + Math.floor(next() * 22)
  for (let index = 0; index < length; index++) {
    const kind = pick(kinds)
    ops.push({ kind, value:Math.floor(next() * 6), ticks:1 + Math.floor(next() * 7) })
  }
  return { ops, env:pick(['bridge', 'bridge', 'plain', 'silent']), coreLoaded:next() < 0.5, onSpeak:pick([null, null, 'stop', 'pause', 'release', 'cancelCurrent', 'throw']), brokenCore:next() < 0.12 }
}

async function run(Facade, plan) {
  const log = []
  let tick = 0
  const note = (...entry) => log.push([tick, ...entry])
  const labels = new Map()
  const label = (value, kind) => { if (!labels.has(value)) labels.set(value, `${kind}#${labels.size}`); return labels.get(value) }
  const describe = value => {
    if (labels.has(value)) return labels.get(value)
    // A null where a parameter is destructured: the engine words it after the source text it compiled (the test
    // transform lowers the pattern to a property read), so only the kind of failure and the property are compared.
    if (value instanceof TypeError) { const found = /Cannot (?:destructure property|read properties of null \(reading) '(\w+)'/.exec(value.message); if (found) return `TypeError:null.${found[1]}` }
    if (value instanceof Error) return `${value.constructor.name}:${value.message}`
    if (value instanceof Promise) return 'promise'
    if (typeof value === 'function') return 'function'
    if (value && typeof value === 'object') return JSON.stringify(value)
    return Object.is(value, -0) ? '-0' : String(value)
  }
  resetAudio()
  const bridge = { getProtocol:() => 1, begin:() => note('bridge.begin'), stop:() => note('bridge.stop'), pause:() => note('bridge.pause') }
  const env = plan.env === 'silent' ? {} : new EventTarget()
  if (plan.env === 'bridge') env.InhousePcm = bridge
  if (plan.env !== 'silent') env.addEventListener('inhouse-tts', event => note('inhouse-tts', event.constructor.name, JSON.stringify(event.detail)))
  let facade
  const cores = []
  class FakeEngine extends EventTarget {
    constructor(options) {
      super(); note('new engine', options === facade.options, arguments.length)
      if (plan.brokenCore && !cores.length) { cores.push(null); throw new Error('engine constructor failed') }
      label(this, 'core'); cores.push(this)
    }
    get installed() { return 'installed' } get downloads() { return 'downloads' } get status() { return 'status' } get stats() { return 'stats' }
    getDiagnosticState() { note('core.getDiagnosticState'); return plan.onSpeak === 'pause' ? null : { loaded:true } }
    speak(request) {
      note('core.speak', describe(request), arguments.length)
      if (plan.onSpeak === 'throw' && request.id % 2) throw new Error('speak failed')
      if (plan.onSpeak && plan.onSpeak !== 'throw' && request.id % 2) facade[plan.onSpeak]()
      return `spoke ${request.id}`
    }
    extendUpcoming(request) { note('core.extendUpcoming', describe(request)); return [true, undefined, null, 0, false, 'yes'][request.id] }
    stop() { note('core.stop', arguments.length); return 'stopped' }
    pause() { note('core.pause', arguments.length); return 'paused' }
    release() { note('core.release', arguments.length); return 'released' }
    cancelCurrent() { note('core.cancelCurrent', arguments.length); return 'cancelled' }
    cancel(id) { note('core.cancel', describe(id), arguments.length); return 'cancelled' }
    answer(name, value, args) {
      note(`core.${name}`, ...[...args].map(describe))
      if (value === 4) throw new Error(`${name} threw`)
      return value === 3 ? Promise.reject(new Error(`${name} rejected`)) : value === 2 ? `plain ${name}` : Promise.resolve(`${name} done`)
    }
    refresh() { return this.answer('refresh', cores.length % 5, arguments) }
    install(id) { return this.answer('install', id, arguments) }
    remove(id) { return this.answer('remove', id, arguments) }
    warmUp(id) { return this.answer('warmUp', id, arguments) }
    prime(request) { return this.answer('prime', request.id, arguments) }
  }
  const pending = { engine:[], plan:[], core:[] }
  imports.engine = () => { note('import engine'); const wait = deferred(); pending.engine.push(wait); return wait.promise }
  imports.plan = () => { note('import plan'); const wait = deferred(); pending.plan.push(wait); return wait.promise }
  fixture.loaded = plan.coreLoaded ? voiceCore : null
  fixture.require = () => { note('require voice core'); const wait = deferred(); pending.core.push(wait); return wait.promise.then(core => (fixture.loaded = core)) }
  facade = new Facade({ env })
  facade.addEventListener('change', event => note('facade change', event.constructor.name, event.type))
  facade.addEventListener('status', event => note('facade status', event.constructor.name, event.type))
  const promises = []
  const settle = (index, value) => {
    if (!(value instanceof Promise)) return
    let known = promises.indexOf(value)
    if (known < 0) known = promises.push(value) - 1
    note('promise', index, known)
    value.then(result => note('resolved', index, describe(result)), error => note('rejected', index, describe(error)))
  }
  const advance = async count => { for (let step = 0; step < count; step++) { await Promise.resolve(); tick++ } }
  const options = [undefined, {}, { signal:'signal' }, null, 5, { playback:false }]
  for (const [index, op] of plan.ops.entries()) {
    const request = { id:op.value, text:`fragment ${index}` }
    label(request, 'request')
    let result
    try {
      switch (op.kind) {
        case 'speak': case 'extendUpcoming': case 'prime': result = facade[op.kind](request); break
        case 'stop': case 'pause': case 'release': case 'cancelCurrent': case 'refresh': case 'preload': case 'getDiagnosticState': result = facade[op.kind](); break
        case 'cancel': case 'remove': case 'warmUp': result = facade[op.kind](op.value); break
        case 'install': result = op.value === 1 ? facade.install(op.value) : facade.install(op.value, options[op.ticks % options.length]); break
        case 'unlock': result = op.value === 0 ? facade.unlock() : facade.unlock(options[op.value]); break
        case 'current': result = facade.current(op.value < 3 ? { ticket:facade.resourceToken, generation:0 } : op.value < 5 && facade.plan ? facade.plan.capture() : { ticket:{}, generation:0 }); break
        case 'engineOk': pending.engine.shift()?.resolve({ NeuralEngine:FakeEngine }); break
        case 'engineFail': pending.engine.shift()?.reject(new Error('engine chunk failed')); break
        case 'planOk': pending.plan.shift()?.resolve(planModule); break
        case 'planFail': pending.plan.shift()?.reject(new Error('plan chunk failed')); break
        case 'coreOk': pending.core.shift()?.resolve(voiceCore); break
        case 'coreFail': pending.core.shift()?.reject(new Error('voice core failed')); break
        case 'coreEvent': cores.at(-1)?.dispatchEvent(new Event(op.value % 2 ? 'change' : 'status')); break
        default: break
      }
      note(op.kind, describe(result))
      settle(index, result)
    } catch (error) { note(op.kind, 'threw', describe(error)) }
    await advance(op.ticks)
  }
  // Let everything that was asked for arrive, then read the state the integration and the diagnostics see.
  for (let round = 0; round < 4; round++) {
    pending.engine.shift()?.resolve({ NeuralEngine:FakeEngine }); pending.plan.shift()?.resolve(planModule); pending.core.shift()?.resolve(voiceCore)
    await advance(40)
  }
  note('end', facade.queue.length, describe(facade.core), facade.loading === null ? 'idle' : 'loading', Boolean(facade.plan), facade.plan?.draining, describe(facade.getDiagnosticState()))
  facade.release()
  return log
}

it('answers every member at the microtask the JavaScript facade did (600 random scripts)', async () => {
  let entries = 0
  const seen = new Map()
  for (let seed = 1; seed <= 600; seed++) {
    const plan = script(seed)
    const expected = await run(Frozen, plan)
    const actual = await run(Rust, plan)
    expect(actual, `seed ${seed}`).toEqual(expected)
    entries += expected.length
    for (const [, kind] of expected) seen.set(kind, (seen.get(kind) || 0) + 1)
  }
  // The scripts reach every path: adoption of queued speech, failed loads, late and failing voice cores, relayed events.
  for (const kind of ['new engine', 'core.speak', 'core.warmUp', 'core.prime', 'core.install', 'core.refresh', 'core.remove', 'core.stop', 'core.pause', 'core.release',
    'core.cancelCurrent', 'core.cancel', 'core.extendUpcoming', 'core.getDiagnosticState', 'inhouse-tts', 'facade change', 'facade status', 'require voice core',
    'bridge.begin', 'bridge.stop', 'bridge.pause', 'resolved', 'rejected']) expect(seen.get(kind) || 0, kind).toBeGreaterThan(5)
  expect(entries).toBeGreaterThan(10000)
}, 60000)

it('keeps the shape of the class: the same members, of the same kind, and the same answer to isSupported', () => {
  const shape = Class => Object.getOwnPropertyNames(Class.prototype).sort().map(name => {
    const descriptor = Object.getOwnPropertyDescriptor(Class.prototype, name)
    return [name, typeof descriptor.get === 'function' ? 'getter' : typeof descriptor.value, descriptor.enumerable, descriptor.configurable]
  })
  expect(shape(Live)).toEqual(shape(Frozen))
  expect(Object.keys(new Live())).toEqual(Object.keys(new Frozen()))
  const bridge = { InhousePcm:{ getProtocol:() => 1 } }
  const environments = [{}, { Worker() {} }, { Worker() {}, WebAssembly:{} }, { Worker() {}, WebAssembly:{}, AudioContext() {} }, { Worker() {}, WebAssembly:{}, AudioContext() {}, caches:{} },
    { Worker() {}, WebAssembly:{}, webkitAudioContext() {}, caches:{} }, { Worker() {}, WebAssembly:{}, caches:{}, ...bridge }, { Worker:{}, WebAssembly:{}, AudioContext() {}, caches:{} },
    { Worker() {}, WebAssembly() {}, AudioContext() {}, caches:{} }, { Worker() {}, WebAssembly:{}, caches:{}, InhousePcm:{ getProtocol:() => 2 } }, { Worker() {}, WebAssembly:null, AudioContext() {}, caches:{} }]
  for (const env of environments) {
    expect(Live.isSupported(env)).toBe(Frozen.isSupported(env))
    expect(new Live({ env }).supported).toBe(new Frozen({ env }).supported)
  }
  for (const getter of ['installed', 'downloads', 'status', 'stats']) expect(new Live()[getter]).toEqual(new Frozen()[getter])
  expect(new Live().getDiagnosticState()).toEqual(new Frozen().getDiagnosticState())
  expect(Object.keys(new Live().getDiagnosticState())).toEqual(Object.keys(new Frozen().getDiagnosticState()))
})
