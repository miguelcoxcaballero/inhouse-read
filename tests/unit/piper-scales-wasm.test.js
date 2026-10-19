// @vitest-environment node
import { describe, expect, it } from 'vitest'
import './helpers/rust-voice-ready.js'
import { piperScales } from '../../src/js/readers/neural-voice/synth-flow.js'
import { lengthScaleFor } from './helpers/reference-pcm.js'
import { synthesisRate } from './helpers/reference-speech-tempo.js'

// The worker's and the Android client's scales literal, as both computed it before the voice core.
const original = (inference, rate) => Float32Array.from([inference.noise_scale ?? 0.667, lengthScaleFor(inference.length_scale ?? 1, synthesisRate(rate)), inference.noise_w ?? 0.8])

describe('Piper scales from the voice core', () => {
  it('matches the original defaults, coercions and rate stretching', () => {
    const values = [undefined, null, 0, -0, 0.5, 0.667, 1, 1.3, '0.9', '', 'x', NaN, Infinity, -2, 1e-40, 3.4e39, [], [2], true, { valueOf:() => 0.7 }]
    const rates = [undefined, null, 0, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4, NaN, '1.5', 'fast', -1, Infinity]
    let cases = 0
    for (const noise of values) for (const length of values) for (const rate of rates) {
      const inference = { noise_scale:noise, length_scale:length, noise_w:values[(cases * 7) % values.length] }
      expect(piperScales(inference, rate)).toEqual(original(inference, rate))
      cases++
    }
    expect(piperScales({}, 1)).toEqual(Float32Array.of(0.667, 1, 0.8))
    expect(cases).toBe(values.length * values.length * rates.length)
  })
  it('throws like the original for a BigInt field', () => {
    expect(() => original({ noise_scale:1n }, 1)).toThrow(TypeError)
    expect(() => piperScales({ noise_scale:1n }, 1)).toThrow(TypeError)
  })
})
