import { afterEach, describe, expect, it, vi } from 'vitest'
const state = vi.hoisted(() => ({ engine:null }))
vi.mock('../../src/js/readers/neural-runtime.js', async original => ({
  ...await original(), neuralEngine:() => state.engine
}))
import { ReaderExperience } from '../../src/js/readers/reader-experience.js'
afterEach(() => { state.engine = null })

describe('explicit close voice resource boundary', () => {
  it('cancels pending warm, stops playback and releases inference synchronously in that order', () => {
    const calls = []
    state.engine = { release:() => { calls.push('release') } }
    const host = { neuralPicker:{ cancelWarm:() => calls.push('cancel') }, voice:{ stop:() => calls.push('stop') } }
    expect(ReaderExperience.prototype.closeVoice.call(host)).toBeUndefined()
    expect(calls).toEqual(['cancel', 'stop', 'release'])
  })

  it('does not require a loaded engine or block close on a bridge disposal error', () => {
    const host = { voice:{ stop:vi.fn() }, neuralPicker:{ cancelWarm:vi.fn() } }
    expect(ReaderExperience.prototype.closeVoice.call(host)).toBeUndefined()
    state.engine = { release:() => { throw new Error('Bridge already closed') } }
    expect(ReaderExperience.prototype.closeVoice.call(host)).toBeUndefined()
    expect(host.voice.stop).toHaveBeenCalledTimes(2)
  })
})
