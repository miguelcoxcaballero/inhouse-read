import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { foliateFixedLayoutPatch, patchFoliateFixedLayout } from '../../scripts/foliate-fixed-layout-patch.mjs'

const upstream = readFileSync('node_modules/foliate-js/fixed-layout.js', 'utf8')
let serial = 0, observers, roots

beforeEach(() => {
  observers = []; roots = new WeakMap()
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback) { observers.push(callback) }
    observe() {}
    unobserve() {}
  })
  vi.stubGlobal('CSSStyleSheet', class { replaceSync() {} })
  const create = document.createElement.bind(document)
  vi.spyOn(document,'createElement').mockImplementation(name => {
    const element = create(name)
    // jsdom does not create iframe browsing contexts inside shadow roots.
    if(name==='iframe') Object.defineProperty(element,'contentDocument', {
      value:document.implementation.createHTMLDocument('Printed page')
    })
    return element
  })
  const attach = HTMLElement.prototype.attachShadow
  vi.spyOn(HTMLElement.prototype,'attachShadow').mockImplementation(function(options) {
    const root = attach.call(this,options); roots.set(this,root); return root
  })
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.innerHTML='' })

function makeRenderer(source, spread) {
  // Execute the actual upstream renderer with only its side-effect import and
  // registration removed. The custom element runs its original private frame
  // creation, async spread loading, ResizeObserver and final page rendering.
  const module = source.replace("import 'construct-style-sheets-polyfill'", '')
    .replace('export class FixedLayout', 'class FixedLayout')
    .replace("customElements.define('foliate-fxl', FixedLayout)", '')
  const FixedLayout = new Function(`${module}\nreturn FixedLayout`)()
  const name = `inhouse-fixed-layout-regression-${++serial}`
  customElements.define(name,FixedLayout)
  const renderer = document.createElement(name)
  renderer.getBoundingClientRect = () => ({width:390,height:748})
  document.body.append(renderer)
  renderer.open({dir:'ltr',rendition:{spread,viewport:{width:400,height:600}},
    sections:Array.from({length:4},() => ({load:async () => 'about:blank'}))})
  return renderer
}
async function waitForFrames(renderer, count) {
  await Promise.resolve()
  for(let i=0;i<16;i++) {
    const frames = [...roots.get(renderer).querySelectorAll('iframe')]
    if(frames.length===count) return frames
    await Promise.resolve()
  }
  throw new Error(`Expected ${count} pending real frames`)
}
async function firstSpread(renderer, center) {
  const opening = renderer.goToSpread(0,'right')
  const frames = await waitForFrames(renderer,center ? 1 : 2)
  frames.at(-1).dispatchEvent(new Event('load'))
  await opening
}

describe('durable Foliate fixed-layout resize guard', () => {
  it('changes only the incomplete-frame guard in the installed upstream source', () => {
    const patched = patchFoliateFixedLayout(upstream)
    expect(patched).toContain('if (!side || (!this.#center && (!this.#left || !this.#right))) return')
    expect(patched.replace('if (!side || (!this.#center && (!this.#left || !this.#right))) return','if (!side) return')).toBe(upstream)
  })
  it('fails explicitly if the upstream signature changes', () => {
    expect(() => patchFoliateFixedLayout(upstream.replace('if (!side) return','if (!side) return false'))).toThrow(/Unexpected foliate-js/)
    expect(() => patchFoliateFixedLayout(upstream.replace('#render(side = this.#side)','#render(side = this.#currentSide)'))).toThrow(/Unexpected foliate-js/)
  })
  it('targets only Foliate fixed-layout module IDs on Windows and Unix', () => {
    const plugin = foliateFixedLayoutPatch()
    expect(plugin.transform('other source','/project/src/fixed-layout.js')).toBeNull()
    expect(plugin.transform(upstream,'C:\\project\\node_modules\\foliate-js\\fixed-layout.js').code).toBe(patchFoliateFixedLayout(upstream))
    expect(plugin.transform(upstream,'/project/node_modules/foliate-js/fixed-layout.js?v=1').code).toBe(patchFoliateFixedLayout(upstream))
  })
  it('reproduces the actual upstream observer exception while a new center frame loads', async () => {
    const renderer = makeRenderer(upstream,'none')
    await firstSpread(renderer,true)
    const loading = renderer.goToSpread(1,'center')
    const [frame] = await waitForFrames(renderer,1)
    expect(() => observers[0]()).toThrow(/Cannot read properties of null/)
    frame.dispatchEvent(new Event('load'))
    await loading
    renderer.destroy()
  })
  it('defers resize while a center frame loads, then renders the correct next page', async () => {
    const renderer = makeRenderer(patchFoliateFixedLayout(upstream),'none')
    await firstSpread(renderer,true)
    const loading = renderer.goToSpread(1,'center')
    const [frame] = await waitForFrames(renderer,1)
    expect(() => observers[0]()).not.toThrow()
    frame.dispatchEvent(new Event('load'))
    await loading
    expect(renderer.index).toBe(1)
    expect(frame.style.display).toBe('block')
    expect(() => observers[0]()).not.toThrow()
    renderer.destroy()
  })
  it('defers resize between the left and right spread loads and resumes when both exist', async () => {
    const renderer = makeRenderer(patchFoliateFixedLayout(upstream))
    await firstSpread(renderer,false)
    const loading = renderer.goToSpread(1,'left')
    const [left] = await waitForFrames(renderer,1)
    expect(() => observers[0]()).not.toThrow()
    left.dispatchEvent(new Event('load'))
    const frames = await waitForFrames(renderer,2)
    expect(() => observers[0]()).not.toThrow()
    frames[1].dispatchEvent(new Event('load'))
    await loading
    expect(renderer.getContents()).toHaveLength(2)
    expect(left.style.display).toBe('block')
    expect(frames[1].parentElement.style.display).toBe('none')
    expect(() => observers[0]()).not.toThrow()
    renderer.destroy()
  })
})
