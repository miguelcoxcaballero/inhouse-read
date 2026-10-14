import { afterEach, describe, expect, it, vi } from 'vitest'
import { rustShelf as rustUI } from './helpers/rust-shelf-ready.js'
import * as production from '../../src/js/shelf-view-gesture.js'
import * as frozen from './helpers/reference-shelf-view-gesture.js'
import { firstDifference } from './helpers/pointer-harness.js'
import { makeViewScript, playView } from './helpers/shelf-view-scripts.js'

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })
const reset = () => { vi.unstubAllGlobals(); vi.restoreAllMocks() }

describe('compiled shelf view gesture against the frozen JavaScript controller', () => {
  it('produces the same mode changes, captures and default prevention for 600 random scripts', () => {
    playView(production, makeViewScript(1, 20)); reset()
    const seen = { setMode: 0, onGestureStart: 0, preventDefault: 0, setPointerCapture: 0, stopPropagation: 0 }
    let lines = 0
    for (let seed = 1; seed <= 600; seed++) {
      const script = makeViewScript(seed * 15485863, 60)
      const expected = playView(frozen, script)
      reset()
      const baseline = rustUI.shelf_live_handles()
      const actual = playView(production, script)
      const difference = firstDifference(expected, actual)
      if (difference) throw new Error(`seed ${seed}: ${difference}`)
      lines += expected.length
      for (const line of expected) { const name = /^"(\w+)"/.exec(line)?.[1]; if (name in seen) seen[name]++ }
      expect(rustUI.shelf_live_handles()).toBe(baseline)
      reset()
    }
    expect(seen.setMode).toBeGreaterThan(300)
    expect(seen.onGestureStart).toBeGreaterThan(500)
    expect(seen.setPointerCapture).toBeGreaterThan(300)
    expect(seen.preventDefault).toBeGreaterThan(1000)
    expect(lines).toBeGreaterThan(100000)
  }, 120_000)

  it('does not accumulate JavaScript handles across create, swipe and destroy cycles', () => {
    for (let seed = 1; seed <= 5; seed++) { playView(production, makeViewScript(seed, 30)); reset() }
    const baseline = rustUI.shelf_live_handles()
    for (let seed = 6; seed <= 205; seed++) { playView(production, makeViewScript(seed, 30)); reset() }
    expect(rustUI.shelf_live_handles()).toBe(baseline)
  }, 120_000)
})
