// A deterministic browser for pointer state machines. Every observable call the
// recogniser makes (timers, frames, clock reads, listener registration, style
// writes, pointer capture, default prevention, host callbacks) lands in one trace,
// so a Rust port can be compared with its frozen JavaScript original call for call.
import { vi } from 'vitest'

export function prng(seed) {
  let value = seed >>> 0
  const random = () => { value = (Math.imul(value, 1664525) + 1013904223) >>> 0; return value / 4294967296 }
  random.int = (low, high) => low + Math.floor(random() * (high - low + 1))
  random.pick = list => list[Math.floor(random() * list.length)]
  random.chance = probability => random() < probability
  return random
}

export const show = value => {
  if (typeof value === 'number') return Object.is(value, -0) ? '-0' : String(value)
  if (typeof value === 'string') return JSON.stringify(value)
  if (value === undefined) return 'undefined'
  if (value === null) return 'null'
  if (typeof value === 'boolean') return String(value)
  if (value?.traceName) return value.traceName
  if (Array.isArray(value)) return `[${value.map(show).join(',')}]`
  if (typeof value === 'function') return 'function'
  if (typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${key}:${show(value[key])}`).join(',')}}`
  return String(value)
}

export function createWorld() {
  const log = []
  const note = (...parts) => log.push(parts.map(show).join(' '))
  let now = 0, timerSerial = 0, frameSerial = 0, eventSerial = 0
  const timers = new Map(), frames = new Map()
  const stub = (name, value) => vi.stubGlobal(name, value)
  stub('setTimeout', (callback, delay) => {
    const id = ++timerSerial
    timers.set(id, { callback, due: now + delay })
    note('setTimeout', id, delay)
    return id
  })
  stub('clearTimeout', id => { note('clearTimeout', id); timers.delete(id) })
  stub('requestAnimationFrame', callback => {
    const id = ++frameSerial
    frames.set(id, callback)
    note('requestAnimationFrame', id)
    return id
  })
  stub('cancelAnimationFrame', id => { note('cancelAnimationFrame', id); frames.delete(id) })
  vi.spyOn(performance, 'now').mockImplementation(() => { note('performance.now', now); return now })

  const listeners = new Map()
  const key = (owner, type) => `${owner}/${type}`
  const optionKey = options => options === undefined ? '-' : options === true ? 'capture' : show(options)
  const listenable = (name, extra = {}) => ({
    traceName: name,
    addEventListener(type, callback, options) {
      note('add', name, type, optionKey(options))
      const list = listeners.get(key(name, type)) || []
      list.push({ callback, options })
      listeners.set(key(name, type), list)
    },
    // Only a removal that takes effect is traced: removing a handler that was
    // never registered is a no-op, and a port need not mimic those calls.
    removeEventListener(type, callback, options) {
      const list = listeners.get(key(name, type)) || []
      const at = list.findIndex(entry => entry.callback === callback)
      if (at < 0) return
      note('remove', name, type, optionKey(options))
      list.splice(at, 1)
    },
    ...extra
  })
  const styleFor = (name, initial) => {
    const values = { ...initial }
    return new Proxy(values, {
      set(target, property, value) { note('style', name, property, value); target[property] = value; return true },
      get(target, property) { return target[property] }
    })
  }
  const target = (name, matchers = []) => ({
    traceName: name,
    matchers,
    closest(selector) { note('closest', name, selector); return matchers.some(test => test.test(selector)) ? this : null }
  })
  const event = (type, properties = {}, at = null) => {
    const serial = ++eventSerial
    return {
      type, traceName: `event#${serial}:${type}`, target: at, timeStamp: now, cancelable: true, ...properties,
      preventDefault() { note('preventDefault', this.traceName) },
      stopPropagation() { note('stopPropagation', this.traceName) }
    }
  }
  const fire = (owner, type, payload) => {
    for (const entry of [...(listeners.get(key(owner, type)) || [])]) {
      try { entry.callback.call(undefined, payload) } catch (error) { note('threw', owner, type, error?.message) }
    }
  }
  const advance = milliseconds => {
    const end = now + milliseconds
    for (;;) {
      const due = [...timers].filter(([, timer]) => timer.due <= end).sort((a, b) => a[1].due - b[1].due || a[0] - b[0])[0]
      if (!due) break
      const [id, timer] = due
      timers.delete(id)
      now = Math.max(now, timer.due)
      note('timer', id, now)
      try { timer.callback() } catch (error) { note('threw timer', id, error?.message) }
    }
    now = end
  }
  const frame = () => {
    const pending = [...frames]
    frames.clear()
    for (const [id, callback] of pending) {
      note('frame', id, now)
      try { callback(now) } catch (error) { note('threw frame', id, error?.message) }
    }
  }
  return {
    log, note, listenable, styleFor, target, event, fire, advance, frame,
    get now() { return now }, set now(value) { now = value },
    get pendingTimers() { return timers.size }, get pendingFrames() { return frames.size },
    get listenerCount() { return [...listeners.values()].reduce((sum, list) => sum + list.length, 0) }
  }
}

/** The first differing line, with some context, for a readable failure. */
export function firstDifference(expected, actual) {
  const length = Math.max(expected.length, actual.length)
  for (let index = 0; index < length; index++) {
    if (expected[index] !== actual[index]) {
      return `trace differs at ${index}\n  expected ${expected.slice(Math.max(0, index - 4), index + 3).join('\n           ')}\n  actual   ${actual.slice(Math.max(0, index - 4), index + 3).join('\n           ')}`
    }
  }
  return ''
}
