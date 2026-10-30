// Differential test: the shared renderer's set-up and its studio room, now rust-ui/src/studio_environment.rs
// (studio_renderer_create) behind src/js/studio-renderer.js, against the frozen JavaScript
// (helpers/reference-studio-renderer.js). Both run on the same recording three: every construction with
// its arguments, every call and property the set-up leaves on the renderer, the patched tone-mapping chunk,
// the hooks of the other modules and the answer are compared, with a failure injected at each step in turn
// (the renderer is then released and the answer is null) and with and without a saved studio atlas.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const world = vi.hoisted(() => {
  const ctx = { log:[], count:0, fail:-1, cached:null }
  const record = (...entry) => { ctx.count += 1; ctx.log.push(entry); if (ctx.count === ctx.fail) throw new Error(`step ${ctx.count} failed`) }
  let ids = 0
  const name = value => value?.kind ? `${value.kind}#${value.id}` : value
  class Node { constructor(kind, args) { this.kind = kind; this.id = ++ids; this.children = []; record('new', kind, ...args.map(name)) }
    add(child) { record('add', name(this), name(child)); this.children.push(child) }
    traverse(visit) { visit(this); for (const child of this.children) child.traverse(visit) } }
  class Vector { constructor(owner) { this.owner = owner } set(...xyz) { record('position', name(this.owner), ...xyz) } }
  class Scene extends Node { constructor() { super('Scene', []) } }
  class Mesh extends Node { constructor(geometry, material) { super('Mesh', [geometry, material]); this.geometry = geometry; this.material = material; this.position = new Vector(this) }
    lookAt(...xyz) { record('lookAt', name(this), ...xyz) } }
  class Geometry { constructor(kind, args) { this.kind = kind; this.id = ++ids; record('new', kind, ...args)
    this.attributes = { position:{ array:new Float32Array(args.length ? [0, args[0], 0, 1, -args[0], .5, -1, args[0] / 3, .25] : []) } } }
    setAttribute(key, value) { record('setAttribute', name(this), key, name(value)) } dispose() { record('dispose', name(this)) } }
  class SphereGeometry extends Geometry { constructor(...args) { super('SphereGeometry', args) } }
  class PlaneGeometry extends Geometry { constructor(...args) { super('PlaneGeometry', args) } }
  class BufferAttribute { constructor(array, size) { this.kind = 'BufferAttribute'; this.id = ++ids; record('new', 'BufferAttribute', array.constructor.name, Array.from(array), size) } }
  class Color { constructor(r, g, b) { this.kind = 'Color'; this.id = ++ids; Object.assign(this, { r, g, b }); record('new', 'Color', r, g, b) }
    multiplyScalar(s) { record('multiplyScalar', name(this), s); this.r *= s; this.g *= s; this.b *= s; return this } }
  class MeshBasicMaterial { constructor(options) { this.kind = 'MeshBasicMaterial'; this.id = ++ids
    record('new', 'MeshBasicMaterial', Object.entries(options).map(([key, value]) => [key, value?.kind === 'Color' ? [value.r, value.g, value.b] : value])) }
    dispose() { record('dispose', name(this)) } }
  class WebGLRenderer { constructor(options) { this.kind = 'WebGLRenderer'; this.id = ++ids; this.shadowMap = {}; record('new', 'WebGLRenderer', options) }
    dispose() { record('dispose', name(this)) } }
  class PMREMGenerator { constructor(renderer) { this.kind = 'PMREMGenerator'; this.id = ++ids; record('new', 'PMREMGenerator', name(renderer)) }
    fromScene(scene, sigma) { record('fromScene', name(scene), sigma); return { kind:'Target', id:++ids, texture:{ kind:'Texture', id:++ids } } }
    dispose() { record('dispose', name(this)) } }
  const ShaderChunk = {}
  const three = { Scene, Mesh, SphereGeometry, PlaneGeometry, BufferAttribute, Color, MeshBasicMaterial, WebGLRenderer, PMREMGenerator, ShaderChunk,
    SRGBColorSpace:'srgb', NeutralToneMapping:7, VSMShadowMap:3, BackSide:1, DoubleSide:2 }
  const hooks = {
    cachedStudioEnvironment:() => { record('cached'); return ctx.cached },
    prepareStudioEnvironmentCache:(renderer, target) => record('prepareCache', name(renderer), name(target)),
    configureShaderDiagnostics:renderer => record('diagnostics', name(renderer)),
    keepProgramsAlive:renderer => record('keepAlive', name(renderer))
  }
  const reset = (fail, cached, chunk) => { ctx.log = []; ctx.count = 0; ctx.fail = fail; ctx.cached = cached; ids = 0; ShaderChunk.tonemapping_pars_fragment = chunk }
  return { ctx, three, hooks, reset, name }
})

vi.mock('three', () => world.three)
vi.mock('../../src/js/studio-environment-cache.js', () => ({
  cachedStudioEnvironment:(...args) => world.hooks.cachedStudioEnvironment(...args),
  prepareStudioEnvironmentCache:(...args) => world.hooks.prepareStudioEnvironmentCache(...args)
}))
vi.mock('../../src/js/shader-diagnostics.js', () => ({ configureShaderDiagnostics:(...args) => world.hooks.configureShaderDiagnostics(...args) }))
vi.mock('../../src/js/gpu-programs.js', () => ({ keepProgramsAlive:(...args) => world.hooks.keepProgramsAlive(...args) }))

const { rustShelf } = await import('./helpers/rust-shelf-ready.js')
const { createStudioRenderer, studioEnvironmentFor } = await import('../../src/js/studio-renderer.js')
const { createStudioRenderer:reference } = await import('./helpers/reference-studio-renderer.js')

const toe = 'float offset = x < 0.08 ? x - 6.25 * x * x : 0.04;'
const chunks = [`#a\n${toe}\n#b`, '#no toe here', undefined]

function run(create, fail, cached, chunk, preserve) {
  world.reset(fail, cached, chunk)
  let answer
  try { answer = create(preserve) } catch (error) { answer = ['threw', error.message] }
  const renderer = answer?.renderer
  return { answer:answer && !Array.isArray(answer) ? [world.name(answer.renderer), world.name(answer.environment) ?? answer.environment] : answer ?? null,
    renderer:renderer ? { outputColorSpace:renderer.outputColorSpace, toneMapping:renderer.toneMapping, toneMappingExposure:renderer.toneMappingExposure, shadowMap:{ ...renderer.shadowMap } } : null,
    chunk:world.three.ShaderChunk.tonemapping_pars_fragment, log:world.ctx.log, steps:world.ctx.count }
}
const env = rendererEnvironments => ({ THREE:world.three, ...world.hooks, needRustShelf:() => rustShelf, rendererEnvironments })

const withWebGL = () => { globalThis.WebGLRenderingContext = function WebGLRenderingContext() {} }
withWebGL()
beforeEach(withWebGL)

describe('the studio renderer set-up in Rust against the frozen JavaScript', () => {
  const full = run(preserve => reference(env(new WeakMap()), preserve), -1, null, chunks[0], false).steps
  it('records every step of a full bake', () => { expect(full).toBeGreaterThan(40) })
  for (const cached of [null, { kind:'Texture', id:999 }]) {
    for (const chunk of chunks) {
      for (let fail = -1; fail <= full; fail++) {
        if (fail === 0) continue
        it(`${cached ? 'saved atlas' : 'baked room'}, chunk ${chunks.indexOf(chunk)}, failure at step ${fail}`, () => {
          const preserve = fail % 2 === 0
          const expected = run(value => reference(env(new WeakMap()), value), fail, cached, chunk, preserve)
          const actual = run(createStudioRenderer, fail, cached, chunk, preserve)
          expect(actual).toEqual(expected)
        })
      }
    }
  }
  it('answers null without WebGL and remembers each renderer\'s studio', () => {
    delete globalThis.WebGLRenderingContext
    expect(run(createStudioRenderer, -1, null, chunks[0], false).answer).toBe(null)
    globalThis.WebGLRenderingContext = function WebGLRenderingContext() {}
    world.reset(-1, null, chunks[0])
    const made = createStudioRenderer(true)
    expect(studioEnvironmentFor(made.renderer)).toBe(made.environment)
    expect(made.environment.kind).toBe('Texture')
  })
})
