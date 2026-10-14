import { describe, expect, it } from 'vitest'
import { rustShelf } from './helpers/rust-shelf-ready.js'

// The contact-shadow angle table is the host's Math applied in Rust; the original built it in JavaScript.
function original() {
  const trig = new Float64Array(80)
  for (let i = 0; i < 20; i++) {
    const corner = Math.floor(i / 5), k = i % 5
    const light = (corner * 4 + k) * Math.PI / 8
    const foot = i / 20 * Math.PI * 2
    trig.set([Math.cos(light), Math.sin(light)], i * 2)
    trig.set([Math.cos(foot), Math.sin(foot)], 40 + i * 2)
  }
  return trig
}

describe('compiled contact-shadow angle table against the frozen JavaScript', () => {
  it('has the same 80 values to the last bit, each time it is asked', () => {
    const expected = original()
    for (let call = 0; call < 3; call++) {
      const actual = rustShelf.occlusion_angles()
      expect(actual).toBeInstanceOf(Float64Array)
      expect(actual).toHaveLength(80)
      actual.forEach((value, index) => { if (!Object.is(value, expected[index])) throw new Error(`entry ${index}: expected ${expected[index]} actual ${value}`) })
    }
  })
})
