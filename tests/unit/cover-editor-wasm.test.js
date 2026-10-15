import { describe, expect, it } from 'vitest'
import * as production from '../../src/js/cover-editor.js'
import * as original from './helpers/reference-cover-editor.js'

// The Rust editor decisions (rust-ui/src/cover_editor.rs) against the frozen original: tab ids, keys,
// the pose over the sheet and the swaying frames, bit for bit (Object.is on every number).
const bits = value => JSON.stringify(value, (_, item) => typeof item === 'number' && !Number.isFinite(item) ? `n:${item}` : Object.is(item, -0) ? 'n:-0' : item)
function random(seed) { return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296 } }
const pickOne = (next, list) => list[Math.floor(next() * list.length)]

describe('cover editor decisions in Rust', () => {
  it('keeps the tab list and answers tab ids and keys exactly', () => {
    expect(production.EDITOR_TABS).toEqual(original.EDITOR_TABS)
    expect(Object.isFrozen(production.EDITOR_TABS)).toBe(true)
    const values = ['spine', 'cover', 'nope', '', undefined, null, 0, 1, {}, ['cover'], new String('cover'), 'Spine', ' cover']
    const keys = ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End', 'Enter', 'a', '', undefined, null, 5, {}, 'arrowright']
    for (const value of values) {
      expect(production.editorTabId(value)).toBe(original.editorTabId(value))
      for (const key of keys) expect(production.nextEditorTab(value, key)).toBe(original.nextEditorTab(value, key))
    }
  })

  it('places the cover exactly like the original for 60000 random viewports', () => {
    const next = random(11)
    let wide = 0, measured = 0
    for (let i = 0; i < 60_000; i++) {
      const options = {
        viewportWidth: pickOne(next, [320, 360, 390, 759, 760, 768, 1024, 1280, next() * 1600, NaN, undefined, '800', null]),
        viewportHeight: pickOne(next, [568, 640, 844, 1000, next() * 1200, NaN, undefined, 0]),
        landscape: pickOne(next, [undefined, false, false, false, true, 0, 1, '']),
        coverW: pickOne(next, [0, 100, 260, 290, next() * 500, undefined, NaN]),
        coverH: pickOne(next, [0, 394, 440, 600, next() * 700, undefined]),
        centerY: pickOne(next, [0, 354, 420, next() * 800, undefined]),
        thickness: pickOne(next, [undefined, 0, 20, 30, 34, next() * 60, null]),
        sheetTop: pickOne(next, [undefined, NaN, Infinity, 0, 100, 176, 177, 200, 388, 640, 760, next() * 900, '388', null])
      }
      if (options.viewportWidth >= 760) wide++
      if (Number.isFinite(options.sheetTop)) measured++
      const expected = original.coverEditorPose(options), actual = production.coverEditorPose(options)
      expect(bits(actual)).toBe(bits(expected))
      expect(Object.keys(actual)).toEqual(Object.keys(expected))
    }
    expect(wide).toBeGreaterThan(10_000); expect(measured).toBeGreaterThan(20_000)
    expect(() => production.coverEditorPose()).toThrow(TypeError)
    expect(() => production.coverEditorPose(null)).toThrow(TypeError)
    const reads = []
    const probe = new Proxy({}, { get: (_, key) => { reads.push(key); return undefined } })
    original.coverEditorPose(probe); const expectedReads = reads.splice(0); production.coverEditorPose(probe)
    expect(reads).toEqual(expectedReads)
  })

  it('sways exactly like the original for 6000 random bases and options', () => {
    const next = random(29)
    for (let i = 0; i < 6000; i++) {
      const base = pickOne(next, [
        { x: 0, y: -40, scale: .8, angle: 0, pitch: 0 }, { x: 1, y: 2, scale: next(), angle: next() * 10 - 5, pitch: next() * 4 },
        { scale: 1, angle: 3 }, { angle: 1, extra: 'kept', pitch: undefined }, { pitch: null, angle: 0, x: -0 }, { angle: NaN },
        { pitch: 2, angle: 0, x: 1, y: 1, scale: 2, angle2: 4 }
      ])
      const options = pickOne(next, [undefined, {}, { cycles: 3, yaw: 12, pitch: 7, duration: 2400, stepsPerCycle: 8 },
        { cycles: next() * 6, yaw: next() * 30, pitch: next() * 20, duration: next() * 5000, stepsPerCycle: Math.floor(next() * 14) },
        { cycles: .1 }, { cycles: 0 }, { stepsPerCycle: 0 }, { cycles: NaN }, { cycles: 1.5, stepsPerCycle: 3 }, { cycles: 2.5, stepsPerCycle: 7 }, { duration: null }, { yaw: '9', pitch: '3' }])
      const expected = original.coverTiltFrames(base, options), actual = production.coverTiltFrames(base, options)
      expect(bits(actual)).toBe(bits(expected))
      expect(actual.frames.map(frame => Object.keys(frame.transform))).toEqual(expected.frames.map(frame => Object.keys(frame.transform)))
    }
    const base = { x: 0, y: -40, scale: .8, angle: 0, pitch: 0 }
    expect(production.coverTiltFrames(base).frames[0].transform).toEqual(base)
    expect(production.coverTiltFrames(base).frames.at(-1).transform).toEqual(base)
    expect(production.coverTiltFrames(base).frames[0].transform).not.toBe(base)
    expect(() => production.coverTiltFrames(base, null)).toThrow(TypeError)
  })
})
