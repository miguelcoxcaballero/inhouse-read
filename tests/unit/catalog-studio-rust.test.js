// Differential test: a catalogue studio's three.js side (scene, orthographic camera, renderer, studio room,
// lights, context-loss listener, resize observer, link, draw, unframe and finish), now rust-ui/src/catalog_studio.rs
// (studio_open_three) behind src/js/catalog-studio.js, against the frozen JavaScript
// (helpers/reference-catalog-studio.js). Both run on the same recording three and DOM node: every construction
// with its arguments, every call and every property written (in order), the parts and the studio handed to the
// native loop are compared, for the three studios, with and without WebGL, adapter hooks and a usable pixel
// ratio, and with a failure injected at each recorded step in turn.
import { afterEach, describe, expect, it, vi } from 'vitest'

const world = vi.hoisted(() => {
  const ctx = { log:[], count:0, fail:-1, ids:0, listeners:[], names:new WeakMap() }
  const record = (...entry) => { ctx.count += 1; ctx.log.push(entry); if (ctx.count === ctx.fail) throw new Error(`step ${ctx.count} failed`) }
  const TAG = Symbol('label')
  const label = value => {
    if (typeof value === 'function') return value[TAG] ?? ctx.names.get(value) ?? 'fn'
    if (value && typeof value === 'object') {
      if (value[TAG]) return value[TAG]
      if (Array.isArray(value)) return value.map(label)
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, label(item)]))
    }
    return value
  }
  const returns = { fromScene:path => node(`Target#${++ctx.ids}`), getBoundingClientRect:() => ({ width:90, height:70 }) }
  // A recorded object: reads of unknown keys give a stable recorded child that can also be called.
  function node(name, initial = {}) {
    const children = new Map()
    const target = function recorded() {}
    Object.assign(target, initial)
    return new Proxy(target, {
      get(_, key) {
        if (key === TAG) return name
        if (typeof key === 'symbol') return undefined
        // WebAssembly bindings call through Function.prototype.call/apply.
        if (key === 'call' || key === 'apply' || key === 'bind') return Reflect.get(target, key)
        if (Object.prototype.hasOwnProperty.call(target, key) && key !== 'name' && key !== 'length' && key !== 'prototype') return target[key]
        if (!children.has(key)) children.set(key, node(`${name}.${key}`))
        return children.get(key)
      },
      set(_, key, value) { record('set', name, key, label(value)); target[key] = value; return true },
      apply(_, self, args) {
        const method = name.slice(name.lastIndexOf('.') + 1)
        record('call', name, ...args.map(label))
        if (method === 'addEventListener') ctx.listeners.push(args[1])
        return returns[method]?.(name)
      }
    })
  }
  const constructors = ['Scene', 'OrthographicCamera', 'WebGLRenderer', 'PMREMGenerator', 'MeshBasicMaterial', 'PlaneGeometry', 'Mesh',
    'HemisphereLight', 'DirectionalLight']
  const three = { ACESFilmicToneMapping:4, PCFSoftShadowMap:2, DoubleSide:'double' }
  for (const kind of constructors) three[kind] = function Recorded(...args) { record('new', kind, ...args.map(label)); return node(`${kind}#${++ctx.ids}`) }
  function RoomEnvironment(...args) { record('new', 'RoomEnvironment', ...args.map(label)); return node(`RoomEnvironment#${++ctx.ids}`) }
  const hooks = {
    createCatalogPreviewFrame:() => { record('createFrame'); return node('framing') },
    whenProgramsReady:(...args) => { record('whenProgramsReady', ...args.map(label)); return () => record('cancelLink') },
    retainPrograms:renderer => record('retainPrograms', label(renderer)),
    configureShaderDiagnostics:renderer => record('diagnostics', label(renderer))
  }
  class ResizeObserver {
    constructor(callback) { record('new', 'ResizeObserver', label(callback)); this[TAG] = 'ResizeObserver' }
    observe(target) { record('observe', label(target)) }
    disconnect() { record('disconnect') }
  }
  const reset = fail => { ctx.log = []; ctx.count = 0; ctx.fail = fail; ctx.ids = 0; ctx.listeners = [] }
  return { ctx, three, RoomEnvironment, hooks, ResizeObserver, node, label, reset, TAG }
})

vi.mock('three', () => world.three)
vi.mock('three/addons/environments/RoomEnvironment.js', () => ({ RoomEnvironment:world.RoomEnvironment }))
vi.mock('../../src/js/catalog-preview-frame.js', () => ({ createCatalogPreviewFrame:(...args) => world.hooks.createCatalogPreviewFrame(...args) }))
vi.mock('../../src/js/gpu-programs.js', () => ({
  whenProgramsReady:(...args) => world.hooks.whenProgramsReady(...args),
  retainPrograms:(...args) => world.hooks.retainPrograms(...args)
}))
vi.mock('../../src/js/shader-diagnostics.js', () => ({ configureShaderDiagnostics:(...args) => world.hooks.configureShaderDiagnostics(...args) }))

const { rustShelf } = await import('./helpers/rust-shelf-ready.js')
const { openStudio, studioControls } = await import('../../src/js/catalog-studio.js')
const { openStudio:reference } = await import('./helpers/reference-catalog-studio.js')

const env = { THREE:world.three, RoomEnvironment:world.RoomEnvironment, ...world.hooks, needRustShelf:() => rustShelf }
const savedRatio = globalThis.devicePixelRatio

function adapterFor(variant) {
  const named = (name, fn) => { world.ctx.names.set(fn, name); return fn }
  const adapter = {
    make:named('make', () => world.node('model')), swap:named('swap', () => {}), retint:named('retint', () => 0), tintSet:named('tintSet', () => false),
    release:named('release', (...args) => world.ctx.log.push(['release', ...args.map(world.label)])),
    size:named('size', model => { world.ctx.log.push(['size', world.label(model)]); return { x:40, y:60 } }), padding:variant % 2 ? 0.12 : undefined
  }
  if (variant & 2) {
    adapter.prepareScene = named('prepareScene', parts => world.ctx.log.push(['prepareScene', Object.keys(parts)]))
    adapter.linkRoot = named('linkRoot', model => variant & 4 ? null : world.node('root'))
    adapter.beforeDraw = named('beforeDraw', model => world.ctx.log.push(['beforeDraw', world.label(model)]))
  }
  return adapter
}

function run(open, { kind, fail = -1, webgl = true, ratio, variant = 0, width = 120, exercise = true }) {
  world.reset(fail)
  if (webgl) globalThis.WebGLRenderingContext = function WebGLRenderingContext() {}
  else delete globalThis.WebGLRenderingContext
  globalThis.devicePixelRatio = ratio
  globalThis.ResizeObserver = world.ResizeObserver
  const host = world.node('host', { clientWidth:width, clientHeight:80, dataset:world.node('dataset', { renderCount:'' }) })
  const adapter = adapterFor(variant)
  let opened, error = null
  try { opened = open(kind, host, adapter) } catch (caught) { error = caught.message }
  const result = { error, log:null, parts:null, studio:null }
  if (opened) {
    const { state, parts, shelf } = opened
    const studio = state.host
    result.parts = world.label({ ...parts, lights:{ ...parts.lights } })
    result.studio = Object.keys(studio).map(key => [key, typeof studio[key], world.ctx.names.get(studio[key]) ?? null])
    result.drawable = state.drawable
    result.shelf = shelf === rustShelf
    if (exercise) {
      const steps = [
        () => studio.link(world.node('model'), () => {}),
        () => studio.draw(world.node('model')),
        () => { host.clientWidth = 0; studio.draw(world.node('model')) },
        () => { for (const listener of world.ctx.listeners) listener({ preventDefault:() => world.ctx.log.push(['preventDefault']) }) },
        () => studio.unframe(),
        () => studio.finish(world.node('model'))
      ]
      for (const step of steps) { try { step() } catch (caught) { world.ctx.log.push(['threw', caught.message]) } }
    }
    try { rustShelf.studio_dispose(state) } catch (caught) { world.ctx.log.push(['dispose threw', caught.message]) }
  }
  result.log = world.ctx.log
  result.steps = world.ctx.count
  return result
}

afterEach(() => { globalThis.devicePixelRatio = savedRatio; delete globalThis.ResizeObserver })

describe('the catalogue studio set-up in Rust against the frozen JavaScript', () => {
  const kinds = [0, 1, 2]
  for (const kind of kinds) {
    const full = run((...args) => reference(env, ...args), { kind, ratio:3, exercise:false }).steps
    it(`studio ${kind} records a full set-up`, () => { expect(full).toBeGreaterThan(20) })
    for (const [webgl, ratio, variant, width] of [[true, 3, 0, 120], [true, undefined, 3, 0], [true, 1.5, 7, 120], [false, 2, 2, 120], [true, 0, 5, 64]]) {
      it(`studio ${kind}, webgl ${webgl}, ratio ${ratio}, adapter ${variant}, width ${width}`, () => {
        const options = { kind, webgl, ratio, variant, width }
        const expected = run((...args) => reference(env, ...args), options)
        const actual = run(openStudio, options)
        expect(actual).toEqual(expected)
        expect(actual.log.length).toBeGreaterThan(5)
      })
    }
    for (let fail = 1; fail <= full; fail++) {
      it(`studio ${kind}, failure at step ${fail}`, () => {
        const options = { kind, fail, ratio:1, variant:fail % 8, exercise:false }
        const expected = run((...args) => reference(env, ...args), options)
        const actual = run(openStudio, options)
        expect(actual).toEqual(expected)
      })
    }
  }
  it('drives the native loop through studioControls', () => {
    world.reset(-1)
    globalThis.WebGLRenderingContext = function WebGLRenderingContext() {}
    globalThis.ResizeObserver = world.ResizeObserver
    const host = world.node('host', { clientWidth:120, clientHeight:80, dataset:world.node('dataset', { renderCount:'' }) })
    const controls = studioControls(openStudio(1, host, adapterFor(0)), () => 'updated')
    expect(controls.update()).toBe('updated')
    controls.setActive(false)
    controls.dispose()
    expect(world.ctx.log.some(entry => entry[0] === 'release')).toBe(true)
  })
})
