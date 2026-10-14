import { afterEach, describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { rustShelf } from './helpers/rust-shelf-ready.js'
import { configureNativeRendererSize } from '../../src/js/native-renderer-size.js'
import { withNativeCanvasResize } from '../../src/js/native-canvas-resize.js'
import { configureNativeRendererSize as originalConfigure } from './helpers/reference-native-renderer-size.js'
import { withNativeCanvasResize as originalWith } from './helpers/reference-native-canvas-resize.js'
import { prng, show } from './helpers/pointer-harness.js'

afterEach(() => vi.restoreAllMocks())

// A renderer that logs every call Three's API receives and every canvas dimension write.
function driver(log, { width = 390, height = 192, ratio = 2, variant = 'plain', fractional = false } = {}) {
  const canvas = document.createElement('canvas')
  canvas.width = Math.floor(width * ratio); canvas.height = Math.floor(height * ratio)
  for (const axis of ['width', 'height']) {
    const original = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, axis).set
    vi.spyOn(HTMLCanvasElement.prototype, axis, 'set').mockImplementation(function (value) {
      if (this === canvas) log.push(`write ${axis} ${show(value)}`)
      return original.call(this, value)
    })
  }
  const renderer = {
    domElement: canvas, isWebGLRenderer: true, autoClear: variant !== 'noAutoClear', autoClearColor: true, autoClearDepth: true, autoClearStencil: true,
    xr: { isPresenting: variant === 'xr' }, size: new THREE.Vector2(width, height), ratio,
    getScissorTest() { return variant === 'scissor' }, getRenderTarget() { return variant === 'target' ? {} : null },
    getPixelRatio() { log.push('getPixelRatio'); return this.ratio },
    getSize(target) { log.push('getSize'); return target.copy(this.size) },
    setPixelRatio(value) { log.push(`setPixelRatio ${value}`); this.ratio = value; this.setSize(this.size.x, this.size.y, false) },
    setSize(w, h) {
      log.push(`setSize ${w} ${h}`)
      if (this.xr.isPresenting) return
      this.size.set(w, h); canvas.width = Math.floor(w * this.ratio); canvas.height = Math.floor(h * this.ratio)
    }
  }
  if (variant !== 'noBuffer') renderer.setDrawingBufferSize = function (w, h, r) { log.push(`setDrawingBufferSize ${w} ${h} ${r}`); this.ratio = r; this.setSize(w, h, false) }
  if (variant === 'frozenCanvas') Object.freeze(canvas)
  if (variant === 'rejecting') {
    const set = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, 'height').set
    vi.spyOn(HTMLCanvasElement.prototype, 'height', 'set').mockImplementation(function (value) {
      if (this === canvas && value === 0) throw new Error('driver rejects staging')
      return set.call(this, value)
    })
  }
  return renderer
}

const VARIANTS = ['plain', 'plain', 'plain', 'plain', 'noAutoClear', 'xr', 'scissor', 'target', 'noBuffer', 'frozenCanvas', 'rejecting']
function scenario(seed) {
  const random = prng(seed)
  const start = { width: random.pick([390, 393, 360.5, 800]), height: random.pick([192, 256, 320.25, 600]), ratio: random.pick([1, 1.5, 2, 2.625, 3]), variant: random.pick(VARIANTS) }
  const calls = Array.from({ length: random.int(1, 7) }, () => ({
    width: random.pick([390, 393, 390.25, 360.5, 800, 401, 120]), height: random.pick([192, 256, 192.25, 320, 600, 90]),
    ratio: random.pick([1, 1.5, 2, 2.625, 3]), native: random.pick([true, true, false, undefined]), preserve: random.pick([true, true, false, undefined]),
    avoid: random.pick([false, true, 'bounded', 'bounded', undefined])
  }))
  return { start, calls }
}
function play(configure, { start, calls }) {
  const log = [], renderer = driver(log, start), scratch = new THREE.Vector2()
  for (const call of calls) {
    try { configure(renderer, call.width, call.height, call.ratio, scratch, call.native, call.preserve, call.avoid) }
    catch (error) { log.push(`threw ${error?.message}`) }
    log.push(`state ${renderer.domElement.width}x${renderer.domElement.height} ${renderer.size.x}x${renderer.size.y} ${renderer.ratio} own=${Object.hasOwn(renderer.domElement, 'width')}${Object.hasOwn(renderer.domElement, 'height')}`)
  }
  vi.restoreAllMocks()
  return log
}

describe('compiled native renderer sizing against the frozen JavaScript', () => {
  it('writes the same canvas dimensions and calls the same Three methods for 1200 random resize sequences', () => {
    let staged = 0, skipped = 0, atomic = 0
    for (let seed = 1; seed <= 1200; seed++) {
      const plan = scenario(seed * 2654435761)
      const expected = play(originalConfigure, plan), actual = play(configureNativeRendererSize, plan)
      if (expected.join('\n') !== actual.join('\n')) throw new Error(`seed ${seed}\nexpected:\n${expected.join('\n')}\nactual:\n${actual.join('\n')}`)
      staged += expected.filter(line => line === 'write height 0').length
      atomic += expected.filter(line => line.startsWith('setDrawingBufferSize')).length
      skipped += expected.filter(line => line.startsWith('state')).length
    }
    // The corpus must reach the staging write and the atomic path, not only the plain fall-through.
    expect(staged).toBeGreaterThan(30)
    expect(atomic).toBeGreaterThan(200)
    expect(skipped).toBeGreaterThan(2000)
  }, 120_000)

  it('runs arbitrary operations the same way: values, thrown errors, coercion and cleanup', () => {
    const random = prng(77)
    for (let trial = 0; trial < 800; trial++) {
      const start = { width: 390, height: 192, ratio: 2, variant: random.pick(VARIANTS) }
      const physical = random.pick([{ width: 780, height: 512 }, { width: 785, height: 384 }, { width: 780, height: 384 }, { width: 600, height: 300 }, { width: 0, height: 5 }, { width: 5.5, height: 5 }, undefined, null])
      const steps = Array.from({ length: random.int(0, 4) }, () => [random.pick(['width', 'height']), random.pick([780, 785, 0, 512, 384, '780', 384.25, -1, NaN])])
      const mode = random.pick(['value', 'throw', 'value'])
      const options = random.pick([undefined, {}, { avoidIntermediateAllocation: true }, { avoidIntermediateAllocation: 'bounded' }, { avoidIntermediateAllocation: false }])
      const run = with_ => {
        const log = [], renderer = driver(log, start)
        const operation = () => {
          for (const [axis, value] of steps) {
            try { renderer.domElement[axis] = value } catch (error) { log.push(`assign threw ${error.name}`) }
            log.push(`read ${renderer.domElement.width}x${renderer.domElement.height}`)
          }
          if (mode === 'throw') throw new RangeError('operation failed')
          return 23
        }
        try { log.push(`result ${with_(renderer, operation, physical, options)}`) } catch (error) { log.push(`threw ${error.name} ${error.message}`) }
        log.push(`state ${renderer.domElement.width}x${renderer.domElement.height} own=${Object.hasOwn(renderer.domElement, 'width')}${Object.hasOwn(renderer.domElement, 'height')}`)
        vi.restoreAllMocks()
        return log
      }
      const expected = run(originalWith)
      let actual
      try { actual = run(withNativeCanvasResize) } catch (error) { throw new Error(`trial ${trial}: ${error.message}`) }
      if (expected.join('\n') !== actual.join('\n')) throw new Error(`trial ${trial} ${JSON.stringify({ start, physical, steps, mode, options })}\nexpected:\n${expected.join('\n')}\nactual:\n${actual.join('\n')}`)
    }
  }, 120_000)

  it('does not accumulate JavaScript handles across resize scopes', () => {
    for (let seed = 1; seed <= 20; seed++) play(configureNativeRendererSize, scenario(seed))
    const baseline = rustShelf.shelf_live_handles()
    for (let seed = 21; seed <= 220; seed++) play(configureNativeRendererSize, scenario(seed))
    expect(rustShelf.shelf_live_handles()).toBe(baseline)
  }, 120_000)
})
