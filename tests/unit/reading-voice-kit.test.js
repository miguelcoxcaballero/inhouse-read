// The timers, the page join and the deferred failure of the audiobook's session were closures of a JavaScript kit;
// they are exports of rust-ui voice_shell.rs. This differential runs the frozen closures and the Rust exports with
// the same recording module and owner and compares what each asks, in order, at the same timer and microtask step.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { rustUI as ui } from './helpers/rust-ui-ready.js'
import { referenceVoiceKit as frozen } from './helpers/reference-reading-voice-kit.js'

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

/** The module as the callbacks see it: the three exports they call back, recorded with the arguments each declares
 * (a bound export is also handed whatever the browser passes; the export reads no more than its own). */
const recorder = events => ({ ...ui, ...Object.fromEntries(['voice_join_ready', 'voice_wait_started', 'voice_sleep_expired', 'voice_synth_failed_now']
  .map(name => [name, name === 'voice_synth_failed_now' ? ui[name] : (...args) => { events.push([name, ...args.slice(0, ui[name].length)]) }])) })
const doors = {
  JavaScript:fake => ({ joinReady:(...a) => frozen.joinReady(fake, ...a), waitStarted:(...a) => frozen.waitStarted(fake, ...a), synthFailed:frozen.synthFailed,
    sleepTimer:(...a) => frozen.sleepTimer(fake, ...a), sleep:frozen.sleep, clearTimer:frozen.clearTimer, always:frozen.always, deviceLanguage:frozen.deviceLanguage }),
  Rust:fake => ({ joinReady:(...a) => ui.voice_join_wait(fake, ...a), waitStarted:(...a) => ui.voice_wait_timer(fake, ...a), synthFailed:(...a) => ui.voice_synth_failed(fake, ...a),
    sleepTimer:(...a) => ui.voice_sleep_timer(fake, ...a), sleep:ui.voice_sleep, clearTimer:ui.voice_clear_timer, always:ui.voice_always, deviceLanguage:ui.voice_device_language }),
}
const ticks = async (events, steps = 6) => { for (let n = 0; n < steps; n++) { await Promise.resolve(); events.push(['tick', n]) } }
const owner = { name:'session' }

const scenarios = {
  'joins when the next page is ready, and never after a failure': async (door, events) => {
    events.push(['returned', door.joinReady(owner, Promise.resolve('page'), 4, 2)]); await ticks(events)
    const failed = Promise.reject(new Error('page')); failed.catch(() => {})
    const unhandled = []; const listen = reason => unhandled.push(reason); process.on('unhandledRejection', listen)
    events.push(['returned', door.joinReady(owner, { then:(...handlers) => { events.push(['then', handlers.length, handlers.map(handler => typeof handler)]) } }, 5, 0)])
    await ticks(events); process.off('unhandledRejection', listen); events.push(['unhandled', unhandled.length])
  },
  'announces a slow start after 900 ms': async (door, events) => {
    vi.useFakeTimers(); const set = vi.spyOn(globalThis, 'setTimeout')
    const handle = door.waitStarted(owner, 'u1'); events.push(['handle', typeof handle, set.mock.calls.map(call => [typeof call[0], call[1], call.length])])
    vi.advanceTimersByTime(899); events.push(['899']); vi.advanceTimersByTime(1); events.push(['900'])
    clearTimeout(door.waitStarted(owner, 'u2')); vi.advanceTimersByTime(2000); events.push(['cleared'])
  },
  'reports a failed synthesis in a microtask': async (door, events) => {
    const session = { engineFailed:(...args) => { events.push(['failed', ...args, Object.keys(args[0])]) } }
    events.push(['returned', door.synthFailed(session, 'u9')]); events.push(['sync']); await ticks(events, 3)
  },
  'stops when the sleep timer runs out': async (door, events) => {
    vi.useFakeTimers(); const set = vi.spyOn(globalThis, 'setTimeout')
    const handle = door.sleepTimer(owner, 120000); events.push(['handle', typeof handle, set.mock.calls.map(call => [typeof call[0], call[1], call.length])])
    vi.advanceTimersByTime(119999); events.push(['before']); vi.advanceTimersByTime(1); events.push(['after'])
  },
  'sleeps for the time asked': async (door, events) => {
    vi.useFakeTimers(); const set = vi.spyOn(globalThis, 'setTimeout')
    const sleeping = door.sleep(250); events.push(['promise', sleeping instanceof Promise, set.mock.calls.map(call => [typeof call[0], call[1], call.length])])
    sleeping.then(value => events.push(['woke', value])); vi.advanceTimersByTime(249); await ticks(events, 2); vi.advanceTimersByTime(1); await ticks(events, 2)
  },
  'clears a timer by id, with the page\'s clearTimeout of that moment': async (door, events) => {
    const clear = vi.fn(); vi.stubGlobal('clearTimeout', clear)
    events.push(['returned', door.clearTimer(77, 'ignored')]); events.push(['calls', clear.mock.calls])
  },
  'answers the constant doorways': async (door, events) => {
    events.push([door.always(), door.always(1, 2), door.deviceLanguage() === navigator.language, typeof door.deviceLanguage()])
    vi.stubGlobal('navigator', { language:'gl-ES' }); events.push([door.deviceLanguage()])
  },
}
describe('the session doorways answered by Rust', () => {
  it.each(Object.keys(scenarios))('%s', async scenario => {
    const outcomes = {}
    for (const name of ['JavaScript', 'Rust']) {
      const events = []
      await scenarios[scenario](doors[name](recorder(events)), events)
      outcomes[name] = JSON.parse(JSON.stringify(events, (key, value) => value === undefined ? '<undefined>' : value))
      vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals()
    }
    expect(outcomes.Rust).toEqual(outcomes.JavaScript)
    expect(outcomes.Rust.length).toBeGreaterThan(0)
  })
})
