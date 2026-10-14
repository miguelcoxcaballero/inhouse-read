import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import * as production from '../../src/js/bookshelf-return.js'
import * as frozen from './helpers/reference-bookshelf-return.js'
import { rustShelf } from './helpers/rust-shelf-ready.js'
import { prng, show } from './helpers/pointer-harness.js'
import { collect } from './helpers/collect.js'

// The return keys, the waiting view and the parked matrices are computed in Rust. Every result is
// compared with the frozen original: strings, thrown errors, microtask timing and float bits.
const outcome = work => { try { return { value: work() } } catch (error) { return { threw: `${error?.name}: ${error?.message}` } } }
const same = (a, b) => Object.is(a, b)

const FIELDS = ['id', 'path', 'name', 'title', 'author', 'format', 'spineTitleOverride', 'spineColorOverride', 'spineFontFamily', 'spineFontSize', 'spineAuthorFontSize',
  'spineFinish', 'spineSurfaceFinish', 'spineTextFinish', 'spineTextColor', 'spineEngraved', 'coverFinish', 'coverRelief', 'pageEdgeFinish', 'progressFraction', 'locator', 'driveFileId']
const VALUES = ['a', 'Ünï 📖', '', '\ud800', 'x'.repeat(40), 0, -0, 1, 12.5, NaN, Infinity, null, undefined, true, false, [1, 'b'], { nested: [1, { deep: null }] }, () => 1, new Date(0)]
const GEOMETRY_KEYS = ['width', 'height', 'thickness', 'viewportWidth', 'viewportHeight', 'centerX', 'centerY']

function book(random) {
  if (random.chance(.05)) return random.pick([null, undefined, 5, 'text', true])
  const record = {}
  for (const key of FIELDS) if (random.chance(.55)) record[key] = random.pick(VALUES)
  if (random.chance(.1)) Object.defineProperty(record, random.pick(FIELDS), { get() { throw new RangeError('getter threw') }, enumerable: true, configurable: true })
  if (random.chance(.05)) record.self = record
  return record
}
function style(random) {
  if (random.chance(.12)) return random.pick([null, undefined, 0, '', 'str', 7, true])
  const keys = ['color', 'shade', 'ink', 'fontFamily', 'fontCanvasFamily', 'fontFallback', 'fontWeight', 'appearanceSource', 'coverRatio', 'width', 'texture', 'é', '10', '2', '1', 'a', 'B', '😀', '￮', 'zz', 'Zz']
  const value = {}
  for (const key of random.chance(.5) ? keys : keys.slice(5)) if (random.chance(.5)) value[key] = random.pick(VALUES)
  return value
}
function geometry(random) {
  const draw = () => random.chance(.8) ? random.pick([1, 12.5, 100.123456789012345, 304.2, 13.827272727272724, 13.827272727272726, 390, 844, 1e21, 1e-7, 5e-324]) + random() * random.pick([0, 1e-13, 1e-9, 1])
    : random.pick([0, -0, -3, NaN, Infinity, '5', null, undefined, 1n, true])
  if (random.chance(.04)) return random.pick([null, undefined, 0, '', 'str', 5, true, []])
  const value = {}
  for (const key of random.chance(.5) ? GEOMETRY_KEYS : [...GEOMETRY_KEYS].reverse()) if (random.chance(.93)) value[key] = draw()
  if (random.chance(.1)) value.extra = random.pick([1, 'x', NaN])
  if (random.chance(.04)) Object.defineProperty(value, random.pick(GEOMETRY_KEYS), { get() { return 5 }, enumerable: random.chance(.5), configurable: true })
  return value
}

describe('compiled return keys against the frozen JavaScript', () => {
  it('writes the same signature or the same error for 30000 random cases', () => {
    const random = prng(2468)
    let strings = 0, nulls = 0, errors = 0
    for (let trial = 0; trial < 30000; trial++) {
      const args = [book(random), style(random), geometry(random), random.pick(['blob:x', null, undefined, 'blob:y', 7])]
      const expected = outcome(() => frozen.bookReturnSignature(...args)), actual = outcome(() => production.bookReturnSignature(...args))
      if (show(actual) !== show(expected)) throw new Error(`trial ${trial}\nexpected ${show(expected)}\nactual   ${show(actual)}`)
      expected.threw ? errors++ : expected.value === null ? nulls++ : strings++
    }
    expect(strings).toBeGreaterThan(3000)
    expect(nulls).toBeGreaterThan(3000)
    expect(errors).toBeGreaterThan(200)
  })

  it('writes the same compatibility key, with sorted keys and 14-digit canonical dimensions, for 30000 random cases', () => {
    const random = prng(1357)
    let strings = 0, nulls = 0, errors = 0
    for (let trial = 0; trial < 30000; trial++) {
      const args = [book(random), style(random), geometry(random)]
      const expected = outcome(() => frozen.bookReturnCompatibility(...args)), actual = outcome(() => production.bookReturnCompatibility(...args))
      if (show(actual) !== show(expected)) throw new Error(`trial ${trial}\nexpected ${show(expected)}\nactual   ${show(actual)}`)
      expected.threw ? errors++ : expected.value === null ? nulls++ : strings++
    }
    expect(strings).toBeGreaterThan(3000)
    expect(nulls).toBeGreaterThan(3000)
    expect(errors).toBeGreaterThan(200)
  })

  it('reads accessors once, in the original order', () => {
    const order = which => {
      const reads = [], record = {}, definition = { get() { reads.push('field'); return 1 }, enumerable: true }
      Object.defineProperty(record, 'title', definition)
      const geometryValue = { width: 1, height: 1, thickness: 1, viewportWidth: 1, viewportHeight: 1 }
      Object.defineProperty(geometryValue, 'centerX', { get() { reads.push('center'); return 3.1 }, enumerable: true })
      const styleValue = {}
      Object.defineProperty(styleValue, 'texture', { get() { reads.push('style'); return 'x' }, enumerable: true })
      which.bookReturnSignature(record, styleValue, geometryValue, 'u'); which.bookReturnCompatibility(record, styleValue, geometryValue)
      return reads
    }
    expect(order(production)).toEqual(order(frozen))
  })
})

// A cache is compared through everything it does to its views and every microtask it takes to answer.
async function play(api, seed) {
  const random = prng(seed), log = []
  let tick = 0
  const turn = async () => { await Promise.resolve(); tick++ }
  const note = line => log.push(`${tick}: ${line}`)
  const cache = api.createBookReturnCache()
  const views = [], pending = []
  const makeView = id => {
    const mode = random.pick(['promise', 'promise', 'sync-true', 'sync-false', 'sync-other', 'rejects', 'throws', 'thenable', 'none', 'not-function', 'dispose-throws', 'late-true'])
    const view = {
      traceName: `view${id}`,
      dispose() { note(`dispose view${id}`); if (mode === 'dispose-throws') throw new TypeError('dispose failed') }
    }
    if (mode === 'none') return view
    if (mode === 'not-function') { view.prepareReturnAppearance = 7; return view }
    view.prepareReturnAppearance = (record, appearance, url) => {
      note(`prepare view${id} ${show(record?.id)} ${show(url)}`)
      if (mode === 'sync-true') return true
      if (mode === 'sync-false') return false
      if (mode === 'sync-other') return 1
      if (mode === 'throws') throw new RangeError('prepare failed')
      if (mode === 'thenable') return { then(resolve) { note(`thenable view${id}`); resolve(true) } }
      if (mode === 'rejects') return Promise.reject(new Error('decode failed'))
      return new Promise((resolve, reject) => pending.push({ id, resolve, reject }))
    }
    views.push(view)
    return view
  }
  const label = value => value === null ? 'null' : value?.traceName ?? show(value)
  const settle = (name, promise) => promise.then(value => note(`${name} resolved ${label(value)}`), error => note(`${name} rejected ${error?.name}: ${error?.message}`))
  const signatures = ['s1', 's2', 's3', '', null]
  const compat = ['c1', 'c1', 'c1', 'c1', 'c2', undefined, null, '']
  const steps = random.int(20, 60)
  for (let step = 0; step < steps; step++) {
    const roll = random()
    if (roll < .2 || !views.length) {
      const signature = random.pick(signatures), view = random.chance(.06) ? random.pick([null, undefined, 0]) : makeView(views.length), compatibility = random.pick(compat)
      const call = random.chance(.3) ? () => cache.retain(signature, view) : () => cache.retain(signature, view, compatibility)
      note(`retain ${show(signature)} ${label(view)} ${show(compatibility)} -> ${show(outcome(call))}`)
    } else if (roll < .35) {
      const signature = random.pick(signatures)
      note(`take ${show(signature)} -> ${label(outcome(() => cache.take(signature)).value ?? null)}`)
    } else if (roll < .65) {
      const request = random.chance(.04) ? random.pick([undefined, null]) : { signature: random.pick(signatures), compatibility: random.pick(compat), book: { id: 'b' }, style: { color: 'red' }, coverUrl: random.pick(['u1', 'u2']) }
      let promise
      try { promise = cache.takeCompatible(request) } catch (error) { note(`takeCompatible threw ${error?.name}`); continue }
      note(`takeCompatible ${show(request?.signature)} ${show(request?.compatibility)} -> ${promise instanceof Promise ? 'promise' : typeof promise}`)
      settle(`compatible#${step}`, promise)
    } else if (roll < .7) {
      note(`clear -> ${show(outcome(() => cache.clear()))}`)
    } else if (roll < .85 && pending.length) {
      const [job] = pending.splice(random.int(0, pending.length - 1), 1), value = random.pick([true, true, false, 'yes'])
      random.chance(.2) ? (note(`reject view${job.id}`), job.reject(new Error('late failure'))) : (note(`resolve view${job.id} ${show(value)}`), job.resolve(value))
    } else for (let ticks = random.int(1, 5); ticks > 0; ticks--) await turn()
    if (random.chance(.3)) await turn()
  }
  for (const job of pending.splice(0)) job.resolve(random.chance(.5))
  for (let ticks = 0; ticks < 12; ticks++) await turn()
  try { cache.clear() } catch (error) { note(`final clear threw ${error?.message}`) }
  for (let ticks = 0; ticks < 6; ticks++) await turn()
  return log
}

describe('compiled return cache against the frozen JavaScript', () => {
  it('disposes, hands over and answers on the same microtask for 700 random scripts', async () => {
    let handedOver = 0, disposed = 0, rejected = 0, nullAnswers = 0, upgrades = 0
    for (let seed = 1; seed <= 700; seed++) {
      const expected = await play(frozen, seed * 7907), actual = await play(production, seed * 7907)
      if (expected.join('\n') !== actual.join('\n')) {
        const at = expected.findIndex((line, index) => line !== actual[index])
        throw new Error(`seed ${seed} line ${at}\nexpected: ${expected.slice(Math.max(0, at - 3), at + 3).join('\n  ')}\nactual:   ${actual.slice(Math.max(0, at - 3), at + 3).join('\n  ')}`)
      }
      handedOver += expected.filter(line => /resolved view\d+$/.test(line)).length
      disposed += expected.filter(line => /dispose view/.test(line)).length
      rejected += expected.filter(line => / rejected /.test(line)).length
      nullAnswers += expected.filter(line => /resolved null$/.test(line)).length
      upgrades += expected.filter(line => /prepare view/.test(line)).length
    }
    // Hand-overs, disposals, rejections, refusals and real upgrades must all be in the corpus.
    expect(handedOver).toBeGreaterThan(150)
    expect(disposed).toBeGreaterThan(1000)
    expect(rejected).toBeGreaterThan(40)
    expect(nullAnswers).toBeGreaterThan(500)
    expect(upgrades).toBeGreaterThan(100)
  }, 120_000)

  it('frees every handle when the host collects dropped caches, settled or not', async () => {
    await collect()
    const before = rustShelf.shelf_live_handles()
    const settle = async () => { for (let turn = 0; turn < 4; turn++) await Promise.resolve() }
    for (let index = 0; index < 300; index++) {
      const cache = production.createBookReturnCache(), view = { dispose() {}, prepareReturnAppearance: () => Promise.resolve(index % 3 === 0) }
      cache.retain('s', view, 'c'); cache.take('s'); cache.retain('s', view, 'c'); cache.clear(); cache.retain('t', view, 'c')
      if (index % 2) { const pending = cache.takeCompatible({ signature: 'x', compatibility: 'c', book: {}, style: {}, coverUrl: 'u' }); await settle(); await pending }
      // Left holding a view, or in the middle of an upgrade that never answers: the cache is simply dropped.
      if (index % 5 === 0) cache.retain('u', { dispose() {}, prepareReturnAppearance: () => new Promise(() => {}) }, 'c')
    }
    expect(rustShelf.shelf_live_handles()).toBeGreaterThan(before)
    await collect()
    expect(rustShelf.shelf_live_handles()).toBe(before)
  }, 60_000)

  it('keeps a plain, annotatable object whose methods work detached', async () => {
    const cache = production.createBookReturnCache(), { retain, take, takeCompatible, clear } = cache, view = { dispose() {} }
    expect(Object.keys(cache)).toEqual(Object.keys(frozen.createBookReturnCache()))
    cache.note = 'extra'
    expect(retain('s', view)).toBe(true)
    expect(take('s')).toBe(view)
    expect(await takeCompatible({ signature: 's' })).toBeNull()
    expect(clear()).toBeUndefined()
  })
})

describe('compiled parked matrices against the frozen JavaScript', () => {
  const NUMBERS = [0, -0, 1, -1, .5, 12.5, 112, 150, 100, 160, 195, 390, 1e6, 1e-9, NaN, Infinity, -Infinity, '7', null, undefined, true]
  const elementsOf = matrix => Array.from(matrix.elements)
  const sameElements = (a, b) => a.length === b.length && a.every((value, index) => same(value, b[index]))

  it('seats the slot identically for 30000 random entries', () => {
    const random = prng(31)
    let finite = 0
    for (let trial = 0; trial < 30000; trial++) {
      const entry = { x: random.pick(NUMBERS), y: random.pick(NUMBERS), width: random.pick(NUMBERS), depthInset: random.pick([...NUMBERS, 15, 0, .25]) }
      const width = random.chance(.5) ? 390 : random.pick(NUMBERS)
      const expected = outcome(() => elementsOf(frozen.shelfBookSlot(entry, width))), actual = outcome(() => elementsOf(production.shelfBookSlot(entry, width)))
      expect(actual.threw, `trial ${trial}`).toBe(expected.threw)
      if (expected.value) {
        if (!sameElements(actual.value, expected.value)) throw new Error(`trial ${trial} ${show(entry)} ${width}\nexpected ${expected.value}\nactual   ${actual.value}`)
        if (expected.value.every(Number.isFinite)) finite++
      }
    }
    expect(finite).toBeGreaterThan(5000)
    expect(production.shelfBookSlot({ x: 112, y: 150, width: 100 }, 390).elements[14]).toBe(-50)
  })

  const matrixFrom = (random, special) => {
    const make = () => {
      const quaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(random.pick([0, .1, 14 * Math.PI / 180, -Math.PI / 2, Math.PI / 2 - 1e-8, Math.PI / 2 + 1e-9, random() * 6]),
        random.pick([0, .3, -.5236, Math.PI / 2, -Math.PI / 2, Math.PI / 2 - 1e-9, Math.PI / 2 - 3e-4, random() * 6]), random.pick([0, 1, random() * 6]), 'XYZ'))
      const scale = new THREE.Vector3(random.pick([1, .78, 2, -1, 0, 1e-9]), random.pick([1, .78, 2]), random.pick([1, .78, -2]))
      return new THREE.Matrix4().compose(new THREE.Vector3((random() - .5) * 800, (random() - .5) * 800, (random() - .5) * 200), quaternion, scale)
    }
    const matrix = make()
    if (special && random.chance(.15)) matrix.elements[random.int(0, 15)] = random.pick([NaN, Infinity, 0, -0, 1e300])
    if (special && random.chance(.1)) matrix.elements[random.int(0, 11)] += random() * 3
    return matrix
  }
  it('projects 30000 random poses identically, including negative scale, shear and the gimbal boundary', () => {
    const random = prng(41)
    const stage = () => ({ left: random.pick([0, 12, -4.5, NaN, undefined, 1e9]), top: random.pick([0, 76, 12.25, -3, Infinity, null]) })
    let finite = 0, gimbal = 0
    for (let trial = 0; trial < 30000; trial++) {
      const furniture = matrixFrom(random, trial % 3 !== 0), local = matrixFrom(random, trial % 3 !== 0), dimensions = { width: 100, height: 160, thickness: 28 }, rect = stage()
      const expected = frozen.projectShelfBookPose(furniture, local, dimensions, rect), actual = production.projectShelfBookPose(furniture, local, dimensions, rect)
      expect(Object.keys(actual)).toEqual(Object.keys(expected))
      for (const key of Object.keys(expected)) if (!same(actual[key], expected[key])) throw new Error(`trial ${trial} ${key}: expected ${expected[key]} actual ${actual[key]}`)
      if (Object.values(expected).every(Number.isFinite)) finite++
      if (Math.abs(Math.abs(expected.angle) - 90) < .01) gimbal++
    }
    expect(finite).toBeGreaterThan(10000)
    expect(gimbal).toBeGreaterThan(100)
  })

  it('keeps the insertion helper working on the Rust slot', () => {
    const entry = { x: 112, y: 150, width: 100, depthInset: 0 }, slot = production.shelfBookSlot(entry, 390)
    expect(production.shelfBookInsertion(slot, 100).elements[14] - slot.elements[14]).toBe(124)
    expect(production.shelfBookInsertion(slot, 100, 1).elements).toEqual(slot.elements)
  })
})
