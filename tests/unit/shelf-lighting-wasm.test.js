// @vitest-environment node
import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { loadRustCore, getRustCore } from '../../src/js/rust-core.js'
import { createShelfLighting } from '../../src/js/shelf-lighting.js'
import { createShelfLighting as createReference } from './helpers/reference-shelf-lighting.js'
import { prng } from './helpers/pointer-harness.js'

let core
beforeAll(async () => {
  core = await loadRustCore({ bytes: readFileSync(new URL('../../src/wasm/inhouse_read_core.wasm', import.meta.url)) })
  expect(typeof core?.shelf_light_update).toBe('function')
})

const observe = (key, renderer, lighting, result) => {
  const camera = key.shadow.camera
  return [result, lighting.settling, ...key.position.toArray(), ...key.target.position.toArray(), camera.left, camera.right, camera.top,
    camera.bottom, camera.near, camera.far, ...camera.projectionMatrix.elements, key.shadow.normalBias, key.shadow.radius, key.shadow.blurSamples,
    key.shadow.needsUpdate, renderer.shadowMap.needsUpdate, ...key.matrixWorld.elements, ...key.target.matrixWorld.elements]
}
const same = (a, b) => a.length === b.length && a.every((value, index) => Object.is(value, b[index]))

function makeRig(create, seed) {
  const scene = new THREE.Scene(), key = new THREE.DirectionalLight()
  const random = prng(seed)
  key.position.set(random.pick([-.46, .3, 1.7]), random.pick([.42, 1, 2.5]), random.pick([1, -1.2, 3]))
  key.target.position.set(random.pick([0, 12.5]), 0, random.pick([0, -3]))
  scene.userData.readerLight = key; scene.add(key)
  let updates = 0
  const original = key.shadow.updateMatrices.bind(key.shadow)
  key.shadow.updateMatrices = light => { updates++; return original(light) }
  const renderer = { shadowMap: { needsUpdate: false } }
  const lighting = create(scene, renderer)
  return { scene, key, renderer, lighting, get matrices() { return updates } }
}

function frames(seed, count) {
  const random = prng(seed)
  const dims = () => ({ width: random.pick([390, 390, 800, 1280, 1280.004]), viewportHeight: random.pick([700, 844, 860]), depth: random.pick([160, 160, 210.5]) })
  let current = { ...dims(), scroll: random.pick([0, 300]) }
  let transform = new THREE.Matrix4().makeTranslation(random.pick([0, 40]), 0, 0)
  let bounds = new THREE.Box3(new THREE.Vector3(210, -2000, -170), new THREE.Vector3(1070, 0, 12))
  const list = []
  for (let index = 0; index < count; index++) {
    const roll = random()
    const options = { ...current }
    if (roll < .25) current = { ...current, scroll: current.scroll + random.pick([-500, -37, 1, 12, 300, 2000]) }
    else if (roll < .3) current = { ...current, ...dims() }
    else if (roll < .6) {
      // A finger zoom or pan: the same similarity moves the transform and the bounds.
      const scale = random.pick([1, 1, 1.01, 1.5, .8, 2.5]), shift = random.pick([[0, 0, 0], [12, -30, 0], [-200, 80.5, 0]])
      const similarity = new THREE.Matrix4().makeTranslation(...shift).multiply(new THREE.Matrix4().makeScale(scale, scale, scale))
      transform = new THREE.Matrix4().multiplyMatrices(similarity, transform)
      bounds = bounds.clone().applyMatrix4(similarity)
    } else if (roll < .65) {
      transform = new THREE.Matrix4().makeRotationY(random.pick([.1, .5, 1])).multiply(transform)
      bounds = new THREE.Box3(new THREE.Vector3(210 + random.int(-5, 5), -2000, -170), new THREE.Vector3(1070 + random.int(-5, 5), 0, 12))
    }
    options.scroll = current.scroll
    if (random.chance(.75)) options.bounds = random.chance(.97) ? bounds : new THREE.Box3()
    else if (random.chance(.3)) options.bounds = null
    if (random.chance(.8)) options.transform = random.chance(.97) ? transform : new THREE.Matrix4().set(...Array.from({ length: 16 }, () => random() * 3 - 1))
    else if (random.chance(.3)) options.transform = null
    if (random.chance(.7)) options.dirty = random.pick([false, false, true, 0, 1, '', 'x', null, undefined])
    if (random.chance(.3)) options.moving = random.pick([true, false, 1, 0, 'yes', null])
    if (random.chance(.08)) options.forceRefit = random.pick([true, 1, false])
    if (random.chance(.02)) options.width = random.pick([NaN, Infinity, -5, 1e21, 1e22, -0.004])
    list.push(options)
  }
  return list
}

describe('compiled shelf lighting against the frozen JavaScript fit', () => {
  it('moves the same light, camera, flags and matrices for 300 random frame sequences', () => {
    let refits = 0, transports = 0, calls = 0
    for (let seed = 1; seed <= 300; seed++) {
      const expected = makeRig(createReference, seed), actual = makeRig(create, seed)
      expect(getRustCore()).toBe(core)
      const sequence = frames(seed * 31, 60)
      sequence.forEach((options, index) => {
        const before = expected.matrices, left0 = expected.key.shadow.camera.left
        const a = observe(expected.key, expected.renderer, expected.lighting, expected.lighting.update({ ...options }))
        const b = observe(actual.key, actual.renderer, actual.lighting, actual.lighting.update({ ...options }))
        if (!same(a, b)) throw new Error(`seed ${seed} frame ${index}: ${a.map((value, at) => Object.is(value, b[at]) ? '' : `[${at}] ${value} vs ${b[at]}`).filter(Boolean).join('; ')}`)
        expect(actual.matrices).toBe(expected.matrices)
        if (expected.matrices > before) transports++
        calls++
        if (expected.matrices === before && !Object.is(expected.key.shadow.camera.left, left0)) refits++
        expected.renderer.shadowMap.needsUpdate = actual.renderer.shadowMap.needsUpdate = false
        expected.key.shadow.needsUpdate = actual.key.shadow.needsUpdate = false
      })
      expected.lighting.dispose(); actual.lighting.dispose()
    }
    expect(calls).toBe(300 * 60)
    // The corpus must exercise the cached-map path, not only refits.
    expect(transports).toBeGreaterThan(500)
    expect(refits).toBeGreaterThan(1000)
  }, 120_000)

  it('releases its rig and arena on dispose and survives memory growth between frames', () => {
    const rig = makeRig(create, 5)
    const before = core.memory.buffer.byteLength
    rig.lighting.update({ width: 390, viewportHeight: 700, scroll: 0, depth: 160 })
    core.memory.grow(1)
    expect(() => rig.lighting.update({ width: 390, viewportHeight: 700, scroll: 20, depth: 160, dirty: false })).not.toThrow()
    expect(core.memory.buffer.byteLength).toBeGreaterThan(before)
    rig.lighting.dispose(); rig.lighting.dispose()
    expect(rig.lighting.update({ width: 390, viewportHeight: 700, scroll: 0, depth: 160 })).toBe(false)
  })
})

const create = createShelfLighting
