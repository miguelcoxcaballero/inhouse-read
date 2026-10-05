import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ engine:null, load:null }))
vi.mock('../../src/js/readers/neural-runtime.js', () => ({
  loadNeural:() => state.load(), neuralEngine:() => state.engine, neuralVoiceList:() => []
}))
import { NeuralVoicePicker } from '../../src/js/readers/neural-picker.js'

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }
function setup() {
  const panel = document.createElement('div')
  panel.innerHTML = '<div data-neural></div><div data-neural-offer></div><button data-neural-retry></button>'
  const host = { panel, book:{ id:'first' }, populateVoices:vi.fn(),
    voice:{ voiceFor:() => ({ voice:{ id:'voice', neural:true, installed:true } }) } }
  const engine = new EventTarget()
  Object.assign(engine, { refresh:vi.fn(async () => {}), warmUp:vi.fn(async () => true) })
  state.engine = engine; state.load = vi.fn(async () => {})
  return { host, engine, picker:new NeuralVoicePicker(host) }
}
beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('requestIdleCallback', undefined)
  localStorage.setItem('inhouse-read-neural-used', '1')
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); localStorage.clear() })
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve() }

describe('reader-scoped natural voice warm lifecycle', () => {
  it('cancels the queued fallback timer before closing reaches its first await', async () => {
    const t = setup()
    t.picker.warm(); t.picker.cancelWarm(); t.host.book = null
    await vi.advanceTimersByTimeAsync(800)
    expect(state.load).not.toHaveBeenCalled()
    expect(t.engine.warmUp).not.toHaveBeenCalled()
  })

  it('cancels the idle handle and rejects its stale callback without changing refresh arguments', async () => {
    const t = setup(), cancel = vi.fn()
    let callback
    vi.stubGlobal('requestIdleCallback', run => { callback = run; return 19 })
    vi.stubGlobal('cancelIdleCallback', cancel)
    const refresh = vi.spyOn(t.picker, 'refresh')
    t.picker.warm(); t.picker.cancelWarm(); t.host.book = null
    expect(cancel).toHaveBeenCalledWith(19)
    callback(); await flush()
    expect(refresh).not.toHaveBeenCalled()
    expect(state.load).not.toHaveBeenCalled()
  })

  it('rejects a module-load continuation from the closed reader', async () => {
    const t = setup(), pending = deferred()
    state.load = vi.fn(() => pending.promise)
    t.picker.refresh()
    t.picker.cancelWarm(); t.host.book = null
    pending.resolve(); await flush()
    expect(t.engine.warmUp).not.toHaveBeenCalled()
  })

  it('rejects a catalog-refresh continuation after the reader closes', async () => {
    const t = setup(), pending = deferred()
    t.engine.refresh.mockReturnValue(pending.promise)
    t.picker.refresh(); await flush()
    t.picker.cancelWarm(); t.host.book = null
    pending.resolve(); await flush()
    expect(t.engine.warmUp).not.toHaveBeenCalled()
  })

  it('permits the fresh reader warm request without adopting an old book continuation', async () => {
    const t = setup(), old = deferred()
    state.load = vi.fn(() => old.promise)
    t.picker.refresh()
    t.picker.cancelWarm(); t.host.book = { id:'second' }
    state.load = vi.fn(async () => {})
    t.picker.refresh(); await flush()
    expect(t.engine.warmUp).toHaveBeenCalledOnce()
    old.resolve(); await flush()
    expect(t.engine.warmUp).toHaveBeenCalledOnce()
  })
})
