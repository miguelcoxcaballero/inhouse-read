// Timing of a catalogue studio's draw (the one per-frame path of studio_open_three, used while a lamp's colour
// temperature eases for about 300 ms) against the frozen JavaScript, on the same plain stand-ins for three and
// the preview node. Reports both; the draw itself is the renderer's render call, which this does not include.
import { describe, expect, it, vi } from 'vitest'

const stubs = vi.hoisted(() => {
  const vector = () => ({ set() {} })
  class Object3D { constructor() { this.position = vector(); this.children = [] } lookAt() {} add(child) { this.children.push(child) } dispose() {} }
  const three = {
    Scene:Object3D, OrthographicCamera:Object3D, Mesh:Object3D, HemisphereLight:Object3D,
    DirectionalLight:class extends Object3D { constructor() { super(); this.shadow = { mapSize:vector(), camera:{ updateProjectionMatrix() {} } } } },
    PlaneGeometry:class {}, MeshBasicMaterial:class {},
    WebGLRenderer:class { constructor() { this.shadowMap = {}; this.info = {}; this.domElement = { setAttribute() {}, addEventListener() {} } }
      setPixelRatio() {} render() {} dispose() {} forceContextLoss() {} },
    PMREMGenerator:class { fromScene() { return { texture:{}, dispose() {} } } dispose() {} },
    ACESFilmicToneMapping:4, PCFSoftShadowMap:2, DoubleSide:2
  }
  class RoomEnvironment extends Object3D {}
  return { three, RoomEnvironment }
})
vi.mock('three', () => stubs.three)
vi.mock('three/addons/environments/RoomEnvironment.js', () => ({ RoomEnvironment:stubs.RoomEnvironment }))
vi.mock('../../src/js/catalog-preview-frame.js', () => ({ createCatalogPreviewFrame:() => ({ apply() {}, dispose() {} }) }))
vi.mock('../../src/js/gpu-programs.js', () => ({ whenProgramsReady:() => () => {}, retainPrograms() {} }))
vi.mock('../../src/js/shader-diagnostics.js', () => ({ configureShaderDiagnostics() {} }))

const { rustShelf } = await import('./helpers/rust-shelf-ready.js')
const { openStudio } = await import('../../src/js/catalog-studio.js')
const { openStudio:reference } = await import('./helpers/reference-catalog-studio.js')
const env = { THREE:stubs.three, RoomEnvironment:stubs.RoomEnvironment, createCatalogPreviewFrame:() => ({ apply() {}, dispose() {} }),
  whenProgramsReady:() => () => {}, retainPrograms() {}, configureShaderDiagnostics() {}, needRustShelf:() => rustShelf }

function timing(open) {
  globalThis.WebGLRenderingContext = function WebGLRenderingContext() {}
  globalThis.ResizeObserver = class { observe() {} disconnect() {} }
  const host = { clientWidth:300, clientHeight:200, dataset:{}, replaceChildren() {} }
  const adapter = { make() {}, swap() {}, retint() {}, tintSet() {}, release() {}, size:() => ({ x:40, y:60 }), padding:0.1 }
  const { state } = open(2, host, adapter), studio = state.host, model = {}
  for (let index = 0; index < 500; index++) studio.draw(model)
  const rounds = 5000, started = performance.now()
  for (let index = 0; index < rounds; index++) studio.draw(model)
  const elapsed = (performance.now() - started) / rounds
  rustShelf.studio_dispose(state)
  return { elapsed, count:host.dataset.renderCount }
}

describe('a catalogue studio draw, Rust against the frozen JavaScript', () => {
  it('times one draw', () => {
    const js = [timing((...args) => reference(env, ...args)), timing((...args) => reference(env, ...args))]
    const rust = [timing(openStudio), timing(openStudio)]
    expect(rust[0].count).toBe(js[0].count)
    const best = runs => Math.min(...runs.map(run => run.elapsed)) * 1000
    console.log(`catalogue studio draw: JS ${best(js).toFixed(2)} us, Rust ${best(rust).toFixed(2)} us`)
  })
})
