import { describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import * as production from '../../src/js/shelf-trash.js'
import * as frozen from './helpers/reference-shelf-trash.js'
import { rustShelf } from './helpers/rust-shelf-ready.js'
import { prng } from './helpers/pointer-harness.js'
import { describeScene, sameNumbers } from './helpers/scene-description.js'

// The wastebasket's numbers run in Rust; three objects are still built in JavaScript. Every value
// is compared bit for bit (signed zeros and NaN included) with the frozen original.
const same = (a, b) => Object.is(a, b)
const bytes = array => Buffer.from(array.buffer, array.byteOffset, array.byteLength).toString('hex')

describe('compiled wastebasket flight against the frozen JavaScript', () => {
  const numbers = [0, -0, .1, .25, .48, .5, .68, .7, 1, 1.5, -3, 12.5, 60, -120, 330, 1e6, 1e300, -1e300, 5e-324, Infinity, -Infinity, NaN]
  const progresses = [...numbers, '0.5', 'x', '', null, undefined, true, false, [], [0.3], {}, { valueOf: () => .4 }]
  const options = [undefined, {}, { height: 0 }, { height: NaN }, { height: -5 }, { height: 1e308 }, { height: '40' }, { height: null },
    { scale: 0 }, { scale: -1 }, { scale: 2.5 }, { scale: NaN }, { endScale: 0 }, { endScale: NaN }, { endScale: 1 }, { endScale: '.5' },
    { height: 90, scale: .7, endScale: .3 }, { height: undefined, scale: undefined, endScale: undefined }]

  it('returns the same position, scale, turn and fall for 60000 random drops', () => {
    const random = prng(8128)
    const coordinate = () => random.chance(.5) ? random.pick(numbers) : (random() - .5) * random.pick([10, 1000, 1e5])
    let finite = 0, nonFinite = 0
    for (let trial = 0; trial < 60000; trial++) {
      const start = new THREE.Vector3(coordinate(), coordinate(), coordinate()), mouth = new THREE.Vector3(coordinate(), coordinate(), coordinate())
      const progress = random.chance(.6) ? random() * 1.2 - .1 : random.pick(progresses), option = random.pick(options)
      const expected = frozen.sampleTrashDrop(start, mouth, progress, option), actual = production.sampleTrashDrop(start, mouth, progress, option)
      const fields = value => [value.position.x, value.position.y, value.position.z, value.scale, value.turn, value.fall]
      const left = fields(expected), right = fields(actual)
      if (!left.every((value, index) => same(value, right[index]))) throw new Error(`trial ${trial} ${JSON.stringify({ progress, option })}\nexpected ${left}\nactual   ${right}`)
      expect(actual.position).toBeInstanceOf(THREE.Vector3)
      expect(actual.position).not.toBe(start)
      left.every(Number.isFinite) ? finite++ : nonFinite++
    }
    // Ordinary flights and degenerate ones must both be in the corpus.
    expect(finite).toBeGreaterThan(20000)
    expect(nonFinite).toBeGreaterThan(5000)
  })

  it('leaves the start untouched and keeps working after many calls without growing the handle table', () => {
    const start = new THREE.Vector3(1, 2, 3), mouth = new THREE.Vector3(4, 5, 6), before = rustShelf.shelf_live_handles()
    for (let index = 0; index < 5000; index++) production.sampleTrashDrop(start, mouth, index / 5000)
    expect(start.toArray()).toEqual([1, 2, 3])
    expect(rustShelf.shelf_live_handles()).toBe(before)
  })
})

function parts(root) {
  const meshes = []
  root.traverse(node => meshes.push(node))
  return meshes.map(node => {
    const material = node.material
    const maps = material ? ['roughnessMap', 'bumpMap'].map(key => material[key] && { data: bytes(material[key].image.data), repeat: material[key].repeat.toArray(), wrap: [material[key].wrapS, material[key].wrapT], filters: [material[key].magFilter, material[key].minFilter], mipmaps: material[key].generateMipmaps }) : null
    return {
      type: node.type, name: node.name, position: node.position.toArray(), rotation: [node.rotation.x, node.rotation.y, node.rotation.z, node.rotation.order],
      shadow: [node.castShadow, node.receiveShadow],
      geometry: node.geometry && {
        type: node.geometry.type, index: node.geometry.index && bytes(node.geometry.index.array),
        attributes: Object.fromEntries(Object.entries(node.geometry.attributes).map(([name, attribute]) => [name, bytes(attribute.array)]))
      },
      material: material && { type: material.type, color: material.color.getHex(), roughness: material.roughness, metalness: material.metalness, vertexColors: material.vertexColors,
        clearcoat: material.clearcoat, bumpScale: material.bumpScale, maps }
    }
  })
}

describe('compiled wastebasket geometry against the frozen JavaScript', () => {
  const configs = [undefined, {}, { radius: 44, height: 140 }, { radius: 12, height: 30 }, { radius: 100, height: 500 }, { radius: 0.5, height: 1000 },
    { radius: NaN, height: 'x' }, { radius: -5 }, { radius: '60', height: '90' }, { radius: 20 }, { height: 31 }, { radius: 1e3, height: 1e3 }]

  it('builds the same shells, shading normals, colours, textures and transforms', () => {
    for (const config of configs) {
      const expected = frozen.createShelfTrash(config), actual = production.createShelfTrash(config)
      expect(parts(actual), JSON.stringify(config)).toEqual(parts(expected))
      expect(actual.userData.radius).toBe(expected.userData.radius)
      expect(actual.userData.height).toBe(expected.userData.height)
      expected.userData.dispose(); actual.userData.dispose()
    }
  })

  it('generates the 64 px powder coat identically and not twice per bin', () => {
    const bytesOf = bin => Buffer.from(bin.getObjectByName('Open metal body').material.roughnessMap.image.data)
    const expected = frozen.createShelfTrash(), actual = production.createShelfTrash()
    expect(bytesOf(actual).length).toBe(64 * 64 * 4)
    expect(bytesOf(actual).equals(bytesOf(expected))).toBe(true)
    const texture = actual.getObjectByName('Open metal body').material.roughnessMap
    expect(texture.image.data).toBeInstanceOf(Uint8Array)
    expect(actual.getObjectByName('Open metal body').material.bumpMap).toBe(texture)
    expected.userData.dispose(); actual.userData.dispose()
  })

  it('leans any normals array like the original, including NaN, infinities, zeros and indices past the array', () => {
    const random = prng(5150)
    const originalLean = (array, segments, rows, from, to, amount) => {
      const normal = new THREE.BufferAttribute(array, 3), lean = new THREE.Vector3()
      for (let i = 0; i <= segments; i++) for (let j = from; j <= to; j++) {
        const k = i * rows + j
        lean.fromBufferAttribute(normal, k); lean.y += amount; lean.normalize(); normal.setXYZ(k, lean.x, lean.y, lean.z)
      }
    }
    const pool = [0, -0, 1, -1, .5, 1e-30, 1e30, 3e38, NaN, Infinity, -Infinity, 1e-45, -2.5]
    let touched = 0
    for (let trial = 0; trial < 1500; trial++) {
      const length = random.int(0, 40) * 3, source = new Float32Array(length).map(() => random.chance(.7) ? random() * 2 - 1 : random.pick(pool))
      const segments = random.int(0, 8), rows = random.int(0, 9), from = random.int(0, 9), to = random.int(0, 9), amount = random.pick([.38, .5, 0, -.5, NaN, 1e300, -0, 2.5])
      const expected = Float32Array.from(source), actual = Float32Array.from(source)
      originalLean(expected, segments, rows, from, to, amount)
      rustShelf.lean_normals(actual, segments, rows, from, to, amount)
      expect(bytes(actual), `trial ${trial}`).toBe(bytes(expected))
      if (bytes(actual) !== bytes(source)) touched++
    }
    expect(touched).toBeGreaterThan(500)
  })

  it('does not accumulate JavaScript handles across create and dispose cycles', () => {
    const before = rustShelf.shelf_live_handles()
    for (let index = 0; index < 200; index++) production.createShelfTrash({ radius: 20 + index % 30, height: 60 + index % 50 }).userData.dispose()
    expect(rustShelf.shelf_live_handles()).toBe(before)
  })
})

// The whole bin (size coercion, every part's geometry, transform, draw groups and materials, the lid's
// motion and the mouth) is built from Rust packets now; the frozen original remains the oracle.
describe('compiled wastebasket model, lid and mouth against the frozen JavaScript', () => {
  const values = [0, -0, .2, .5, .51, 1, 1.5, -1, NaN, Infinity, -Infinity, '0.3', 'x', '', null, undefined, true, false, [], [.4], { valueOf: () => .7 }]
  const configs = [undefined, {}, { radius: 20, height: 90 }, { radius: '60', height: 31 }, { radius: NaN, height: 'x' }, { radius: -5 }, { radius: 0, height: 0 },
    { radius: 1e3, height: 1e3 }, { radius: 12.0001, height: 30.5 }, { radius: { valueOf: () => 33 } }]

  it('builds the same nodes, attributes, groups, transforms and materials', () => {
    for (const config of configs) {
      const expected = frozen.createShelfTrash(config), actual = production.createShelfTrash(config)
      expect(describeScene(actual), JSON.stringify(config)).toEqual(describeScene(expected))
      expect([actual.userData.radius, actual.userData.height]).toEqual([expected.userData.radius, expected.userData.height])
      expected.userData.dispose(); actual.userData.dispose()
    }
  })

  it('opens, wobbles and reports its mouth like the original for every coerced value', () => {
    for (const config of configs.slice(0, 5)) {
      const expected = frozen.createShelfTrash(config), actual = production.createShelfTrash(config)
      const state = bin => [bin.userData.lid.rotation.x, bin.userData.lid.rotation.y, bin.userData.lid.rotation.z, bin.userData.lid.rotation.order, bin.userData.openness]
      expect(state(actual)).toEqual(state(expected))
      for (const openness of values) for (const bounce of values) {
        expected.userData.setState({ openness, bounce }); actual.userData.setState({ openness, bounce })
        const left = state(expected), right = state(actual)
        if (!sameNumbers(left, right)) throw new Error(`${JSON.stringify({ config, openness, bounce })}: ${left} / ${right}`)
      }
      expected.userData.setState(); actual.userData.setState()
      expect(sameNumbers(state(actual), state(expected))).toBe(true)
      for (const bin of [expected, actual]) { bin.position.set(3, -4, 5); bin.rotation.y = .3; bin.updateMatrixWorld(true) }
      expect(actual.userData.getMouth().toArray()).toEqual(expected.userData.getMouth().toArray())
      expect(actual.userData.lid).toBe(actual.getObjectByName('Hinged wastebasket lid'))
      expected.userData.dispose(); actual.userData.dispose()
    }
  })

  it('reads a throwing bounce only after it has turned the lid, as the original did', () => {
    const expected = frozen.createShelfTrash(), actual = production.createShelfTrash()
    const bad = { valueOf() { throw new Error('bounce') } }
    for (const bin of [expected, actual]) expect(() => bin.userData.setState({ openness: .5, bounce: bad })).toThrow('bounce')
    expect(actual.userData.lid.rotation.x).toBe(expected.userData.lid.rotation.x)
    expect(actual.userData.lid.rotation.z).toBe(expected.userData.lid.rotation.z)
    expect(actual.userData.openness).toBe(expected.userData.openness)
  })

  it('disposes every geometry, material and the coat texture once', () => {
    const bin = production.createShelfTrash(), spies = [], materials = new Set()
    bin.traverse(node => { if (node.geometry) spies.push(vi.spyOn(node.geometry, 'dispose')); if (node.material) materials.add(node.material) })
    for (const material of materials) spies.push(vi.spyOn(material, 'dispose'))
    spies.push(vi.spyOn(bin.getObjectByName('Open metal body').material.roughnessMap, 'dispose'))
    expect(materials.size).toBe(6)
    bin.userData.dispose(); bin.userData.dispose()
    for (const spy of spies) expect(spy).toHaveBeenCalledTimes(1)
  })
})
