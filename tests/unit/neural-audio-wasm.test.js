// @vitest-environment node
// The audio output of the neural voices kept by rust-ui (neural_audio.rs) against the frozen JavaScript module: the same
// random script of unlocks, stops, pauses and resets over recording bridges and audio contexts must call them in the
// same order with the same arguments and answer with the same objects.
import { afterEach, expect, it, vi } from 'vitest'
import './helpers/rust-ui-ready.js'
import * as frozen from './helpers/reference-neural-audio.js'
import * as live from '../../src/js/readers/neural-voice/audio.js'

afterEach(() => { vi.useRealTimers(); live.resetAudio(); frozen.resetAudio() })
const random = seed => () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296 }

function world(log, audio) {
  const labels = new Map()
  const describe = value => {
    if (labels.has(value)) return labels.get(value)
    if (value && typeof value === 'object') return JSON.stringify(Object.entries(value).map(([key, item]) => [key, labels.get(item) || (typeof item === 'object' && item ? 'object' : String(item))]))
    return String(value)
  }
  const bridge = (name, protocol, failing) => {
    const made = {
      getProtocol() { log.push(`${name}.getProtocol`); if (protocol === 'throw') throw new Error('closed'); return protocol },
      begin(...args) { log.push(`${name}.begin ${args.join('|')} ${this === made}`); if (failing === 'begin') throw new Error('begin failed') },
      stop(...args) { log.push(`${name}.stop ${args.join('|')}`); if (failing === 'stop') throw new Error('stop failed'); if (failing === 'reenter') audio.stopNativeAudio() },
      pause(...args) { log.push(`${name}.pause ${args.join('|')}`); if (failing === 'stop') throw new Error('pause failed') }
    }
    labels.set(made, name)
    return made
  }
  let contexts = 0
  const context = (name, state, resume) => function Context(options) {
    const made = this
    labels.set(made, `${name}#${++contexts}`)
    log.push(`new ${name} ${JSON.stringify(options)} ${arguments.length}`)
    made.state = state
    made.resume = () => { log.push(`${labels.get(made)}.resume`); if (resume === 'throw') throw new Error('not allowed'); if (resume === 'reject') return Promise.reject(new Error('later')); if (resume === 'plain') return 5; made.state = 'running'; return Promise.resolve() }
  }
  const envs = [
    {}, { InhousePcm:bridge('pcm', 1) }, { InhousePcm:bridge('text', '1') }, { InhousePcm:bridge('old', 2) }, { InhousePcm:bridge('closed', 'throw') }, { InhousePcm:bridge('failing', 1, 'begin') },
    { InhousePcm:bridge('rude', 1, 'stop') }, { InhousePcm:bridge('nested', 1, 'reenter') }, { InhousePcm:{} }, { InhousePcm:0, AudioContext:context('ctx', 'suspended') },
    { AudioContext:context('running', 'running') }, { webkitAudioContext:context('webkit', 'suspended', 'throw') }, { AudioContext:context('rejecting', 'suspended', 'reject') },
    { AudioContext:context('plain', 'suspended', 'plain') }, { AudioContext:context('closed', 'closed') }, { InhousePcm:bridge('both', 1), AudioContext:context('unused', 'running') }
  ]
  return { envs, describe }
}

it('keeps the same audio state as the JavaScript module (500 random scripts)', async () => {
  vi.useFakeTimers({ now:1700000000000 })
  let lines = 0
  for (let seed = 1; seed <= 500; seed++) {
    const logs = []
    for (const audio of [frozen, live]) {
      audio.resetAudio()
      vi.setSystemTime(1700000000000)
      const log = [], next = random(seed), { envs, describe } = world(log, audio)
      const step = (label, work) => { try { log.push(`${label} -> ${describe(work())}`) } catch (error) { log.push(`${label} threw ${error.constructor.name}:${error.message}`) } }
      for (let count = 3 + Math.floor(next() * 14); count > 0; count--) {
        const env = envs[Math.floor(next() * envs.length)], choice = next()
        if (choice < 0.4) step('unlock', () => audio.unlockAudio(env))
        else if (choice < 0.55) step('stop', () => audio.stopNativeAudio())
        else if (choice < 0.7) step('pause', () => audio.pauseNativeAudio())
        else if (choice < 0.8) step('bridge', () => audio.nativePcmBridge(env))
        else if (choice < 0.88) step('native', () => audio.nativeAudio())
        else if (choice < 0.96) step('context', () => audio.audioContext())
        else step('reset', () => audio.resetAudio())
        if (next() < 0.2) vi.setSystemTime(Date.now() + 1234)
      }
      step('native at the end', () => audio.nativeAudio())
      step('context at the end', () => audio.audioContext())
      // The session counter of each module runs on its own: only its place in the name differs.
      logs.push(log.map(line => line.replace(/(\d{13})-\d+/g, '$1-n')))
      await Promise.resolve()
    }
    expect(logs[1], `seed ${seed}`).toEqual(logs[0])
    lines += logs[0].length
  }
  expect(lines).toBeGreaterThan(5000)
})

it('counts the sessions, answers with the very objects and reads the environment like the module', () => {
  for (const audio of [frozen, live]) {
    audio.resetAudio()
    const sessions = [], bridge = { getProtocol:() => 1, begin:session => sessions.push(session), stop() {}, pause() {} }
    const first = audio.unlockAudio({ InhousePcm:bridge })
    expect(audio.unlockAudio({ InhousePcm:bridge })).toBe(first)
    expect(audio.audioContext()).toBe(first)
    const native = audio.nativeAudio()
    expect(native.bridge).toBe(bridge); expect(Object.keys(native)).toEqual(['bridge', 'session']); expect(Object.keys(first)).toEqual(['native', 'state', 'session', 'currentTime'])
    audio.pauseNativeAudio()
    expect(native.paused).toBe(true); expect(audio.nativeAudio()).toBe(native); expect(audio.audioContext()).toBe(null)
    audio.unlockAudio({ InhousePcm:bridge })
    const [one, two] = sessions.map(session => Number(session.split('-')[1]))
    expect(two).toBe(one + 1)
    expect(sessions[0]).toMatch(/^\d+-\d+$/)
    audio.stopNativeAudio()
    expect(audio.nativeAudio()).toBe(null)
    expect(audio.nativePcmBridge({})).toBe(null)
    expect(() => audio.nativePcmBridge(null)).toThrow(TypeError)
    expect(audio.unlockAudio({})).toBe(null)
    globalThis.InhousePcm = bridge
    try { expect(audio.nativePcmBridge()).toBe(bridge); expect(audio.unlockAudio().native).toBe(true) } finally { delete globalThis.InhousePcm }
    audio.resetAudio()
  }
})
