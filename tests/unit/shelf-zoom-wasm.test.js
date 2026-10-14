import { afterEach, describe, expect, it, vi } from 'vitest'
import { rustShelf as rustUI } from './helpers/rust-shelf-ready.js'
import * as production from '../../src/js/shelf-zoom.js'
import * as frozen from './helpers/reference-shelf-zoom.js'
import { firstDifference } from './helpers/pointer-harness.js'
import { makeZoomScript, playZoom } from './helpers/shelf-zoom-scripts.js'

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })
const reset = () => { vi.unstubAllGlobals(); vi.restoreAllMocks() }

describe('compiled shelf zoom against the frozen JavaScript controller', () => {
  it('produces the same scene calls, frames, captures and view numbers for 500 random touch scripts', () => {
    playZoom(production, makeZoomScript(1, 20)); reset()
    const seen = { setInspectionView: 0, pinch: 0, coast: 0, capture: 0, moving: 0, settled: 0 }
    let lines = 0
    for (let seed = 1; seed <= 500; seed++) {
      const script = makeZoomScript(seed * 104729, 70)
      const expected = playZoom(frozen, script)
      reset()
      const baseline = rustUI.shelf_live_handles()
      const actual = playZoom(production, script)
      const difference = firstDifference(expected, actual)
      if (difference) throw new Error(`seed ${seed}: ${difference}`)
      lines += expected.length
      for (const line of expected) {
        if (line.startsWith('"setInspectionView"')) { seen.setInspectionView++; if (line.includes('moving:true')) seen.moving++; else seen.settled++ }
        else if (line.startsWith('"setPointerCapture"')) seen.capture++
      }
      expect(rustUI.shelf_live_handles()).toBe(baseline)
      reset()
    }
    // A corpus that never zoomed, panned or coasted would certify nothing.
    expect(seen.setInspectionView).toBeGreaterThan(2000)
    expect(seen.moving).toBeGreaterThan(1000)
    expect(seen.settled).toBeGreaterThan(300)
    expect(seen.capture).toBeGreaterThan(300)
    expect(lines).toBeGreaterThan(150000)
  }, 120_000)

  it('does not accumulate JavaScript handles across create, gesture and destroy cycles', () => {
    for (let seed = 1; seed <= 5; seed++) { playZoom(production, makeZoomScript(seed, 30)); reset() }
    const baseline = rustUI.shelf_live_handles()
    const grew = []
    for (let seed = 6; seed <= 205; seed++) {
      const before = rustUI.shelf_live_handles()
      playZoom(production, makeZoomScript(seed, 30)); reset()
      if (rustUI.shelf_live_handles() !== before) grew.push(`${seed}:${rustUI.shelf_live_handles() - before}`)
    }
    expect(grew).toEqual([])
    expect(rustUI.shelf_live_handles()).toBe(baseline)
  }, 120_000)

  it('requires the shelf module and releases the root class when destroyed', () => {
    const root = document.createElement('div'), scroller = document.createElement('div')
    root.append(scroller); document.body.append(root)
    const scene = { getInspectionZoom: () => 2, getInspectionView: () => ({ zoom: 2, panX: 0, panY: 0, width: 400, height: 400, centerX: 200, centerY: 200 }), getObjectAtPoint: () => null, setInspectionView: view => view }
    const control = production.createShelfZoom({ root, scroller, getScene: () => scene, isEnabled: () => true, onGestureStart() {} })
    expect(root.classList.contains('is-shelf-zoomed')).toBe(true)
    control.destroy(); control.destroy()
    expect(root.classList.contains('is-shelf-zoomed')).toBe(false)
    root.remove()
  })
})
