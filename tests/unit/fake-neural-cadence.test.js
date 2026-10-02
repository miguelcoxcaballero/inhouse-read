import { afterEach, describe, expect, it, vi } from 'vitest'
import { createFakeNeuralEngine, FAKE_CATALOG } from '../helpers/fake-neural-engine.js'

afterEach(() => vi.useRealTimers())

describe('deterministic neural narration cadence', () => {
  it('starts the held fragment and completes only the preceding fragments', () => {
    vi.useFakeTimers()
    const engine = createFakeNeuralEngine({ voices:FAKE_CATALOG, holdAfter:2, startDelay:20, speakMs:30 })
    const events = [], onEvent = event => events.push(event.detail)
    window.addEventListener('inhouse-tts', onEvent)
    try {
      engine.speak({ text:'First.', voiceId:FAKE_CATALOG[0].id, id:'1' })
      vi.advanceTimersByTime(50)
      engine.speak({ text:'Second.', voiceId:FAKE_CATALOG[0].id, id:'2' })
      vi.advanceTimersByTime(500)
      expect(events.map(({ type, id }) => [type,id])).toEqual([['start','1'],['done','1'],['start','2']])
    } finally { window.removeEventListener('inhouse-tts', onEvent); engine.stop() }
  })

  it('uses mutable engine timing settings for later fragments', () => {
    vi.useFakeTimers()
    const engine = createFakeNeuralEngine({ startDelay:0, speakMs:10 })
    const events = [], onEvent = event => events.push(event.detail.type)
    window.addEventListener('inhouse-tts', onEvent)
    try {
      engine.config.startDelay = 450; engine.config.speakMs = 60
      engine.speak({ text:'Delayed.', voiceId:'voice', id:'1' })
      vi.advanceTimersByTime(449); expect(events).toEqual([])
      vi.advanceTimersByTime(1); expect(events).toEqual(['start'])
      vi.advanceTimersByTime(60); expect(events).toEqual(['start','done'])
    } finally { window.removeEventListener('inhouse-tts', onEvent); engine.stop() }
  })

  it('still cancels the actual pending start and completion on stop', () => {
    vi.useFakeTimers()
    const engine = createFakeNeuralEngine({ startDelay:20, speakMs:30, holdAfter:2 })
    const events = [], onEvent = event => events.push(event.detail.type)
    window.addEventListener('inhouse-tts', onEvent)
    try {
      engine.speak({ text:'Cancelled.', voiceId:'voice', id:'1' }); engine.stop()
      vi.advanceTimersByTime(500)
      expect(events).toEqual([])
      expect(engine.stops).toBe(1)
    } finally { window.removeEventListener('inhouse-tts', onEvent) }
  })
})
