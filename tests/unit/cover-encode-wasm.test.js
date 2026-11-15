// encodePdfCover is rust-ui cover_encode.rs. This differential runs the frozen JavaScript function and the Rust one over
// the same canvas, bitmap, worker and signal, through every way the worker can answer, fail or be given up, and compares
// every call and the microtask step at which each happens and at which the cover settles.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { rustUI as ui } from './helpers/rust-ui-ready.js'
import { referenceEncodePdfCover } from './helpers/reference-cover-encode.js'

afterEach(() => { vi.unstubAllGlobals() })
const plain = events => JSON.parse(JSON.stringify(events, (key, value) => value === undefined ? '<undefined>' : typeof value === 'function' ? '<function>' : value instanceof Blob ? `<Blob ${value.size}>` : value))

/** One cover: what the page offers, how the worker behaves and what the script does while it is encoded. */
function world(engine, events, { missing = [], worker:mode = 'reply', bitmap:bitmapMode = 'ready', broken = [], toBlob = 'now' } = {}) {
  const blob = new Blob(['exact jpeg'], { type:'image/jpeg' }), state = { workers:[], bitmaps:[] }
  const canvas = { toBlob(...args) { events.push(['toBlob', typeof args[0], args[1], args[2]]); if (toBlob === 'throws') throw new Error('tainted'); if (toBlob === 'now') args[0](blob); else state.encoded = args[0] } }
  const bitmapOf = () => { const bitmap = { close() { events.push(['close']); if (broken.includes('close')) throw new Error('cannot close') } }; state.bitmaps.push(bitmap); return bitmap }
  vi.stubGlobal('OffscreenCanvas', function OffscreenCanvas() {})
  vi.stubGlobal('createImageBitmap', function (...args) {
    events.push(['createImageBitmap', args.length, args[0] === canvas, this === undefined || this === globalThis])
    if (bitmapMode === 'throws') throw new Error('no bitmaps')
    if (bitmapMode === 'rejects') return Promise.reject(new Error('cannot snapshot'))
    if (bitmapMode === 'pending') return new Promise(resolve => { state.ready = () => resolve(bitmapOf()) })
    return bitmapMode === 'plain' ? bitmapOf() : Promise.resolve(bitmapOf())
  })
  vi.stubGlobal('Worker', function Worker() {})
  for (const name of missing) vi.stubGlobal(name, name === 'Worker' ? { not:'a function' } : undefined)
  const createWorker = (...args) => {
    events.push(['createWorker', args.length])
    if (mode === 'blocked') throw new Error('blocked worker')
    const worker = { terminate() { events.push(['terminate']); if (broken.includes('terminate')) throw new Error('cannot terminate') },
      postMessage(message, transfer) {
        events.push(['postMessage', Object.keys(message), message.bitmap === state.bitmaps.at(-1), transfer.length, transfer[0] === message.bitmap, ...['onmessage', 'onerror', 'onmessageerror'].map(name => typeof worker[name]), worker.onerror === worker.onmessageerror])
        if (mode === 'post-error') throw new Error('unsupported transfer')
      } }
    state.workers.push(worker)
    return new Proxy(worker, { set(target, key, value) { events.push(['worker.' + key, value === null ? null : typeof value]); target[key] = value; return true } })
  }
  const signalOf = (aborted = false) => { const signal = { aborted, listeners:[], addEventListener(type, listener, options) { events.push(['add', type, options]); signal.listeners.push(listener) },
    removeEventListener(type, listener, ...rest) { events.push(['remove', type, signal.listeners.indexOf(listener), rest.length]) } }; return signal }
  const encode = (...args) => engine === 'Rust' ? ui.cover_encode_pdf(args[0], args[1], createWorker) : referenceEncodePdfCover(createWorker, ...args)
  const watch = (label, ...args) => {
    let promise
    try { promise = encode(...args) } catch (error) { events.push([label, 'threw', error.constructor.name]); return }
    events.push([label, 'promise', promise instanceof Promise])
    promise.then(value => events.push([label, 'resolved', value === blob ? '<the blob>' : value]), error => events.push([label, 'rejected', error?.constructor?.name, error instanceof TypeError ? '<the engine\'s words>' : error?.message]))
  }
  const tick = async steps => { for (let n = 0; n < steps; n++) { await Promise.resolve(); events.push(['tick', n]) } }
  const call = (label, action) => { try { events.push([label, action()]) } catch (error) { events.push([label, 'threw', error.constructor.name]) } }
  return { blob, canvas, state, signalOf, watch, tick, call }
}
const reply = (state, data) => state.workers.at(-1).onmessage({ data })

const scripts = {
  'the worker answers with the JPEG': [{}, async w => { w.watch('cover', w.canvas); await w.tick(3); w.call('reply', () => reply(w.state, { blob:w.blob })); await w.tick(5) }],
  'a bitmap that is ready at once': [{ bitmap:'plain' }, async w => { w.watch('cover', w.canvas, {}); await w.tick(3); w.call('reply', () => reply(w.state, { blob:w.blob })); await w.tick(5) }],
  'no Worker in this page': [{ missing:['Worker'] }, async w => { w.watch('cover', w.canvas); await w.tick(4) }],
  'no OffscreenCanvas in this page': [{ missing:['OffscreenCanvas'] }, async w => { w.watch('cover', w.canvas); await w.tick(4) }],
  'no createImageBitmap in this page': [{ missing:['createImageBitmap'] }, async w => { w.watch('cover', w.canvas); await w.tick(4) }],
  'a canvas that answers later': [{ missing:['Worker'], toBlob:'later' }, async w => { w.watch('cover', w.canvas); await w.tick(3); w.state.encoded(w.blob); await w.tick(4) }],
  'a canvas that cannot be read': [{ missing:['Worker'], toBlob:'throws' }, async w => { w.watch('cover', w.canvas); await w.tick(4) }],
  'a blocked worker falls back to the canvas and closes the bitmap': [{ worker:'blocked' }, async w => { w.watch('cover', w.canvas); await w.tick(6) }],
  'a bitmap that cannot be transferred': [{ worker:'post-error' }, async w => { w.watch('cover', w.canvas); await w.tick(7) }],
  'the worker fails': [{}, async w => { w.watch('cover', w.canvas); await w.tick(3); w.call('error', () => w.state.workers[0].onerror({ preventDefault() { w.call('prevented', () => 1) } })); await w.tick(6) }],
  'the worker fails without an event': [{}, async w => { w.watch('cover', w.canvas); await w.tick(3); w.call('error', () => w.state.workers[0].onerror()); await w.tick(6) }],
  'a message the worker could not send': [{}, async w => { w.watch('cover', w.canvas); await w.tick(3); w.call('messageerror', () => w.state.workers[0].onmessageerror({ preventDefault:null })); await w.tick(6) }],
  'an event whose preventDefault is not a function': [{}, async w => { w.watch('cover', w.canvas); await w.tick(3); w.call('error', () => w.state.workers[0].onerror({ preventDefault:1 })); await w.tick(2); w.call('reply', () => reply(w.state, { blob:w.blob })); await w.tick(5) }],
  'the worker says it cannot encode': [{}, async w => { w.watch('cover', w.canvas); await w.tick(3); w.call('reply', () => reply(w.state, { unavailable:true })); await w.tick(6) }],
  'an answer that is not a Blob': [{}, async w => { w.watch('cover', w.canvas); await w.tick(3); w.call('reply', () => reply(w.state, { blob:{ size:3 } })); await w.tick(6) }],
  'an answer without data, then a message without an event': [{}, async w => { w.watch('cover', w.canvas); await w.tick(3); w.call('no data', () => reply(w.state, undefined)); w.call('late', () => w.state.workers[0].onmessage); await w.tick(6) }],
  'a message without an event throws and the job goes on': [{}, async w => { w.watch('cover', w.canvas); await w.tick(3); const handler = w.state.workers[0].onmessage; w.call('no event', () => handler()); w.call('reply', () => handler({ data:{ blob:w.blob } })); w.call('again', () => handler({ data:{ blob:w.blob } })); await w.tick(5) }],
  'the bitmap cannot be made': [{ bitmap:'rejects' }, async w => { w.watch('cover', w.canvas); await w.tick(6) }],
  'createImageBitmap throws': [{ bitmap:'throws' }, async w => { w.watch('cover', w.canvas); await w.tick(5) }],
  'a cover already given up does no work': [{}, async w => { w.watch('cover', w.canvas, { signal:w.signalOf(true) }); await w.tick(3) }],
  'given up while the bitmap is made: it is closed and no worker starts': [{ bitmap:'pending' }, async w => { const signal = w.signalOf(); w.watch('cover', w.canvas, { signal }); await w.tick(2); signal.aborted = true; w.state.ready(); await w.tick(6) }],
  'given up while the bitmap fails: no second encoder': [{ bitmap:'rejects' }, async w => { const signal = w.signalOf(); w.watch('cover', w.canvas, { signal }); signal.aborted = true; await w.tick(6) }],
  'given up while the worker encodes: a late answer is ignored': [{}, async w => {
    const signal = w.signalOf(); w.watch('cover', w.canvas, { signal }); await w.tick(3); const handler = w.state.workers[0].onmessage
    signal.aborted = true; w.call('abort', () => signal.listeners[0]({ type:'abort' })); w.call('late', () => handler({ data:{ blob:w.blob } })); await w.tick(6)
  }],
  'given up between the bitmap and the worker\'s start': [{}, async w => {
    const signal = w.signalOf(), read = { count:0 }
    Object.defineProperty(signal, 'aborted', { get() { return ++read.count > 2 } }); w.watch('cover', w.canvas, { signal }); await w.tick(7)
  }],
  'an answer in time with a signal: its listener is removed': [{}, async w => { const signal = w.signalOf(); w.watch('cover', w.canvas, { signal }); await w.tick(3); w.call('reply', () => reply(w.state, { blob:w.blob })); await w.tick(5) }],
  'given up just as the answer arrives': [{}, async w => { const signal = w.signalOf(); w.watch('cover', w.canvas, { signal }); await w.tick(3); w.call('reply', () => reply(w.state, { blob:w.blob })); signal.aborted = true; await w.tick(5) }],
  'a worker that cannot be terminated fails the cover and leaves the bitmap': [{ broken:['terminate'] }, async w => { w.watch('cover', w.canvas); await w.tick(3); w.call('reply', () => reply(w.state, { blob:w.blob })); await w.tick(5) }],
  'a bitmap that cannot be closed fails the cover': [{ broken:['close'] }, async w => { w.watch('cover', w.canvas); await w.tick(3); w.call('reply', () => reply(w.state, { blob:w.blob })); await w.tick(5) }],
  'options that cannot be read': [{}, async w => { w.watch('null', w.canvas, null); w.watch('number', w.canvas, 7); await w.tick(4); w.call('reply', () => reply(w.state, { blob:w.blob })); await w.tick(5) }],
  'two covers at once keep their own bitmap and worker': [{}, async w => {
    w.watch('first', w.canvas); w.watch('second', w.canvas); await w.tick(3)
    w.call('second', () => w.state.workers[1].onmessage({ data:{ blob:w.blob } })); await w.tick(4); w.call('first', () => w.state.workers[0].onmessage({ data:{ blob:w.blob } })); await w.tick(5)
  }],
}
describe('the JPEG of a PDF cover in Rust against its JavaScript', () => {
  it.each(Object.keys(scripts))('%s', async name => {
    const [options, script] = scripts[name], outcomes = {}
    for (const engine of ['JavaScript', 'Rust']) { const events = []; await script(world(engine, events, options)); vi.unstubAllGlobals(); outcomes[engine] = plain(events) }
    expect(outcomes.Rust).toEqual(outcomes.JavaScript)
    expect(outcomes.Rust.some(event => event[1] === 'resolved' || event[1] === 'rejected' || event[1] === 'threw')).toBe(true)
  })
})
