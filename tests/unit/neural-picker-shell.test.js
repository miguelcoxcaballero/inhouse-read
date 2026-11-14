// The constructor of the natural-voice picker and the doorways its methods were handed by a JavaScript kit
// (idle and frame schedulers, the engine's listeners, the storage of 'Ahora no' and of the first use) are rust-ui
// picker_shell.rs. This differential runs the frozen JavaScript ones and the Rust ones over the same recording
// owner and compares every call they make, in order and at the same microtask step.
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import * as ui from '../../src/wasm/ui/inhouse_read_ui.js'
import { NeuralVoicePicker } from '../../src/js/readers/neural-picker.js'
import { ReferenceNeuralVoicePicker, referenceKit } from './helpers/reference-neural-picker-shell.js'

const runtime = vi.hoisted(() => ({ load:null, engine:null }))
vi.mock('../../src/js/rust-ui.js', () => ({ getRustUI:() => ui }))
vi.mock('../../src/js/readers/neural-runtime.js', () => ({ loadNeural:() => runtime.load(), neuralEngine:() => runtime.engine, neuralVoiceList:() => [] }))
beforeAll(() => ui.initSync({ module:readFileSync('src/wasm/ui/inhouse_read_ui_bg.wasm') }))
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); localStorage.clear(); document.body.innerHTML = '' })

const neuralRuntime = await import('../../src/js/readers/neural-runtime.js')
const kit = { runtime:neuralRuntime, catalog:{}, messages:{} }
// The Rust doorways, called as picker_method binds them; the frozen ones take the module first where they did.
const doors = {
  JavaScript:{ schedule:(o, c) => referenceKit.schedule(ui, o, c), load:(o, c, v) => referenceKit.load(ui, o, c, v), listen:(o, e) => referenceKit.listen(ui, o, e),
    engineRefresh:(o, e, c, v) => referenceKit.engineRefresh(ui, o, e, c, v), warmActive:referenceKit.warmActive, frame:o => referenceKit.frame(ui, o),
    readOffer:referenceKit.readOffer, writeOffer:referenceKit.writeOffer, readUsed:referenceKit.readUsed, ignore:referenceKit.ignore },
  Rust:{ schedule:(o, c) => ui.picker_schedule(ui, o, c), load:(o, c, v) => ui.picker_load(ui, neuralRuntime.loadNeural, o, c, v), listen:(o, e) => ui.picker_listen(ui, kit, o, e),
    engineRefresh:(o, e, c, v) => ui.picker_engine_refresh(ui, o, e, c, v), warmActive:(o, c) => ui.picker_warm_active(ui, o, c), frame:o => ui.picker_frame(ui, o),
    readOffer:ui.picker_read_offer, writeOffer:ui.picker_write_offer, readUsed:ui.picker_read_used, ignore:ui.picker_ignore },
}
const flush = async (events, steps = 8) => { for (let n = 0; n < steps; n++) { await Promise.resolve(); events.push(['tick', n]) } }
/** An owner that records what the callbacks ask of it; `current` is what isWarmCurrent answers. */
function owner(events, current = true) {
  const self = { warmHandle:'handle', frame:7, warmGeneration:3, signature:'', host:{ book:{ id:'b' }, populateVoices:() => events.push(['populate']) } }
  for (const name of ['refresh', 'attach', 'warmUp', 'paint', 'render', 'click']) self[name] = (...args) => { events.push([name, ...args]) }
  self.used = () => { events.push(['used']); return false }
  self.isWarmCurrent = context => { events.push(['current', context]); return current }
  return self
}

const context = { generation:3, book:{ id:'b' } }
const doorwayScenarios = {
  'schedules with the idle callback': async (door, events) => {
    let run
    vi.stubGlobal('requestIdleCallback', (callback, options) => { events.push(['idle', typeof callback, options]); run = callback; return 41 })
    const me = owner(events), handle = door.schedule(me, context)
    events.push(['handle', handle]); run({ didTimeout:false }); events.push(['after', me.warmHandle])
  },
  'schedules with a timer where there is no idle callback': async (door, events) => {
    vi.stubGlobal('requestIdleCallback', undefined); vi.useFakeTimers()
    const me = owner(events), handle = door.schedule(me, context)
    events.push(['handle', handle.idle, typeof handle.id]); vi.advanceTimersByTime(799); events.push(['799']); vi.advanceTimersByTime(1); events.push(['after', me.warmHandle])
  },
  'does not refresh a stale warm-up': async (door, events) => {
    let run
    vi.stubGlobal('requestIdleCallback', callback => { run = callback; return 1 })
    const me = owner(events, false); door.schedule(me, context); run(); events.push(['after', me.warmHandle])
  },
  'attaches when the engine module loaded': async (door, events) => {
    runtime.load = () => Promise.resolve('engine')
    const me = owner(events); events.push(['returned', door.load(me, context, true) instanceof Promise]); await flush(events)
  },
  'ignores a failed load': async (door, events) => {
    runtime.load = () => Promise.reject(new Error('offline'))
    const me = owner(events); await door.load(me, context, false); await flush(events)
  },
  'warms up after the engine refreshed': async (door, events) => {
    const me = owner(events), engine = { refresh:() => { events.push(['refresh-engine']); return Promise.resolve() } }
    events.push(['returned', door.engineRefresh(me, engine, context, true) instanceof Promise]); await flush(events)
  },
  'warms up after a refresh that failed': async (door, events) => {
    const me = owner(events), engine = { refresh:() => Promise.reject(new Error('cache')) }
    door.engineRefresh(me, engine, context, 1); await flush(events)
  },
  'does not warm up when it was not asked to, or the engine cannot refresh': async (door, events) => {
    const me = owner(events); door.engineRefresh(me, {}, context, false); door.engineRefresh(me, { refresh:null }, context, true); await flush(events)
  },
  'answers whether the warm-up is still current': async (door, events) => {
    const active = door.warmActive(owner(events), context); events.push(['kind', typeof active, active(), active('ignored')])
    events.push(['stale', door.warmActive(owner(events, false), context)()])
  },
  'paints in the next frame': async (door, events) => {
    let run
    vi.stubGlobal('requestAnimationFrame', callback => { run = callback; return 9 })
    const me = owner(events); events.push(['frame', door.frame(me)]); run(1234.5); events.push(['after', me.frame])
  },
  'reads and writes the stored offer and first use': async (door, events) => {
    events.push([door.readOffer(), door.readUsed()]); door.writeOffer('{"en":1}'); localStorage.setItem('inhouse-read-neural-used', '1')
    events.push([door.readOffer(), door.readUsed(), localStorage.getItem('inhouse-read-neural-offer-dismissed')])
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    for (const read of [door.readOffer, door.readUsed]) { try { read(); events.push(['read']) } catch (error) { events.push(['threw', error.message]) } }
  },
  'ignores a rejection without leaving it unhandled': async (door, events) => {
    const settled = door.ignore(Promise.reject(new Error('quiet'))); events.push(['promise', settled instanceof Promise]); events.push(['value', await settled])
    events.push(['plain', await door.ignore(5)])
  },
}
describe('the picker doorways answered by Rust', () => {
  it.each(Object.keys(doorwayScenarios))('%s', async scenario => {
    const outcomes = {}
    for (const name of ['JavaScript', 'Rust']) {
      const events = []
      await doorwayScenarios[scenario](doors[name], events)
      outcomes[name] = JSON.parse(JSON.stringify(events, (key, value) => value === undefined ? '<undefined>' : value))
      vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); localStorage.clear()
    }
    expect(outcomes.Rust).toEqual(outcomes.JavaScript)
    expect(outcomes.Rust.length).toBeGreaterThan(0)
  })
})

const panelMarkup = '<dialog><div data-neural><div data-neural-list></div><p data-neural-warning hidden></p><button data-neural-retry></button><p data-neural-status></p></div><div data-neural-offer></div></dialog>'
function build(Class, events) {
  document.body.innerHTML = panelMarkup
  const panel = document.querySelector('dialog'), added = []
  const spy = vi.spyOn(EventTarget.prototype, 'addEventListener').mockImplementation(function (type, callback, options) { added.push([this.dataset ? Object.keys(this.dataset)[0] : 'engine', type, typeof callback, options]); (this.__listeners ||= []).push([type, callback]) })
  const host = { panel, book:{ id:'b' }, bookLanguage:() => 'en', populateVoices:() => events.push(['populate']), preferences:{},
    voice:{ retryNeural:() => events.push(['retry']), play:() => events.push(['play']) } }
  const picker = new Class(host)
  return { picker, host, panel, added, spy, fire:(node, type, event) => node.__listeners.filter(entry => entry[0] === type).forEach(entry => entry[1](event)) }
}
describe('the picker built by Rust', () => {
  it('leaves the state, the view and the listeners the JavaScript constructor left', () => {
    const outcomes = {}
    for (const [name, Class] of [['JavaScript', ReferenceNeuralVoicePicker], ['Rust', NeuralVoicePicker]]) {
      const events = [], { picker, host, panel, added, spy, fire } = build(Class, events)
      const shape = Object.fromEntries(Object.keys(picker).map(key => [key, picker[key] instanceof Map ? ['Map', picker[key].size] : picker[key]?.constructor?.name ?? picker[key]]))
      const keys = Object.keys(picker)
      picker.click = event => events.push(['click', event.kind]); picker.render = () => events.push(['render'])
      fire(panel.querySelector('[data-neural]'), 'click', { kind:'list' }); fire(panel.querySelector('[data-neural-offer]'), 'click', { kind:'offer' })
      fire(panel.querySelector('[data-neural-retry]'), 'click', {})
      host.voice = { }; fire(panel.querySelector('[data-neural-retry]'), 'click', {})
      host.voice = undefined; let failure = ''
      try { fire(panel.querySelector('[data-neural-retry]'), 'click', {}) } catch (error) { failure = error.constructor.name }
      spy.mockRestore()
      outcomes[name] = { keys, shape, added, events, failure, same:[picker.host === host, picker.block === panel.querySelector('[data-neural]'), picker.offer === panel.querySelector('[data-neural-offer]'), picker.view instanceof ui.RustNeuralView] }
    }
    expect(outcomes.Rust).toEqual(outcomes.JavaScript)
    expect(outcomes.Rust.keys).toEqual(['host', 'tasks', 'errors', 'engine', 'signature', 'frame', 'warmGeneration', 'warmHandle', 'view', 'block', 'offer'])
    expect(outcomes.Rust.events).toEqual([['click', 'list'], ['click', 'offer'], ['retry'], ['play'], ['render'], ['render']])
    expect(outcomes.Rust.failure).toBe('TypeError')
  })
  it('listens to the engine: a change repaints or rebuilds, the first speech is remembered', () => {
    const outcomes = {}
    for (const [name, Class] of [['JavaScript', ReferenceNeuralVoicePicker], ['Rust', NeuralVoicePicker]]) {
      localStorage.clear()
      const events = [], { picker, added, spy, fire } = build(Class, events)
      const frames = []
      vi.stubGlobal('requestAnimationFrame', callback => { frames.push(callback); events.push(['frame']); return frames.length })
      const engine = new EventTarget(); Object.assign(engine, { installed:new Set(['b', 'a']), status:'idle', refresh:() => { events.push(['engine-refresh']) } })
      runtime.engine = engine
      picker.warmUp = () => events.push(['warmUp']); picker.paint = () => events.push(['paint'])
      picker.attach(false)
      events.push(['attached', picker.engine === engine, picker.signature])
      fire(engine, 'change', new Event('change')); events.push(['signature', picker.signature, picker.frame])
      fire(engine, 'change', new Event('change')); events.push(['frame-id', picker.frame])
      fire(engine, 'change', new Event('change')); frames.forEach(run => run(16)); events.push(['painted', picker.frame])
      fire(engine, 'status', new Event('status')); events.push(['used', localStorage.getItem('inhouse-read-neural-used')])
      engine.status = 'speaking'; fire(engine, 'status', new Event('status')); events.push(['used', localStorage.getItem('inhouse-read-neural-used')])
      spy.mockRestore(); vi.unstubAllGlobals()
      outcomes[name] = { events, added }
    }
    expect(outcomes.Rust).toEqual(outcomes.JavaScript)
    expect(outcomes.Rust.events).toContainEqual(['used', '1'])
    expect(outcomes.Rust.events.filter(event => event[0] === 'frame')).toHaveLength(1)
  })
})
