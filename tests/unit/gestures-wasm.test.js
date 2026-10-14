import { afterEach, describe, expect, it, vi } from 'vitest'
import { rustUI } from './helpers/rust-ui-ready.js'
import * as production from '../../src/js/gestures.js'
import * as frozen from './helpers/reference-gestures.js'
import { firstDifference, prng } from './helpers/pointer-harness.js'
import { makeScript, play } from './helpers/gesture-scripts.js'

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('compiled reader gestures against the frozen JavaScript recogniser', () => {
  it('produces the same trace for 400 random pointer, touch, timer and frame scripts', () => {
    let compared = 0, navigations = 0
    const seen = {}
    // The first use creates the module's permanent handles; later runs must add none.
    play(production, makeScript(1, 20)); vi.unstubAllGlobals(); vi.restoreAllMocks()
    for (let seed = 1; seed <= 400; seed++) {
      const script = makeScript(seed * 7919, 90)
      const expected = play(frozen, script)
      const baseline = rustUI.ui_live_handles()
      const actual = play(production, script)
      const difference = firstDifference(expected, actual)
      if (difference) throw new Error(`seed ${seed}: ${difference}`)
      compared += expected.length
      for (const line of expected) {
        const name = /^"(on(?:Next|Prev|ToggleChrome|ToggleZoom|LongPress|NativeSwipe|ManualPan))"/.exec(line)?.[1]
        if (name) { seen[name] = (seen[name] || 0) + 1; navigations++ }
      }
      expect(rustUI.ui_live_handles()).toBe(baseline)
      vi.unstubAllGlobals(); vi.restoreAllMocks()
    }
    // A comparison that never navigated would certify nothing.
    expect(navigations).toBeGreaterThan(1500)
    for (const name of ['onNext', 'onPrev', 'onToggleChrome', 'onToggleZoom', 'onLongPress', 'onNativeSwipe', 'onManualPan']) expect(seen[name], name).toBeGreaterThan(40)
    expect(compared).toBeGreaterThan(100000)
  }, 120_000)

  it('classifies zones and swipes exactly like the original over a large corpus, including NaN, infinities and -0', () => {
    const random = prng(5)
    const numbers = [0, -0, 1, -1, 22, -22, 39.999999999999993, 40, -40, 400, .28, NaN, Infinity, -Infinity, Number.MIN_VALUE, 1e308, .45, -.45]
    const any = () => random.chance(.4) ? random.pick(numbers) : (random() - .5) * random.pick([1, 50, 500, 5000])
    for (let index = 0; index < 60000; index++) {
      const x = any(), width = random.chance(.5) ? Math.abs(any()) : any()
      expect(production.classifyTapZone(x, width)).toBe(frozen.classifyTapZone(x, width))
      const sample = { dx: any(), dy: any(), durationMs: Math.abs(any()) * (random.chance(.3) ? 50 : 1), velocityX: random.chance(.2) ? undefined : any() }
      expect(production.classifySwipe(sample)).toBe(frozen.classifySwipe(sample))
    }
    expect(production.ZONE).toEqual(frozen.ZONE)
  }, 120_000)

  it('does not accumulate JavaScript handles across attach, gesture and detach cycles', () => {
    const cycle = seed => { play(production, makeScript(seed, 40)); vi.unstubAllGlobals(); vi.restoreAllMocks() }
    for (let seed = 1; seed <= 5; seed++) cycle(seed)
    const baseline = rustUI.ui_live_handles()
    const grew = []
    for (let seed = 6; seed <= 205; seed++) {
      const before = rustUI.ui_live_handles()
      cycle(seed)
      if (rustUI.ui_live_handles() !== before) grew.push(`${seed}:${rustUI.ui_live_handles() - before}`)
    }
    expect(grew).toEqual([])
    expect(rustUI.ui_live_handles()).toBe(baseline)
  }, 120_000)
})
