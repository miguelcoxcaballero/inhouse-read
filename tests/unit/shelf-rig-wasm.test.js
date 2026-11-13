import { afterEach, describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import * as lighting from '../../src/js/shelf-lighting.js'
import * as frozenLighting from './helpers/reference-shelf-lighting.js'
import * as occlusion from '../../src/js/shelf-light-occlusion.js'
import * as frozenOcclusion from './helpers/reference-shelf-light-occlusion.js'
import { applyBookReflectionSurface } from '../../src/js/book-reflection-surface.js'
import { applyBookReflectionSurface as frozenReflection } from './helpers/reference-book-reflection-surface.js'
import { rustShelf } from './helpers/rust-shelf-ready.js'
import { installShelfLightOcclusion as frozenOcclusionPatch } from './helpers/reference-shelf-light-occlusion-patch.js'
import { readFileSync } from 'node:fs'
import { prng } from './helpers/pointer-harness.js'

// The key light's rig, the variance light-bleed patch, the back panel's Vogel disk, the cabinet parts the lamp
// occlusion reads and the clamps of the cover reflection's setters run in Rust (rust-ui/src/shelf_light_rig.rs,
// book_reflection.rs). Each is compared with its frozen original.
afterEach(() => vi.unstubAllGlobals())
// three's two light chunks as it ships them: the imported module's own are already patched.
const threeBuild = readFileSync('node_modules/three/build/three.module.js', 'utf8')
const stockChunk = name => JSON.parse(threeBuild.match(new RegExp(`^var ${name} = (".*");$`, 'm'))[1])
const stockLightsBegin = stockChunk('lights_fragment_begin'), stockLightsPars = stockChunk('lights_pars_begin')
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

describe('shader text against the frozen JavaScript', () => {
  // The frozen patch on a stand-in for three: stock chunks and one uniform table per lit program.
  const stock = (begin = stockLightsBegin, pars = stockLightsPars, missing = []) => ({
    ShaderChunk:{ lights_fragment_begin:begin, lights_pars_begin:pars },
    ShaderLib:Object.fromEntries(['standard', 'physical', 'lambert', 'phong', 'toon', 'basic'].filter(name => !missing.includes(name)).map(name => [name, { uniforms:{} }]))
  })
  // What production does with the module's answer (src/js/shelf-light-occlusion.js), on the same stand-in.
  const production = three => {
    const patched = rustShelf.shelf_lamp_occlusion_patch(three.ShaderChunk.lights_pars_begin, three.ShaderChunk.lights_fragment_begin)
    if (!patched) return false
    three.ShaderChunk.lights_pars_begin = patched[0]
    if (patched[1] === undefined) return false
    three.ShaderChunk.lights_fragment_begin = patched[1]
    return true
  }

  it('patched the real three exactly as the frozen patch patches stock chunks', () => {
    const three = stock(), cabinet = new Float32Array(20), boards = new Float32Array(8)
    frozenOcclusionPatch(three, cabinet, boards)
    expect(three.ShaderChunk.lights_fragment_begin).not.toBe(stockLightsBegin)
    expect(THREE.ShaderChunk.lights_fragment_begin).toBe(three.ShaderChunk.lights_fragment_begin)
    expect(THREE.ShaderChunk.lights_pars_begin).toBe(three.ShaderChunk.lights_pars_begin)
    const uniforms = occlusion.shelfOcclusionUniforms()
    for (const name of Object.keys(THREE.ShaderLib)) {
      const lit = Boolean(three.ShaderLib[name]?.uniforms.shelfLampCabinet)
      expect(THREE.ShaderLib[name].uniforms.shelfLampCabinet?.value, name).toBe(lit ? uniforms.cabinet : undefined)
      expect(THREE.ShaderLib[name].uniforms.shelfLampBoards?.value, name).toBe(lit ? uniforms.boards : undefined)
    }
    // Installing again changes nothing.
    occlusion.installShelfLightOcclusion()
    expect(THREE.ShaderChunk.lights_pars_begin).toBe(three.ShaderChunk.lights_pars_begin)
  })

  it('patches a page whose shelf module arrives after the app\'s modules, the moment it arrives', async () => {
    // three itself is not reloaded with the app's modules: it is put back as shipped for the fresh copy.
    const three = THREE, patched = { begin:THREE.ShaderChunk.lights_fragment_begin, pars:THREE.ShaderChunk.lights_pars_begin }
    const lit = ['standard', 'physical', 'lambert', 'phong', 'toon'], uniforms = lit.map(name => [THREE.ShaderLib[name].uniforms.shelfLampCabinet, THREE.ShaderLib[name].uniforms.shelfLampBoards])
    const restore = () => {
      THREE.ShaderChunk.lights_fragment_begin = patched.begin; THREE.ShaderChunk.lights_pars_begin = patched.pars
      lit.forEach((name, index) => { [THREE.ShaderLib[name].uniforms.shelfLampCabinet, THREE.ShaderLib[name].uniforms.shelfLampBoards] = uniforms[index] })
    }
    vi.resetModules()
    try {
      THREE.ShaderChunk.lights_fragment_begin = stockLightsBegin; THREE.ShaderChunk.lights_pars_begin = stockLightsPars
      for (const name of lit) { delete THREE.ShaderLib[name].uniforms.shelfLampCabinet; delete THREE.ShaderLib[name].uniforms.shelfLampBoards }
      // The page head's compile, still running while the app's modules are evaluated.
      let arrive
      globalThis.__inhouseShelfReady = new Promise(resolve => { arrive = resolve })
      const late = await import('../../src/js/shelf-light-occlusion.js'), loader = await import('../../src/js/rust-shelf.js')
      expect(loader.getRustShelf()).toBeNull()
      late.installShelfLightOcclusion()
      expect(three.ShaderChunk.lights_fragment_begin).toBe(stockLightsBegin)
      expect(three.ShaderChunk.lights_pars_begin).toBe(stockLightsPars)
      arrive(new WebAssembly.Module(readFileSync('src/wasm/shelf/inhouse_read_shelf_bg.wasm')))
      // Whatever awaited the module resumes after its waiters ran: the chunks are patched by then.
      expect(await loader.requireRustShelf()).toBe(loader.getRustShelf())
      expect(three.ShaderChunk.lights_fragment_begin).toBe(patched.begin)
      expect(three.ShaderChunk.lights_pars_begin).toBe(patched.pars)
      expect(three.ShaderLib.physical.uniforms.shelfLampCabinet.value).toBe(late.shelfOcclusionUniforms().cabinet)
      expect(three.ShaderLib.toon.uniforms.shelfLampBoards.value).toBe(late.shelfOcclusionUniforms().boards)
      expect(three.ShaderLib.basic.uniforms.shelfLampCabinet).toBeUndefined()
    } finally { delete globalThis.__inhouseShelfReady; restore(); vi.resetModules() }
  })

  it('writes the same chunks for a later three that renamed, repeated or lost any of the lines', () => {
    const lines = ['getPointLightInfo( pointLight, geometryPosition, directLight );', 'getSpotLightInfo( spotLight, geometryPosition, directLight );',
      'rectAreaLight = rectAreaLights[ i ];', 'vec3 geometryPosition = - vViewPosition;']
    const variants = [stockLightsBegin, '', lines.join('\n'), [...lines].reverse().join(' '), stockLightsBegin + stockLightsBegin, `$& $$ $\` $' ${stockLightsBegin} $1`]
    for (const line of lines) {
      variants.push(stockLightsBegin.replace(line, line.replace('Light', 'Lamp').replace('geometryPosition =', 'position =')))
      variants.push(stockLightsBegin.replace(line, ''), stockLightsBegin.replace(line, `${line}\n${line}`))
    }
    const random = prng(77)
    for (let trial = 0; trial < 300; trial++) {
      let text = stockLightsBegin
      for (const line of lines) if (random.chance(.3)) text = text.replace(line, random.chance(.5) ? '' : `${line} ${random.pick(lines)}`)
      const cut = random.int(0, text.length)
      variants.push(random.chance(.3) ? text.slice(0, cut) : random.chance(.5) ? text.slice(cut) + text.slice(0, cut) : text)
    }
    let whole = 0, declarations = 0, untouched = 0
    for (const [index, begin] of variants.entries()) {
      for (const pars of [stockLightsPars, '', 'é — 𝛑 $&']) {
        const theirs = stock(begin, pars), mine = stock(begin, pars)
        frozenOcclusionPatch(theirs, new Float32Array(20), new Float32Array(8))
        const installed = production(mine)
        expect(mine.ShaderChunk, `variant ${index}`).toEqual(theirs.ShaderChunk)
        expect(installed, `variant ${index}`).toBe(Boolean(theirs.ShaderLib.standard.uniforms.shelfLampCabinet))
        if (installed) whole++; else if (mine.ShaderChunk.lights_pars_begin !== pars) declarations++; else untouched++
      }
    }
    expect(Math.min(whole, declarations, untouched)).toBeGreaterThan(10)
  })

  it('writes the same back-panel shader whatever three\'s shader and light chunk hold', () => {
    const original = THREE.ShaderChunk.lights_fragment_begin, stockFragment = THREE.ShaderLib.physical.fragmentShader
    const includes = ['#include <shadowmap_pars_fragment>', '#include <lights_fragment_begin>', '#include <aomap_fragment>']
    const chunks = [original, stockLightsBegin, '', 'getShadow( directionalShadowMap[ i ] getShadow( directionalShadowMap[ i ]', `$& $$ $\` $' $1 $< ${original} $`, 'no shadow $$ here $']
    const fragments = [stockFragment, '', includes.join('\n'), [...includes].reverse().join(' x '), stockFragment + stockFragment, `é 𝛑 ${stockFragment}`]
    for (const include of includes) fragments.push(stockFragment.replace(include, ''), stockFragment.replace(include, `${include} ${include}`))
    try {
      for (const [width, height] of [[1024, 768], [390, 844]]) {
        vi.stubGlobal('innerWidth', width); vi.stubGlobal('innerHeight', height)
        const mine = lighting.widePenumbra(new THREE.MeshStandardMaterial()), theirs = frozenLighting.widePenumbra(new THREE.MeshStandardMaterial())
        for (const [c, chunk] of chunks.entries()) for (const [f, fragmentShader] of fragments.entries()) {
          THREE.ShaderChunk.lights_fragment_begin = chunk
          const a = { fragmentShader, uniforms:{} }, b = { fragmentShader, uniforms:{} }
          mine.onBeforeCompile(a); theirs.onBeforeCompile(b)
          expect(a.fragmentShader, `chunk ${c}, fragment ${f}`).toBe(b.fragmentShader)
        }
        expect(mine.customProgramCacheKey()).toBe(theirs.customProgramCacheKey())
      }
    } finally { THREE.ShaderChunk.lights_fragment_begin = original }
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
