import { afterEach, describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import * as lighting from '../../src/js/shelf-lighting.js'
import * as frozenLighting from './helpers/reference-shelf-lighting.js'
import * as occlusion from '../../src/js/shelf-light-occlusion.js'
import * as frozenOcclusion from './helpers/reference-shelf-light-occlusion.js'
import { applyBookReflectionSurface } from '../../src/js/book-reflection-surface.js'
import { applyBookReflectionSurface as frozenReflection } from './helpers/reference-book-reflection-surface.js'
import { rustShelf } from './helpers/rust-shelf-ready.js'
import { prng } from './helpers/pointer-harness.js'

// The key light's rig, the variance light-bleed patch, the back panel's Vogel disk, the cabinet parts the lamp
// occlusion reads and the clamps of the cover reflection's setters run in Rust (rust-ui/src/shelf_light_rig.rs,
// book_reflection.rs). Each is compared with its frozen original.
afterEach(() => vi.unstubAllGlobals())
const screens = [[1024, 768], [390, 844], [599, 1200], [600, 600], [0, 0], [undefined, 700], [1280, 599]]

describe('shelf light rig against the frozen JavaScript', () => {
  it('writes the same back-panel shader, taps and cache key on every screen', () => {
    for (const [width, height] of screens) {
      vi.stubGlobal('innerWidth', width); vi.stubGlobal('innerHeight', height)
      const mine = lighting.widePenumbra(new THREE.MeshStandardMaterial()), theirs = frozenLighting.widePenumbra(new THREE.MeshStandardMaterial())
      expect(mine.defines, `${width}x${height}`).toEqual(theirs.defines)
      expect(mine.customProgramCacheKey()).toBe(theirs.customProgramCacheKey())
      const shader = () => ({ fragmentShader:THREE.ShaderLib.physical.fragmentShader, uniforms:{} })
      const a = shader(), b = shader()
      mine.onBeforeCompile(a); theirs.onBeforeCompile(b)
      expect(a.fragmentShader).toBe(b.fragmentShader)
      expect(a.fragmentShader).toContain('getPanelShadow')
    }
  })

  it('sets up the same key light shadow and patches the same variance chunk', () => {
    const original = THREE.ShaderChunk.shadowmap_pars_fragment
    const rig = (create, [width, height]) => {
      vi.stubGlobal('innerWidth', width); vi.stubGlobal('innerHeight', height)
      THREE.ShaderChunk.shadowmap_pars_fragment = original
      const scene = new THREE.Scene(), key = new THREE.DirectionalLight('#fff', 2)
      key.position.set(-300, 600, 400); scene.userData.readerLight = key
      const renderer = { shadowMap:{} }
      const manager = create(scene, renderer)
      const shadow = key.shadow
      const facts = [key.castShadow, shadow.mapSize.x, shadow.mapSize.y, shadow.bias, shadow.normalBias, shadow.radius, shadow.blurSamples,
        shadow.intensity, shadow.autoUpdate, THREE.ShaderChunk.shadowmap_pars_fragment]
      manager.update({ width:390, viewportHeight:700, depth:250, scroll:0, moving:true })
      facts.push(shadow.blurSamples, shadow.radius, manager.settling)
      manager.update({ width:390, viewportHeight:700, depth:250, scroll:0, moving:false })
      facts.push(shadow.blurSamples, manager.settling)
      manager.dispose()
      return facts
    }
    try {
      for (const screen of screens) expect(rig(lighting.createShelfLighting, screen), String(screen)).toEqual(rig(frozenLighting.createShelfLighting, screen))
      THREE.ShaderChunk.shadowmap_pars_fragment = 'a later three without the floor'
      expect(rustShelf.shelf_firm_bleed('a later three without the floor')).toBeUndefined()
    } finally { THREE.ShaderChunk.shadowmap_pars_fragment = original }
  })
})

describe('lamp occluders against the frozen JavaScript', () => {
  const names = ['shelf-0-board', 'shelf-12-board', 'shelf--board', 'shelf-a-board', 'top-cap', 'shelf-3-mesh', 'shelf-x3-mesh', 'top-mesh',
    'left-upright', 'right-upright', 'centre-upright', 'Shelf-1-board', 'shelf-1-board ', '', undefined, 7, 'top-cap-2']
  it('classifies and records the same parts for random cabinets', () => {
    const random = prng(4242)
    let described = 0
    for (let trial = 0; trial < 400; trial++) {
      const unit = () => {
        const group = new THREE.Group()
        group.position.set(random() * 200 - 100, random() * 50, random() * 10)
        group.userData.parts = Array.from({ length:random.int(0, 12) }, () => {
          if (random.chance(.05)) return null
          const min = new THREE.Vector3(random() * 600 - 300, -random() * 1160, -random() * 250), max = min.clone().add(new THREE.Vector3(random() * 300, random() * 30, random() * 250))
          return { name:random.pick(names), ...(random.chance(.9) ? { bounds:new THREE.Box3(min, max) } : {}) }
        })
        return group
      }
      let root
      if (random.chance(.4)) root = unit()
      else { root = new THREE.Group(); for (let k = random.int(0, 3); k > 0; k--) root.add(unit()); root.add(new THREE.Group()) }
      const expected = frozenOcclusion.shelfOccluders(root), actual = occlusion.shelfOccluders(root)
      if (expected === null) { expect(actual, `trial ${trial}`).toBeNull(); continue }
      described++
      expect([...actual.centre.toArray(), ...actual.half.toArray(), actual.inner, actual.front, actual.through, actual.solidSides, ...actual.boards], `trial ${trial}`)
        .toEqual([...expected.centre.toArray(), ...expected.half.toArray(), expected.inner, expected.front, expected.through, expected.solidSides, ...expected.boards])
    }
    expect(described).toBeGreaterThan(100)
  })
})

describe('cover reflection setters against the frozen JavaScript', () => {
  const values = [0, -0, .01, .018, .05, .2, 1, 1.5, -1, NaN, Infinity, -Infinity, '0.3', 'x', '', null, undefined, true, [], [.5], { valueOf:() => .02 }]
  const scales = [undefined, null, [2, 3], [0, -1], [NaN, 4], { x:2, y:5 }, { 0:3, y:9 }, ['2', '7'], [undefined, 6], [Infinity, 1], 5, 'xy', [[2]]]
  it('clamps strength, environment and UV scale exactly as before', () => {
    const uniforms = material => {
      const u = material.userData.bookReflectionSurface.uniforms
      return [u.bookReflectionStrength.value, u.bookEnvironmentReflection.value, ...u.bookReflectionUvScale.value.toArray(), ...u.bookReflectionPhase.value.toArray()]
    }
    const a = applyBookReflectionSurface(new THREE.MeshPhysicalMaterial(), { seed:'book:1' }), b = frozenReflection(new THREE.MeshPhysicalMaterial(), { seed:'book:1' })
    expect(uniforms(a)).toEqual(uniforms(b))
    for (const value of values) {
      for (const material of [a, b]) { material.userData.bookReflectionSurface.setStrength(value); material.userData.bookReflectionSurface.setEnvironmentReflection(value) }
      expect(uniforms(a), String(value)).toEqual(uniforms(b))
    }
    for (const scale of scales) {
      for (const material of [a, b]) material.userData.bookReflectionSurface.setUvScale(scale)
      expect(uniforms(a), JSON.stringify(scale)).toEqual(uniforms(b))
    }
    for (const options of [{ seed:'other', strength:.014, uvScale:[2, 4], environmentReflection:.4 }, { strength:'x', uvScale:null, environmentReflection:NaN }]) {
      applyBookReflectionSurface(a, options); frozenReflection(b, options)
      expect(uniforms(a), JSON.stringify(options)).toEqual(uniforms(b))
    }
  })
})
