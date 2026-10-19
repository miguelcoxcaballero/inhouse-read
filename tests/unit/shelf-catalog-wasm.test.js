import { afterEach, describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import * as production from '../../src/js/shelf-catalog.js'
import * as frozen from './helpers/reference-shelf-catalog.js'
import { rustShelf } from './helpers/rust-shelf-ready.js'
import { describeScene } from './helpers/scene-description.js'

// The catalogue's cover art and model run in Rust (rust-ui/src/shelf_catalog.rs); the canvas, its texture and
// the three.js objects are made in JavaScript. Both are compared with the frozen original: every canvas
// operation and its arguments in order, and every node, attribute byte, transform and material.

/** A 2D context that records every property write and method call, including those on its gradients. */
function recordingContext(log) {
  const recorder = name => new Proxy({}, {
    get: (_, key) => key === Symbol.toPrimitive || key === 'then' ? undefined : (...args) => {
      log.push([`${name}.${String(key)}`, ...args.map(value => typeof value === 'object' ? value?.label ?? value : value)])
      return key.startsWith('create') ? Object.assign(recorder(`${name}>${key}#${log.length}`), {}) : undefined
    },
    set: (_, key, value) => { log.push([`${name}=${String(key)}`, typeof value === 'object' ? 'gradient' : value]); return true }
  })
  return recorder('context')
}

function withCanvas(build) {
  const logs = []
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function () {
    const log = [`${this.width}x${this.height}`]; logs.push(log); return recordingContext(log)
  })
  const catalogue = build()
  vi.restoreAllMocks()
  return { catalogue, logs }
}

afterEach(() => vi.restoreAllMocks())
// jsdom cannot encode a canvas; the serialised cover image is compared through the recorded operations instead.
HTMLCanvasElement.prototype.toDataURL = () => 'data:,'

describe('compiled paper catalogue against the frozen JavaScript', () => {
  const configs = [undefined, {}, { width: 76, height: 108, thickness: 3.4 }, { width: 60, height: 90, thickness: 2 }, { width: 120, height: 80, thickness: 6 },
    { width: 30, height: 200, thickness: .5 }, { width: 76.3, height: 107.9, thickness: 3.41 }]

  it('paints the same cover, operation by operation, and builds the same paper, clip and pin', () => {
    for (const config of configs) {
      const expected = withCanvas(() => frozen.createShelfCatalog(config)), actual = withCanvas(() => production.createShelfCatalog(config))
      expect(actual.logs.length).toBe(1)
      expect(actual.logs[0].length).toBeGreaterThan(2000)
      expect(actual.logs, JSON.stringify(config)).toEqual(expected.logs)
      expect(describeScene(actual.catalogue), JSON.stringify(config)).toEqual(describeScene(expected.catalogue))
      for (const key of ['width', 'height', 'thickness', 'catalog']) expect(actual.catalogue.userData[key]).toBe(expected.catalogue.userData[key])
      expect(actual.catalogue.userData.bounds.min.toArray()).toEqual(expected.catalogue.userData.bounds.min.toArray())
      expect(actual.catalogue.userData.bounds.max.toArray()).toEqual(expected.catalogue.userData.bounds.max.toArray())
      const texture = catalogue => catalogue.getObjectByName('catalog-front-cover').material.map
      for (const key of ['colorSpace', 'anisotropy', 'isCanvasTexture']) expect(texture(actual.catalogue)[key]).toBe(texture(expected.catalogue)[key])
      expect([texture(actual.catalogue).image.width, texture(actual.catalogue).image.height]).toEqual([texture(expected.catalogue).image.width, texture(expected.catalogue).image.height])
      expected.catalogue.userData.dispose(); actual.catalogue.userData.dispose()
    }
  })

  it('builds the same model without a 2D context, as in a headless or failed canvas', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => null)
    const expected = frozen.createShelfCatalog(), actual = production.createShelfCatalog()
    expect(describeScene(actual)).toEqual(describeScene(expected))
    expected.userData.dispose(); actual.userData.dispose()
  })

  it('stops at the first failing canvas operation, like the original', () => {
    const failing = () => {
      let calls = 0
      vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => new Proxy({}, {
        get: (_, key) => key === 'fillRect' ? () => { if (++calls === 40) throw new Error('canvas lost') } : () => ({ addColorStop() {} }),
        set: () => true
      }))
      return () => calls
    }
    let count = failing()
    expect(() => frozen.createShelfCatalog()).toThrow('canvas lost')
    const expected = count()
    vi.restoreAllMocks(); count = failing()
    expect(() => production.createShelfCatalog()).toThrow('canvas lost')
    expect(count()).toBe(expected)
  })

  it('disposes its geometries, materials and cover texture once and keeps no module handles', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => null)
    const before = rustShelf.shelf_live_handles()
    for (let index = 0; index < 50; index++) production.createShelfCatalog({ width: 60 + index, height: 100, thickness: 3 }).userData.dispose()
    expect(rustShelf.shelf_live_handles()).toBe(before)
    const catalogue = production.createShelfCatalog(), spies = []
    const materials = new Set()
    catalogue.traverse(node => { if (node.geometry) spies.push(vi.spyOn(node.geometry, 'dispose')); if (node.material) materials.add(node.material) })
    expect(materials.size).toBe(4)
    for (const material of materials) spies.push(vi.spyOn(material, 'dispose'))
    spies.push(vi.spyOn(catalogue.getObjectByName('catalog-front-cover').material.map, 'dispose'))
    catalogue.userData.dispose(); catalogue.userData.dispose()
    for (const spy of spies) expect(spy).toHaveBeenCalledTimes(1)
  })

  it('keeps the bounds a THREE.Box3 of the whole object', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => null)
    const catalogue = production.createShelfCatalog()
    expect(catalogue.userData.bounds).toBeInstanceOf(THREE.Box3)
    catalogue.userData.dispose()
  })
})
