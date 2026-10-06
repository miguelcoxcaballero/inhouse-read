import { describe, it, expect } from 'vitest'
import { peakOf, rmsOf, peakNormalize, trimSilence, fadeEdges, silence, concat, pauseAfter, PAUSE_MS, splitSegments, limitIds, lengthScaleFor } from '../../src/js/readers/neural-voice/pcm.js'

const tone = (n, amp = 0.5) => Float32Array.from({ length: n }, (_, i) => amp * Math.sin(i / 5))

describe('peakNormalize', () => {
  it('brings the loudest sample to the target', () => {
    const pcm = tone(1000, 0.3)
    const gain = peakNormalize(pcm)
    expect(peakOf(pcm)).toBeCloseTo(0.9, 3)
    expect(gain).toBeCloseTo(3, 1)
  })
  it('caps the gain so a near-silent buffer (ca_ES upc_ona peaks at 0.14) is lifted only so far', () => {
    const pcm = tone(1000, 0.05)
    expect(peakNormalize(pcm)).toBe(6)
    expect(peakOf(pcm)).toBeCloseTo(0.3, 2)
  })
  it('lowers a hot voice and leaves digital silence alone', () => {
    const hot = tone(1000, 1.2)
    peakNormalize(hot)
    expect(peakOf(hot)).toBeCloseTo(0.9, 3)
    const quiet = new Float32Array(100)
    expect(peakNormalize(quiet)).toBeLessThanOrEqual(6)
    expect(Array.from(quiet).every(x => x === 0)).toBe(true)
  })
  it('raises quiet NVCC speech above the audible level without changing other models', () => {
    // Real NVCC raw fragments measured peaks 0.031–0.052, RMS 0.0034–0.0092.
    const raw = tone(1000, 0.033)
    const nvcc = raw.slice(), ordinary = raw.slice()
    expect(peakNormalize(nvcc, { model:'no_NO-nvcc-medium' })).toBe(12)
    expect(peakOf(nvcc)).toBeGreaterThan(0.3)
    expect(peakOf(nvcc)).toBeLessThanOrEqual(0.9001)
    expect(peakNormalize(ordinary, { model:'no_NO-talesyntese-medium' })).toBe(6)
    expect(peakOf(ordinary)).toBeCloseTo(0.198, 3)
  })
  it('keeps NVCC noise and sparse clicks under the ordinary gain cap', () => {
    const noise = tone(1000, 0.005), click = new Float32Array(10000)
    click[5000] = 0.033
    expect(peakNormalize(noise, { model:'no_NO-nvcc-medium' })).toBe(6)
    expect(peakNormalize(click, { model:'no_NO-nvcc-medium' })).toBe(6)
    expect(peakOf(noise)).toBeLessThan(0.031)
    const quiet = new Float32Array(1000)
    expect(peakNormalize(quiet, { model:'no_NO-nvcc-medium' })).toBe(6)
    expect(peakOf(quiet)).toBe(0)
  })
  it('retains the peak ceiling and explicit caller caps for NVCC', () => {
    const hot = tone(1000, 0.3), limited = tone(1000, 0.033)
    peakNormalize(hot, { model:'no_NO-nvcc-medium' })
    expect(peakOf(hot)).toBeCloseTo(0.9, 3)
    expect(peakNormalize(limited, { model:'no_NO-nvcc-medium', maxGain:2 })).toBe(2)
    expect(peakOf(limited)).toBeCloseTo(0.066, 3)
  })
})

describe('trimSilence', () => {
  const sr = 22050
  it('cuts the quiet lead-in and tail but keeps a little air around the speech', () => {
    const pcm = concat([silence(sr, 300), tone(sr, 0.8), silence(sr, 400)])
    const trimmed = trimSilence(pcm, sr)
    const seconds = trimmed.length / sr
    expect(seconds).toBeGreaterThan(1.0)
    expect(seconds).toBeLessThan(1.0 + 0.014 + 0.11 + 0.01)
  })
  it('does not treat low-level noise as speech, relative to the buffer peak', () => {
    const noise = Float32Array.from({ length: sr / 2 }, (_, i) => 0.003 * Math.sin(i))
    const pcm = concat([noise, tone(sr / 2, 0.8), noise])
    const trimmed = trimSilence(pcm, sr)
    expect(trimmed.length).toBeLessThan(sr / 2 + sr * 0.14)
  })
  it('returns an empty buffer when there is nothing but silence', () => {
    expect(trimSilence(new Float32Array(1000), sr).length).toBe(0)
  })
  it('returns a copy and never reads outside the buffer', () => {
    const pcm = tone(100, 0.8)
    const trimmed = trimSilence(pcm, sr, { leadMs: 1000, tailMs: 1000 })
    expect(trimmed.length).toBe(100)
    expect(trimmed).not.toBe(pcm)
  })
})

describe('fadeEdges, silence, concat, rms', () => {
  it('fades the first and last samples to zero so a cut never clicks', () => {
    const pcm = new Float32Array(2000).fill(1)
    fadeEdges(pcm, 22050, 4)
    expect(pcm[0]).toBe(0)
    expect(pcm[pcm.length - 1]).toBe(0)
    expect(pcm[1000]).toBe(1)
  })
  it('makes silence of the right length and joins buffers', () => {
    expect(silence(22050, 240).length).toBe(5292)
    expect(concat([new Float32Array([1, 2]), new Float32Array([3])])).toEqual(new Float32Array([1, 2, 3]))
    expect(silence(22050, -5).length).toBe(0)
  })
  it('measures rms', () => {
    expect(rmsOf(new Float32Array([1, -1, 1, -1]))).toBe(1)
    expect(rmsOf(new Float32Array(0))).toBe(0)
  })
})

describe('pauseAfter', () => {
  it('rests longest after a full stop, less after a comma, hardly at all after a fragment cut mid-clause', () => {
    expect(pauseAfter('Ya es tarde.')).toBe(PAUSE_MS.sentence)
    expect(pauseAfter('¿Qué hora es?')).toBe(PAUSE_MS.sentence)
    expect(pauseAfter('Dijo: "Voy."')).toBe(PAUSE_MS.sentence)
    expect(pauseAfter('Cuando llegó el invierno,')).toBe(PAUSE_MS.clause)
    expect(pauseAfter('el viejo bibliotecario cerró el último')).toBe(PAUSE_MS.cut)
    expect(PAUSE_MS.sentence).toBeGreaterThan(PAUSE_MS.clause)
    expect(PAUSE_MS.clause).toBeGreaterThan(PAUSE_MS.cut)
  })
})

describe('splitSegments', () => {
  it('splits the concatenated "^...$" sentences of piper_phonemize and drops the empty ones', () => {
    const ids = [1, 0, 17, 0, 18, 0, 2, 1, 0, 2, 1, 0, 31, 0, 28, 0, 2]
    expect(splitSegments(ids)).toEqual([[1, 0, 17, 0, 18, 0, 2], [1, 0, 31, 0, 28, 0, 2]])
  })
  it('keeps a trailing sentence that lacks its end marker and returns nothing for nothing', () => {
    expect(splitSegments([1, 0, 5, 0, 6, 0])).toEqual([[1, 0, 5, 0, 6, 0]])
    expect(splitSegments([])).toEqual([])
    expect(splitSegments([1, 0, 2])).toEqual([])
  })
})

describe('limitIds', () => {
  it('drops phoneme ids a voice does not know (152 symbols) together with their pad', () => {
    expect(limitIds([1, 0, 10, 0, 152, 0, 11, 0, 2], 152)).toEqual([1, 0, 10, 0, 11, 0, 2])
  })
  it('passes everything when the size is unknown', () => {
    expect(limitIds([1, 0, 200, 0, 2], 0)).toEqual([1, 0, 200, 0, 2])
  })
})

describe('lengthScaleFor', () => {
  it('speaks faster with a smaller length scale (rate 2 halves it) within sane bounds', () => {
    expect(lengthScaleFor(1, 2)).toBe(0.5)
    expect(lengthScaleFor(1, 1)).toBe(1)
    expect(lengthScaleFor(1.2, 0.5)).toBeCloseTo(2.4)
    expect(lengthScaleFor(1, 99)).toBeCloseTo(1 / 3)
    expect(lengthScaleFor(1, 'x')).toBe(1)
  })
})
