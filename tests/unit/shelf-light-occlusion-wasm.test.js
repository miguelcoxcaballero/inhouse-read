import { afterEach, describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import * as production from '../../src/js/shelf-light-occlusion.js'
import * as frozen from './helpers/reference-shelf-light-occlusion.js'
import { rustCore } from './helpers/rust-core-ready.js'
import { prng } from './helpers/pointer-harness.js'

// The cabinet description and the per-render uniforms are computed by the Rust core. Everything
// is compared with the frozen original bit for bit: signed zeros, NaN and infinities included.
const holder = vi.hoisted(() => ({ missing: false }))
vi.mock('../../src/js/rust-core.js', async importOriginal => {
  const actual = await importOriginal()
  return { ...actual, getRustCore: () => holder.missing ? null : actual.getRustCore() }
})
afterEach(() => { holder.missing = false })

// Object.is on every element: signed zeros are told apart, any NaN equals any NaN.
const bits = array => Array.from(array, value => Object.is(value, -0) ? '-0' : String(value)).join(',')
const sameNumber = (a, b) => Object.is(a, b)
const vector = value => [value.x, value.y, value.z]
function expectSameDescription(actual, expected, label) {
  if (expected === null) return expect(actual, label).toBeNull()
  expect(actual, label).not.toBeNull()
  const left = [...vector(expected.centre), ...vector(expected.half), expected.inner, expected.front, expected.through, ...expected.boards]
  const right = [...vector(actual.centre), ...vector(actual.half), actual.inner, actual.front, actual.through, ...actual.boards]
  expect(right.length, label).toBe(left.length)
  left.forEach((value, index) => { if (!sameNumber(value, right[index])) throw new Error(`${label}: field ${index} expected ${value} actual ${right[index]}`) })
  expect(actual.solidSides, label).toBe(expected.solidSides)
  expect(actual.centre).toBeInstanceOf(THREE.Vector3); expect(actual.half).toBeInstanceOf(THREE.Vector3)
}

const NAMES = ['shelf-0-board', 'shelf-12-board', 'top-cap', 'shelf-1-mesh', 'shelf-7-mesh', 'top-mesh', 'left-upright', 'right-upright',
  'shelf--board', 'shelf-x-board', 'xtop-cap', 'top-cap2', 'left-upright ', 'back', undefined, null, 12, '']
const COORDINATES = [0, -0, .0625, .1875, .0005, 1.0005, -.0625, -.0005, 1 / 3, 2.675, 1e-9, -1e-9, 5e-324, 12.5, -300.25, 1234.5678, 9e15, 1e21, -1e21, 1e22, NaN, Infinity, -Infinity]
function box(random) {
  const pick = () => random.chance(.55) ? Math.round((random() - .5) * 4e5) / 1000 : random.chance(.5) ? random.pick(COORDINATES) : (random() - .5) * random.pick([1, 1e3, 1e6])
  const a = [pick(), pick(), pick()], b = random.chance(.8) ? a.map(value => value + (random.chance(.9) ? Math.abs(random() * 500) : pick())) : [pick(), pick(), pick()]
  return new THREE.Box3(new THREE.Vector3(...a), new THREE.Vector3(...b))
}
function part(random, finite) {
  const bounds = box(random)
  if (finite) for (const side of [bounds.min, bounds.max]) for (const axis of ['x', 'y', 'z']) if (!Number.isFinite(side[axis])) side[axis] = random() * 100
  return { name: random.pick(NAMES), bounds: random.chance(.04) ? undefined : bounds }
}
function unit(random, finite) {
  const group = new THREE.Group()
  group.userData.parts = Array.from({ length: random.int(0, 14) }, () => random.chance(.03) ? null : part(random, finite))
  return group
}
function scene(random, finite) {
  const kind = random.int(0, 3)
  if (kind === 0) { const root = unit(random, finite); if (!finite && random.chance(.3)) root.position.set(random() * 100, random() * 100, 0); return root }
  const root = new THREE.Group()
  for (let index = random.int(0, 4); index > 0; index--) {
    const child = random.chance(.1) ? new THREE.Group() : unit(random, finite)
    child.position.set((random() - .5) * 2000, (random() - .5) * 200, (random() - .5) * 200)
    if (random.chance(.4)) child.rotation.set(random() * 6, random() * 6, random() * 6)
    child.scale.set(random.pick([1, 1, .5, 2, -1, 0, 1e-3]), random.pick([1, 1, .5, 2, -1]), random.pick([1, 1, .5, 2, -1]))
    root.add(child)
  }
  return root
}
// The scenes of the real cabinet: floors, uprights and boards named as the furniture builders name them.
function furniture(random) {
  const root = new THREE.Group()
  for (let unitIndex = random.int(1, 3); unitIndex > 0; unitIndex--) {
    const group = new THREE.Group(), parts = [], width = 600, height = 1160, depth = 250
    parts.push({ name: 'left-upright', bounds: new THREE.Box3(new THREE.Vector3(-300, -height, -depth), new THREE.Vector3(-285, 0, 0)) })
    parts.push({ name: 'right-upright', bounds: new THREE.Box3(new THREE.Vector3(285, -height, -depth), new THREE.Vector3(300, 0, 0)) })
    const solid = random.chance(.5)
    for (let board = 0; board < random.int(1, 5); board++) {
      const y = -(board + 1) * (height / 5) + (random() - .5) * 1e-4
      parts.push({ name: solid ? `shelf-${board}-board` : `shelf-${board}-mesh`, bounds: new THREE.Box3(new THREE.Vector3(-300, y - 9, -depth), new THREE.Vector3(300, y + 9, 0)) })
    }
    if (random.chance(.5)) parts.push({ name: 'top-cap', bounds: new THREE.Box3(new THREE.Vector3(-300, 0, -depth), new THREE.Vector3(300, 18, 0)) })
    group.userData.parts = parts
    group.position.x = unitIndex * (width + 24) + random() * 1e-9
    root.add(group)
  }
  return root
}

describe('compiled cabinet description against the frozen JavaScript', () => {
  it('describes 20000 random cabinets, boxes and degenerate parts bit for bit', () => {
    const random = prng(60601)
    let described = 0, empty = 0, capped = 0, solid = 0, nonFinite = 0
    for (let trial = 0; trial < 20000; trial++) {
      const root = trial % 4 === 3 ? furniture(random) : scene(random, trial % 4 === 0)
      const expected = frozen.shelfOccluders(root), actual = production.shelfOccluders(root)
      expectSameDescription(actual, expected, `trial ${trial}`)
      if (expected === null) { empty++; continue }
      described++
      if (expected.boards.length === 8) capped++
      if (expected.solidSides) solid++
      if (![expected.inner, expected.front, ...expected.boards].every(Number.isFinite)) nonFinite++
    }
    // Ordinary cabinets, cabinets without boards, the eight-board cap and non-finite geometry are all reached.
    expect(described).toBeGreaterThan(8000)
    expect(empty).toBeGreaterThan(500)
    expect(capped).toBeGreaterThan(100)
    expect(solid).toBeGreaterThan(2000)
    expect(nonFinite).toBeGreaterThan(300)
  })

  it('rounds board heights to three decimals exactly like toFixed', () => {
    const random = prng(3)
    for (let trial = 0; trial < 20000; trial++) {
      const centre = trial % 3 === 0 ? Math.round(random() * 2e6 - 1e6) / 16 / 64 : trial % 3 === 1 ? (random() - .5) * 10 ** random.int(-6, 22) : random.pick(COORDINATES)
      const root = new THREE.Group()
      root.userData.parts = [{ name: 'shelf-0-board', bounds: new THREE.Box3(new THREE.Vector3(0, centre - 1, 0), new THREE.Vector3(1, centre + 1, 1)) }]
      expectSameDescription(production.shelfOccluders(root), frozen.shelfOccluders(root), `centre ${centre}`)
    }
  })

  it('returns no description without a root, parts or boards', () => {
    expect(production.shelfOccluders(null)).toBeNull()
    expect(production.shelfOccluders(new THREE.Group())).toBeNull()
    const root = new THREE.Group(); root.userData.parts = [{ name: 'left-upright', bounds: new THREE.Box3(new THREE.Vector3(), new THREE.Vector3(1, 1, 1)) }]
    expect(production.shelfOccluders(root)).toBeNull()
  })

  it('fails clearly when the numeric core is missing and releases its arena otherwise', () => {
    const root = furniture(prng(11))
    holder.missing = true
    expect(() => production.shelfOccluders(root)).toThrow('El módulo numérico no está cargado')
    holder.missing = false
    const size = rustCore.memory.buffer.byteLength
    const first = rustCore.alloc_f64(4); rustCore.free_f64(first, 4)
    for (let index = 0; index < 3000; index++) production.shelfOccluders(root)
    expect(rustCore.memory.buffer.byteLength).toBe(size)
    const second = rustCore.alloc_f64(4); rustCore.free_f64(second, 4)
    expect(second).toBe(first)
  })
})

describe('compiled shader uniforms against the frozen JavaScript', () => {
  function camera(random) {
    const view = random.chance(.7) ? new THREE.PerspectiveCamera(random.pick([20, 30, 60, 90]), random.pick([1, .5, 2]), 1, 5000) : new THREE.OrthographicCamera(-500, 500, 500, -500, 1, 5000)
    view.position.set((random() - .5) * 2000, (random() - .5) * 2000, random.pick([1600, -1600, 50, 0]) + random() * 100)
    if (random.chance(.9)) view.lookAt((random() - .5) * 300, -580 + (random() - .5) * 300, -125)
    else view.rotation.set(random() * 6, random() * 6, random() * 6)
    if (random.chance(.05)) view.scale.set(0, 1, 1)
    view.updateMatrixWorld(true)
    return view
  }
  function root(random) {
    const group = random.chance(.5) ? furniture(random) : scene(random, true)
    group.position.set((random() - .5) * 800, (random() - .5) * 800, (random() - .5) * 800)
    if (random.chance(.5)) group.rotation.set((random() - .5) * 2, random() * 6, (random() - .5) * .3)
    const scale = random.pick([1, 1, .75, 1.5, .0625, 0, -1, 1e-6, 1e6])
    group.scale.set(scale, random.chance(.8) ? scale : scale * 1.3, random.chance(.8) ? scale : -scale)
    return group
  }
  const description = (random, scene) => {
    const real = frozen.shelfOccluders(scene)
    if (real && random.chance(.7)) return real
    return { centre: new THREE.Vector3(...[0, 0, 0].map(() => random.pick([...COORDINATES, random() * 500]))), half: new THREE.Vector3(...[0, 0, 0].map(() => random.pick([...COORDINATES, random() * 500]))),
      boards: Array.from({ length: random.int(0, 12) }, () => random.pick([...COORDINATES, random() * 900 - 450])), inner: random.pick([...COORDINATES, 250]), front: random.pick([...COORDINATES, 120]),
      solidSides: random.pick([true, false, 0, 1, undefined, 'yes']), through: random.pick([0, .5, 1, NaN, undefined, -0]) }
  }

  it('fills the same cabinet and board uniforms for 20000 random cabinets, descriptions and cameras', () => {
    const random = prng(777)
    let drawn = 0, capped = 0, degenerate = 0
    for (let trial = 0; trial < 20000; trial++) {
      const group = root(random), view = camera(random), details = description(random, group)
      production.clearShelfOccluders(); frozen.clearShelfOccluders()
      const stateBefore = bits(production.shelfOcclusionUniforms().cabinet) === bits(frozen.shelfOcclusionUniforms().cabinet)
      expect(stateBefore).toBe(true)
      frozen.applyShelfOccluders(group, details, view); production.applyShelfOccluders(group, details, view)
      const expected = frozen.shelfOcclusionUniforms(), actual = production.shelfOcclusionUniforms()
      if (bits(actual.cabinet) !== bits(expected.cabinet) || bits(actual.boards) !== bits(expected.boards))
        throw new Error(`trial ${trial}\nexpected ${[...expected.cabinet, ...expected.boards]}\nactual   ${[...actual.cabinet, ...actual.boards]}`)
      drawn++
      if (details.boards.length > 8) capped++
      if (![...expected.cabinet].every(Number.isFinite)) degenerate++
    }
    expect(drawn).toBe(20000)
    expect(capped).toBeGreaterThan(300)
    expect(degenerate).toBeGreaterThan(300)
  })

  it('keeps its single arena across renders and switches cleanly to a different core', () => {
    const random = prng(5), group = furniture(random), view = camera(random), details = frozen.shelfOccluders(group)
    const size = rustCore.memory.buffer.byteLength
    for (let index = 0; index < 5000; index++) production.applyShelfOccluders(group, details, view)
    expect(rustCore.memory.buffer.byteLength).toBe(size)
    frozen.applyShelfOccluders(group, details, view)
    expect(bits(production.shelfOcclusionUniforms().cabinet)).toBe(bits(frozen.shelfOcclusionUniforms().cabinet))
  })

  it('clears without a cabinet or description and needs the core only to compute', () => {
    const group = furniture(prng(9)), view = camera(prng(10))
    production.applyShelfOccluders(group, frozen.shelfOccluders(group), view)
    expect(production.shelfOcclusionUniforms().cabinet[3]).toBe(1)
    production.applyShelfOccluders(null, null, view)
    expect(production.shelfOcclusionUniforms().cabinet[3]).toBe(0)
    production.applyShelfOccluders(group, frozen.shelfOccluders(group), view)
    production.applyShelfOccluders(group, null, view)
    expect(production.shelfOcclusionUniforms().cabinet[3]).toBe(0)
    holder.missing = true
    production.applyShelfOccluders(null, null, view)
    expect(() => production.applyShelfOccluders(group, frozen.shelfOccluders(group), view)).toThrow('El módulo numérico no está cargado')
  })
})
